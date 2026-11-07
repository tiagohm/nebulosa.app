import { describe, expect, test } from 'bun:test'
import type { ObservingCandidate, ObservingConstraints, ObservingDiscoveryPage, ObservingPlan, SkyObjectRef } from 'api'
import { proxy } from 'valtio'
import type { RouteState } from '../../shell/route'
import type { SkyClock } from '../../sky/clock'
import type { SkyImageState } from '../../sky/footprint'
import { plannerTarget } from '../../sky/ObjectActions'
import type { SkyIo, SkyState } from '../../sky/sky'
import { addToObservingPlanner, createObservingPlannerState, discardDraft, discover, editPlan, handleObservingPlanEvent, type ObservingPlannerIo, type ObservingPlansState, overwritePlan, planDocument, refreshObservingPlans, sameTarget, searchMinorBody, showTargetInSky, tonight } from './observingplanner'

const CONSTRAINTS: ObservingConstraints = { mode: 'deepSky', minimumAltitude: 0.5, maximumAirmass: 2, maximumSunAltitude: -0.3, minimumMoonSeparation: 0.7, minimumContinuousMs: 3_600_000 }
const SITE = { name: 'Backyard', latitude: -23.55, longitude: -46.63, elevation: 760, timeZone: 'America/Sao_Paulo' }

function plan(id: string, revision: number, name = 'Night'): ObservingPlan {
	return { id, name, eveningDate: '2026-01-15', site: SITE, constraints: CONSTRAINTS, items: [], revision, createdAt: 0, updatedAt: revision }
}

function plansState(): ObservingPlansState {
	return proxy<ObservingPlansState>({ plans: {}, loaded: false, drafts: {}, saving: {}, conflicts: {}, errors: {} })
}

function respond(body: unknown, status = 200) {
	return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

// IO whose writes run when the test says, answering requests with `answer`.
function io(answer: (url: string, init?: RequestInit) => Promise<Response>) {
	const requests: { url: string; body?: unknown }[] = []
	const pending: (() => void)[] = []
	let ids = 0
	const value: ObservingPlannerIo = {
		fetch: (url, init) => {
			requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
			return answer(url, init)
		},
		time: () => 0,
		later: (run) => {
			pending.push(run)
			return () => pending.splice(pending.indexOf(run), 1)
		},
		id: () => `id${++ids}`,
	}
	const flush = () => {
		for (const run of pending.splice(0)) run()
	}
	return { io: value, requests, flush }
}

function candidate(id: number, score: number): ObservingCandidate {
	return { target: { kind: 'catalog', id }, name: `Object ${id}`, class: 'galaxy', status: 'observable', reasons: [], score, bestAt: 0, windows: [], longestWindowMs: 3_600_000, totalUsableMs: 3_600_000 }
}

describe('plans mirror', () => {
	test('an event never rolls back a newer revision, and a read keeps what events brought meanwhile', async () => {
		const state = plansState()
		handleObservingPlanEvent(state, { type: 'observingPlan:updated', plan: plan('a', 3) })
		handleObservingPlanEvent(state, { type: 'observingPlan:updated', plan: plan('a', 2, 'Old') })
		expect(state.plans.a.revision).toBe(3)

		let release!: () => void
		const read = refreshObservingPlans(state, {
			fetch: () =>
				new Promise((resolve) => {
					release = () => resolve(new Response(JSON.stringify({ plans: [plan('a', 2), plan('b', 1)] })))
				}),
		})
		handleObservingPlanEvent(state, { type: 'observingPlan:removed', id: 'b' })
		handleObservingPlanEvent(state, { type: 'observingPlan:updated', plan: plan('a', 4) })
		release()
		await read
		expect(Object.keys(state.plans)).toEqual(['a'])
		expect(state.plans.a.revision).toBe(4)
		expect(state.loaded).toBe(true)
	})
})

describe('plan edits', () => {
	test('edits close together are written once from the revision they were made on', async () => {
		const state = plansState()
		state.plans.a = plan('a', 1)
		const { io: fake, requests, flush } = io((_, init) => respond({ ...plan('a', 2), name: (JSON.parse(init!.body as string) as ObservingPlan).name }))
		editPlan(state, 'a', (document) => ({ ...document, name: 'One' }), fake)
		editPlan(state, 'a', (document) => ({ ...document, name: 'Two' }), fake)
		expect(planDocument(state, 'a')?.name).toBe('Two')
		flush()
		await Bun.sleep(0)
		expect(requests).toHaveLength(1)
		expect(requests[0]).toMatchObject({ url: '/api/observing-planner/plans/a', body: { name: 'Two', revision: 1 } })
		expect(state.drafts.a).toBeUndefined()
		expect(state.plans.a).toMatchObject({ name: 'Two', revision: 2 })
	})

	test('a conflict keeps the draft until the operator keeps theirs or saves over it', async () => {
		const state = plansState()
		state.plans.a = plan('a', 1)
		let conflict = true
		const { io: fake, requests, flush } = io(() => (conflict ? respond({ error: 'changed', code: 'conflict', plan: plan('a', 5, 'Theirs') }, 409) : respond(plan('a', 6, 'Mine'))))
		editPlan(state, 'a', (document) => ({ ...document, name: 'Mine' }), fake)
		flush()
		await Bun.sleep(0)
		expect(state.conflicts.a).toMatchObject({ name: 'Theirs', revision: 5 })
		expect(planDocument(state, 'a')?.name).toBe('Mine')

		conflict = false
		await overwritePlan(state, 'a', fake)
		expect(requests.at(-1)?.body).toMatchObject({ name: 'Mine', revision: 5 })
		expect(state.conflicts.a).toBeUndefined()
		expect(state.plans.a.revision).toBe(6)

		state.drafts.a = { document: { ...plan('a', 6), name: 'Draft' }, revision: 6 }
		state.conflicts.a = null
		discardDraft(state, 'a')
		expect(planDocument(state, 'a')?.name).toBe('Mine')
	})
})

describe('discovery', () => {
	test('batches add up and are ranked together, and a later request wins', async () => {
		const state = createObservingPlannerState()
		state.eveningDate = '2026-01-15'
		state.constraints = CONSTRAINTS
		const pages: ObservingDiscoveryPage[] = [
			{ candidates: [candidate(1, 50)], evaluated: 100, total: 250, nextCursor: 'c1', modelVersion: 1 },
			{ candidates: [candidate(2, 80)], evaluated: 100, total: 250, nextCursor: 'c2', modelVersion: 1 },
		]
		const { io: fake, requests } = io(() => respond(pages.shift()))
		await discover(state, SITE, false, fake)
		await discover(state, SITE, true, fake)
		expect(requests[1].body).toMatchObject({ cursor: 'c1', site: { timeZone: 'America/Sao_Paulo' } })
		expect(state.discovery).toMatchObject({ evaluated: 200, total: 250, nextCursor: 'c2' })
		expect(state.discovery?.candidates.map((e) => e.score)).toEqual([80, 50])

		let release!: () => void
		const slow = io(
			() =>
				new Promise((resolve) => {
					release = () => resolve(new Response(JSON.stringify({ candidates: [candidate(9, 99)], evaluated: 1, total: 1, modelVersion: 1 })))
				}),
		)
		const stale = discover(state, SITE, false, slow.io)
		const latest = { ...createObservingPlannerState(), eveningDate: state.eveningDate, constraints: CONSTRAINTS }
		await discover(latest, SITE, false, io(() => respond({ candidates: [], evaluated: 0, total: 0, modelVersion: 1 })).io)
		release()
		await stale
		// The superseded answer never lands; the latest one does.
		expect(state.discovery).toBeUndefined()
		expect(latest.discovery).toMatchObject({ candidates: [], evaluated: 0 })
	})
})

describe('handoffs', () => {
	function handoff() {
		const route = proxy<RouteState>({ route: { workspace: 'tools' } })
		const sky = proxy<SkyState>({ panel: 'framing' })
		const images = proxy<SkyImageState>({})
		const clock = proxy<SkyClock>({ mode: 'fixed', anchor: 1000, startedAt: 0, rate: 1 })
		const skyIo: SkyIo = { fetch: () => respond({}), time: () => 1000 }
		return { route, sky, images, clock, io: skyIo, history: { pushState: () => undefined } }
	}

	test('the Sky adds catalog objects, bodies, and minor bodies but the Sun and other kinds', () => {
		const refs: SkyObjectRef[] = [
			{ kind: 'catalog', id: 1 },
			{ kind: 'body', code: '599' },
			{ kind: 'body', code: '10' },
			{ kind: 'minorBody', spkId: '1', designation: '1' },
			{ kind: 'constellation', code: 'ORI' },
		]
		expect(refs.map(plannerTarget)).toEqual([{ kind: 'catalog', id: 1 }, { kind: 'body', code: '599' }, undefined, { kind: 'minorBody', spkId: '1', designation: '1' }, undefined])
	})

	test('adding from the Sky opens the tool with the target pending and changes nothing else', () => {
		const state = createObservingPlannerState()
		const route = proxy<RouteState>({ route: { workspace: 'sky' } })
		addToObservingPlanner({ target: { kind: 'catalog', id: 7 }, name: 'M 42' }, state, route, { pushState: () => undefined })
		expect(state.pendingTarget).toEqual({ target: { kind: 'catalog', id: 7 }, name: 'M 42' })
		expect(route.route).toEqual({ workspace: 'tools', tool: 'observing-planner', plan: undefined })
	})

	test('showing a target selects it or marks its coordinates, never moving the clock', () => {
		const objects = handoff()
		showTargetInSky({ target: { kind: 'body', code: '699' }, name: 'Saturn' }, undefined, objects)
		expect(objects.sky.selection).toMatchObject({ ref: { kind: 'body', code: '699' }, name: 'Saturn', category: 'solarSystem' })
		expect(objects.route.route).toEqual({ workspace: 'sky' })
		expect(objects.clock).toEqual({ mode: 'fixed', anchor: 1000, startedAt: 0, rate: 1 })

		const place = handoff()
		showTargetInSky({ target: { kind: 'coordinates', name: 'Field', rightAscension: 1, declination: -0.2 }, name: 'Field' }, undefined, place)
		expect(place.images.intent).toMatchObject({ rightAscension: 1, declination: -0.2, label: 'Field', mark: true })
		expect(place.sky.selection).toBeUndefined()

		const body = handoff()
		showTargetInSky({ target: { kind: 'minorBody', spkId: '2000004', designation: '4' }, name: '4 Vesta' }, undefined, body)
		expect(body.sky.selection).toMatchObject({ ref: { kind: 'minorBody', spkId: '2000004', designation: '4' }, name: '4 Vesta', category: 'minorBody' })
		expect(body.clock).toEqual({ mode: 'fixed', anchor: 1000, startedAt: 0, rate: 1 })
	})
})

test('tonight is the evening of the night in progress in the zone of the location', () => {
	// 02:00 in São Paulo (05:00 UTC) still belongs to the evening before; 20:00 belongs to its own date.
	expect(tonight(Date.UTC(2026, 0, 16, 5), 'America/Sao_Paulo')).toBe('2026-01-15')
	expect(tonight(Date.UTC(2026, 0, 16, 23), 'America/Sao_Paulo')).toBe('2026-01-16')
})

test('minor bodies are the same by SPK-ID, whatever designation named them', () => {
	expect(sameTarget({ kind: 'minorBody', spkId: '1000012', designation: '1P' }, { kind: 'minorBody', spkId: '1000012', designation: '1P/Halley' })).toBe(true)
	expect(sameTarget({ kind: 'minorBody', spkId: '2000001', designation: '1' }, { kind: 'minorBody', spkId: '2000004', designation: '1' })).toBe(false)
})

describe('minor body search', () => {
	test('a search tells found, ambiguous, and not found apart, and keeps only the latest answer', async () => {
		const state = createObservingPlannerState()
		const answers: Record<string, unknown> = {
			vesta: { kind: 'found', body: { spkId: '2000004', designation: '4', name: '4 Vesta (A807 FA)' } },
			ceres: { kind: 'ambiguous', matches: [{ designation: '1', name: '1 Ceres' }] },
			none: { kind: 'notFound', message: 'No matches found.' },
		}
		const { io: value, requests } = io((url) => respond(answers[new URL(url, 'http://localhost').searchParams.get('q')!]))
		await searchMinorBody(state, 'vesta', value)
		expect(state.minorBodySearch).toMatchObject({ text: 'vesta', loading: false, result: answers.vesta })
		await searchMinorBody(state, 'ceres', value)
		expect(state.minorBodySearch.result).toEqual(answers.ceres as never)
		await searchMinorBody(state, 'none', value)
		expect(state.minorBodySearch.result).toEqual(answers.none as never)
		expect(requests.map((e) => e.url)).toEqual(['/api/sky/minorbodies/search?q=vesta', '/api/sky/minorbodies/search?q=ceres', '/api/sky/minorbodies/search?q=none'])
	})

	test('a failure is shown apart from no match', async () => {
		const state = createObservingPlannerState()
		await searchMinorBody(state, 'vesta', io(() => respond({ error: 'SBDB cannot be reached', code: 'serviceUnavailable' }, 503)).io)
		expect(state.minorBodySearch.result).toBeUndefined()
		expect(state.minorBodySearch.error).toBe('SBDB cannot be reached')
		expect(state.minorBodySearch.loading).toBe(false)
	})
})
