import { describe, expect, test } from 'bun:test'
import type { ImageStackingSnapshot, StackingJobSummary } from 'api'
import { proxy } from 'valtio'
import { cancelStackingRun, framesQuery, handleImageStackingEvent, type ImageStackingRuntime, jobEnded, loadStackingPreflight, startStackingRun, loadStackingFrames, loadStackingProject, refreshImageStacking, separateStackingFilter, startStackingAnalysis, updateStackingCohort, updateStackingFrame } from './projects'

function runtime() {
	return proxy<ImageStackingRuntime>({ jobs: {}, changes: 0, loading: false, pending: {}, errors: {} })
}

function snapshot(epoch: string, revision: number, jobs: readonly StackingJobSummary[] = []): ImageStackingSnapshot {
	return { epoch, revision, projects: [], jobs }
}

function job(jobId: string, state: StackingJobSummary['state'], updatedAt: number): StackingJobSummary {
	return { jobId, projectId: 'p', type: 'import', state, createdAt: 1, updatedAt, found: 0, bytes: 0, truncated: false }
}

// A fetch answering JSON by URL prefix, the longest first, recording every call.
function fakeFetch(answers: Record<string, unknown>, status = 200) {
	const calls: { readonly url: string; readonly init?: RequestInit }[] = []
	const prefixes = Object.keys(answers).toSorted((a, b) => b.length - a.length)
	const request = ((url: string, init?: RequestInit) => {
		calls.push({ url, init })
		const prefix = prefixes.find((candidate) => url.startsWith(candidate))
		return Promise.resolve(prefix === undefined ? Response.json({ error: 'Unknown', code: 'notFound' }, { status: 404 }) : Response.json(answers[prefix], { status }))
	}) as typeof fetch
	return { request, calls }
}

describe('events', () => {
	test('a snapshot older than the one applied is dropped, and a new process replaces everything', () => {
		const state = runtime()
		handleImageStackingEvent(state, { type: 'imageStacking:changed', revision: 5, snapshot: snapshot('a', 5, [job('old', 'scanning', 1)]) })
		handleImageStackingEvent(state, { type: 'imageStacking:changed', revision: 4, snapshot: snapshot('a', 4) })
		expect(state.snapshot?.revision).toBe(5)
		expect(state.changes).toBe(1)

		handleImageStackingEvent(state, { type: 'imageStacking:changed', revision: 1, snapshot: snapshot('b', 1) })
		expect(state.snapshot?.epoch).toBe('b')
		expect(state.jobs.old).toBeUndefined()
	})

	test('a late job event never takes a job back', () => {
		const state = runtime()
		handleImageStackingEvent(state, { type: 'imageStacking:jobUpdated', epoch: 'a', revision: 2, job: job('j', 'completed', 20) })
		handleImageStackingEvent(state, { type: 'imageStacking:jobUpdated', epoch: 'a', revision: 1, job: job('j', 'scanning', 10) })
		expect(state.jobs.j.state).toBe('completed')
	})

	test('the snapshot is fetched, and an unreachable server leaves what is known', async () => {
		const state = runtime()
		await refreshImageStacking(state, fakeFetch({ '/api/image-stacking': snapshot('a', 3) }).request)
		expect(state.snapshot?.revision).toBe(3)
		await refreshImageStacking(state, (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch)
		expect(state.snapshot?.revision).toBe(3)
	})
})

describe('requests', () => {
	test('the frames query names the empty group explicitly and leaves absent filters out', () => {
		expect(framesQuery({}, 2)).toBe('offset=100&limit=50')
		expect(framesQuery({ group: '', included: false, search: 'm31' }, 0)).toBe('offset=0&limit=50&group=&included=false&search=m31')
	})

	test('a project, its groups, cohorts, validation, products, and runs are fetched together, and absent clears them', async () => {
		const state = runtime()
		const base = '/api/image-stacking/projects/p%201'
		const { request, calls } = fakeFetch({ [base + '/groups']: [{ key: 'ha' }], [base + '/cohorts']: [{ cohortId: 'c' }], [base + '/validation']: { findings: [], ready: true, samples: 0, memoryBytes: 0 }, [base + '/products']: [{ productId: 'm' }], [base + '/runs']: [], [base]: { projectId: 'p 1' } })
		await loadStackingProject(state, 'p 1', request)
		expect(calls.map(({ url }) => url)).toEqual([base, base + '/groups', base + '/cohorts', base + '/validation', base + '/products', base + '/runs'])
		expect(state.project?.projectId).toBe('p 1')
		expect([state.groups?.length, state.cohorts?.length, state.validation?.ready, state.products?.length, state.runs?.length]).toEqual([1, 1, true, 1, 0])
		await loadStackingProject(state, undefined, request)
		expect([state.project, state.groups, state.cohorts, state.validation, state.products, state.runs]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
	})

	test('runs keep their token, a preflight that fails keeps the last answer, and a run is followed until it ends', async () => {
		const state = runtime()
		const { request, calls } = fakeFetch({ '/api/image-stacking/projects/p/runs': { run: { runId: 'r' } }, '/api/image-stacking/projects/p/preflight': { groups: [], problems: ['x'] }, '/api/image-stacking/runs/r/cancel': {} })
		await startStackingRun(state, 'p', { token: 'once', recipe: { method: 'median' } }, request)
		await loadStackingPreflight(state, 'p', { recipe: { method: 'median' } }, request)
		await cancelStackingRun(state, 'r', request)
		expect(calls.map(({ url, init }) => [url, init?.method, typeof init?.body === 'string' ? JSON.parse(init.body) : undefined])).toEqual([
			['/api/image-stacking/projects/p/runs', 'POST', { token: 'once', recipe: { method: 'median' } }],
			['/api/image-stacking/projects/p/preflight', 'POST', { recipe: { method: 'median' } }],
			['/api/image-stacking/runs/r/cancel', 'POST', undefined],
		])
		expect(state.preflight?.problems).toEqual(['x'])
		await loadStackingPreflight(state, 'p', {}, fakeFetch({}).request)
		expect(state.preflight?.problems).toEqual(['x'])
		expect([jobEnded({ state: 'integrating' }), jobEnded({ state: 'completed' })]).toEqual([false, true])
	})

	test('cohort decisions and analyses reach their routes, and an analysis runs until it ends', async () => {
		const state = runtime()
		const { request, calls } = fakeFetch({ '/api/image-stacking/projects/p/cohorts/c%201': { cohortId: 'c 1' }, '/api/image-stacking/projects/p/analyses': { jobId: 'j' } })
		await updateStackingCohort(state, 'p', 'c 1', { calibration: { kind: 'none', reason: 'No flats yet' } }, request)
		await startStackingAnalysis(state, 'p', request)
		expect(calls.map(({ url, init }) => [url, init?.method])).toEqual([
			['/api/image-stacking/projects/p/cohorts/c%201', 'PATCH'],
			['/api/image-stacking/projects/p/analyses', 'POST'],
		])
		expect(JSON.parse(calls[0].init!.body as string)).toEqual({ calibration: { kind: 'none', reason: 'No flats yet' } })
		expect([jobEnded({ state: 'analyzing' }), jobEnded({ state: 'scanning' }), jobEnded({ state: 'cancelled' })]).toEqual([false, false, true])
	})

	test('a page that arrives after a newer request is dropped', async () => {
		const state = runtime()
		const { promise, resolve } = Promise.withResolvers<Response>()
		let first = true
		const request = (() => {
			if (first) {
				first = false
				return promise
			}
			return Promise.resolve(Response.json({ items: [], total: 2 }))
		}) as unknown as typeof fetch
		const slow = loadStackingFrames(state, 'p', { group: 'ha' }, 0, request)
		await loadStackingFrames(state, 'p', { group: 'oiii' }, 0, request)
		resolve(Response.json({ items: [], total: 1 }))
		await slow
		expect(state.frames?.total).toBe(2)
		expect(state.loading).toBeFalse()
	})

	test('a refused command keeps its reason by key, and an encoded filter key reaches its route', async () => {
		const state = runtime()
		const refused = fakeFetch({ '/api/image-stacking/frames/f': { error: 'Only a filter the header does not name can be declared', code: 'verifiedMetadata' } }, 409)
		expect(await updateStackingFrame(state, 'f', { filter: { value: 'Ha', reason: 'x' } }, refused.request)).toBeUndefined()
		expect(state.errors['frame:f']).toContain('does not name')
		expect(JSON.parse(refused.calls[0].init!.body as string)).toEqual({ filter: { value: 'Ha', reason: 'x' } })

		const { request, calls } = fakeFetch({ '/api/image-stacking/projects/p/aliases/': [] })
		expect(await separateStackingFilter(state, 'p', 'h alpha', request)).toEqual([])
		expect(calls[0]).toMatchObject({ url: '/api/image-stacking/projects/p/aliases/h%20alpha', init: { method: 'DELETE' } })
	})
})
