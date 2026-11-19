import { describe, expect, test } from 'bun:test'
import type { ObservingCandidate, ObservingConstraints, ObservingDiscoveryPage, ObservingPlan, SkyObjectRef } from 'api'
import { proxy } from 'valtio'
import type { RouteState } from '../../shell/route'
import type { SkyClock } from '../../sky/clock'
import type { SkyImageState } from '../../sky/footprint'
import { plannerTarget } from '../../sky/ObjectActions'
import type { SkyIo, SkyState } from '../../sky/sky'
import {
	addToObservingPlanner,
	conflictSentence,
	createObservingPlannerState,
	defaultPlanFor,
	defaultSampleIndex,
	discardDraft,
	discover,
	discoveryStale,
	editPlan,
	handleObservingPlanEvent,
	type ObservingPlannerIo,
	type ObservingPlansState,
	overwritePlan,
	planDocument,
	planLabel,
	planSaveStatus,
	refreshObservingPlans,
	sameTarget,
	searchMinorBody,
	sortCandidates,
	showTargetInSky,
	tonight,
} from './observingplanner'

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

describe('stale results', () => {
	test('a discovery goes stale when the night, the constraints, the filter, or the place changes, and its next batch is not read', async () => {
		const state = createObservingPlannerState()
		state.eveningDate = '2026-01-15'
		state.constraints = { ...CONSTRAINTS }
		const { io: fake, requests } = io(() => respond({ candidates: [candidate(1, 50)], evaluated: 100, total: 250, nextCursor: 'c1', modelVersion: 1 }))
		await discover(state, SITE, false, fake)
		expect(discoveryStale(state, SITE)).toBe(false)

		state.constraints = { ...CONSTRAINTS, minimumAltitude: 0.6 }
		expect(discoveryStale(state, SITE)).toBe(true)
		await discover(state, SITE, true, fake)
		expect(requests).toHaveLength(1)

		state.constraints = { ...CONSTRAINTS }
		expect(discoveryStale(state, SITE)).toBe(false)
		state.filter.text = 'M 42'
		expect(discoveryStale(state, SITE)).toBe(true)
		state.filter.text = ''
		expect(discoveryStale(state, { ...SITE, latitude: 10 })).toBe(true)
		expect(discoveryStale(state, undefined)).toBe(true)
		expect(discoveryStale(createObservingPlannerState(), SITE)).toBe(false)
	})
})

describe('plan choice and saving', () => {
	test('a target is proposed for the plan of the tool night at its place, else of its night, else a new plan', () => {
		const elsewhere = { ...plan('elsewhere', 1), site: { ...SITE, latitude: 10 } }
		const here = plan('here', 1)
		const other = { ...plan('other', 1), eveningDate: '2026-01-10' }
		expect(defaultPlanFor([other, elsewhere, here], SITE, '2026-01-15')).toBe('here')
		expect(defaultPlanFor([other, elsewhere], SITE, '2026-01-15')).toBe('elsewhere')
		expect(defaultPlanFor([other], SITE, '2026-01-15')).toBeUndefined()
		expect(defaultPlanFor([here], SITE, undefined)).toBeUndefined()
	})

	test('a plan reads saving while a draft waits or is written, and saved once it is written', async () => {
		const state = plansState()
		state.plans.a = plan('a', 1)
		expect(planSaveStatus(state, 'a')).toBe('saved')
		const { io: fake, flush } = io(() => respond(plan('a', 2)))
		editPlan(state, 'a', (document) => ({ ...document, name: 'Two' }), fake)
		expect(planSaveStatus(state, 'a')).toBe('saving')
		flush()
		await Bun.sleep(0)
		expect(planSaveStatus(state, 'a')).toBe('saved')
		state.errors.a = 'Disk full'
		expect(planSaveStatus(state, 'a')).toBe('failed')
		state.conflicts.a = null
		expect(planSaveStatus(state, 'a')).toBe('conflict')
	})
})

describe('candidate order', () => {
	test('candidates sort by each quantity, unknown magnitudes and sizes last, and the score order is the server ranking', () => {
		const a = { ...candidate(1, 90), name: 'Beta', magnitude: 6, majorAxis: 0.001, bestAt: 3, longestWindowMs: 1 }
		const b = { ...candidate(2, 80), name: 'alpha', magnitude: undefined, majorAxis: 0.01, bestAt: 1, longestWindowMs: 3 }
		const c = { ...candidate(3, 70), name: 'Gamma', magnitude: 4, majorAxis: undefined, bestAt: 2, longestWindowMs: 2 }
		const ids = (sort: Parameters<typeof sortCandidates>[1]) => sortCandidates([a, b, c], sort).map((e) => (e.target as { id: number }).id)
		expect(ids({ key: 'score', reversed: false })).toEqual([1, 2, 3])
		expect(ids({ key: 'score', reversed: true })).toEqual([3, 2, 1])
		expect(ids({ key: 'name', reversed: false })).toEqual([2, 1, 3])
		expect(ids({ key: 'magnitude', reversed: false })).toEqual([3, 1, 2])
		expect(ids({ key: 'magnitude', reversed: true })).toEqual([1, 3, 2])
		expect(ids({ key: 'size', reversed: false })).toEqual([2, 1, 3])
		expect(ids({ key: 'best', reversed: false })).toEqual([2, 3, 1])
		expect(ids({ key: 'longest', reversed: false })).toEqual([2, 3, 1])
	})

	test('equal scores are ordered by framing, an unknown fit counting as good, and the Framing order puts unknown fits last', () => {
		// 99.9 and 99.6 both read 100, so they tie as the operator sees them.
		const tied = [candidate(1, 100), candidate(2, 99.9), candidate(3, 99.6), candidate(4, 90)]
		const factors: Record<number, number | undefined> = { 1: 0.3, 2: undefined, 3: 1, 4: 1 }
		const fit = (e: { target: unknown }) => factors[(e.target as { id: number }).id]
		const ids = (key: 'score' | 'framing') => sortCandidates(tied, { key, reversed: false }, fit).map((e) => (e.target as { id: number }).id)
		expect(ids('score')).toEqual([2, 3, 1, 4])
		expect(ids('framing')).toEqual([3, 4, 1, 2])
	})
})

describe('plan wording', () => {
	test('an overlap names the other block, and a plan label adds its night only when the name lacks it', () => {
		const items = [{ id: 'a', targetName: 'M 42' }]
		expect(conflictSentence({ code: 'overlapsItem', itemId: 'a' }, items)).toBe('Overlaps the block of M 42.')
		expect(conflictSentence({ code: 'overlapsItem', itemId: 'gone' }, items)).toBe('Overlaps another block.')
		expect(conflictSentence({ code: 'outsideNight' }, items)).toBe('The block is outside the night.')
		expect(planLabel({ name: 'Night of 2026-11-16', eveningDate: '2026-11-16' })).toBe('Night of 2026-11-16')
		expect(planLabel({ name: 'Orion', eveningDate: '2026-11-16' })).toBe('Orion · 2026-11-16')
	})
})

describe('chart readout', () => {
	const night = { display: { start: 0, end: 10 * 3_600_000 } }
	const samples = Array.from({ length: 61 }, (_, i) => ({ time: i * 600_000 }))

	test('an analysis opens on now during its night, else on the best instant of its best window, else on its culmination', () => {
		const windows = [
			{ start: 0, end: 1, durationMs: 1, bestAt: 3_600_000, bestScore: 40 },
			{ start: 2, end: 3, durationMs: 1, bestAt: 7_200_000, bestScore: 90 },
		]
		const analysis = { samples, night, windows, summary: { culminationAt: 18_000_000 } } as unknown as Parameters<typeof defaultSampleIndex>[0]
		expect(defaultSampleIndex(analysis, 5 * 3_600_000 + 100_000)).toBe(30)
		expect(defaultSampleIndex(analysis, 20 * 3_600_000)).toBe(12)
		expect(defaultSampleIndex({ ...analysis, windows: [] }, -1)).toBe(30)
		expect(defaultSampleIndex({ ...analysis, windows: [], summary: {} } as unknown as typeof analysis, -1)).toBe(0)
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

	test('the Sky adds catalog objects, bodies, minor bodies, and the Sky point but the Sun and other kinds', () => {
		const refs: SkyObjectRef[] = [
			{ kind: 'catalog', id: 1 },
			{ kind: 'body', code: '599' },
			{ kind: 'body', code: '10' },
			{ kind: 'minorBody', spkId: '1', designation: '1' },
			{ kind: 'constellation', code: 'ORI' },
			{ kind: 'coordinates', rightAscension: 1, declination: -0.5 },
		]
		expect(refs.map((ref) => plannerTarget(ref, 'Sky Point'))).toEqual([{ kind: 'catalog', id: 1 }, { kind: 'body', code: '599' }, undefined, { kind: 'minorBody', spkId: '1', designation: '1' }, undefined, { kind: 'coordinates', name: 'Sky Point', rightAscension: 1, declination: -0.5 }])
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
