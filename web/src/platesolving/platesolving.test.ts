import { describe, expect, test } from 'bun:test'
import type { PlateSolveJob, PlateSolveResult } from 'api'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { proxy } from 'valtio'
import {
	completedJobs,
	effectivePlateSolveRequest,
	handlePlateSolvingEvent,
	latestJob,
	loadPlateSolveResult,
	loadSolutions,
	mountSyncBlocker,
	mountSyncSupport,
	mountSyncTarget,
	plateSolveSettings,
	type PlateSolvingState,
	refreshPlateSolving,
	runPlateSolve,
	selectedJob,
	selectedSolution,
	solutionOptions,
} from './platesolving'

test('a camera tab solves with the settings of its camera and the hints of its document', () => {
	const hints = { rightAscension: 1, declination: 0.5 }
	const camera = { provider: 'nova', strategy: 'blind', downsample: 2, scaleTolerance: 0.3 } as const
	expect(effectivePlateSolveRequest({ provider: 'astap', strategy: 'assisted', downsample: 4, hints }, camera)).toEqual({ ...camera, hints })
	expect(effectivePlateSolveRequest({ provider: 'astap', strategy: 'assisted' }, camera)).toEqual(camera)
})

test('any other document keeps its own request', () => {
	const request = { provider: 'astap', strategy: 'assisted', downsample: 4 } as const
	expect(effectivePlateSolveRequest(request, undefined)).toBe(request)
})

test('the settings of a request leave its hints out', () => {
	expect(plateSolveSettings({ provider: 'nova', strategy: 'blind', scaleTolerance: 0.3, hints: { rightAscension: 1 } })).toEqual({ provider: 'nova', strategy: 'blind', scaleTolerance: 0.3 })
})

function state(): PlateSolvingState {
	return proxy<PlateSolvingState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {}, headers: {}, hints: {} })
}

function job(patch: Partial<PlateSolveJob> = {}): PlateSolveJob {
	return { jobId: 'j1', imageId: 'i1', origin: { kind: 'manual' }, request: { provider: 'astap', strategy: 'assisted' }, hints: {}, state: 'queued', queuedAt: 1000, ...patch }
}

const SOLUTION = { CTYPE1: 'RA---TAN', rightAscension: 1, declination: 0.5, scale: 1e-5 } as unknown as PlateSolution

function result(patch: Partial<PlateSolveResult> = {}): PlateSolveResult {
	return { jobId: 'j1', imageId: 'i1', request: { provider: 'astap', strategy: 'assisted' }, hints: {}, tool: { executable: 'astap', timeout: 1000 }, outcome: 'solved', solution: SOLUTION, widthInPixels: 100, heightInPixels: 50, elapsed: 10, queueTime: 0, warnings: [], ...patch }
}

// Fetch fake mapping each URL to a status and a body, recording the URLs requested.
function fetcher(responses: Record<string, readonly [number, unknown]>) {
	const urls: string[] = []
	const request = ((url: string) => {
		urls.push(url)
		const [status, body] = responses[url] ?? [404, { error: 'Not found' }]
		return Promise.resolve(Response.json(body, { status }))
	}) as typeof fetch
	return { urls, request }
}

describe('jobs', () => {
	test('events keep the latest job of each image', () => {
		const s = state()
		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job() })
		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ jobId: 'j2', queuedAt: 2000 }) })
		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ state: 'completed' }) })

		expect(latestJob(s, 'i1')?.jobId).toBe('j2')
		expect(completedJobs(s, 'i1').map((known) => known.jobId)).toEqual(['j1'])
	})

	test('a submission becomes the latest job, even an equivalent earlier one', async () => {
		const s = state()
		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ jobId: 'j2', queuedAt: 2000 }) })
		const { request } = fetcher({ '/api/images/i1/plate-solving': [200, job({ state: 'completed' })] })

		const submitted = await runPlateSolve(s, 'i1', { provider: 'astap', strategy: 'assisted' }, request)

		expect(submitted?.jobId).toBe('j1')
		expect(latestJob(s, 'i1')?.jobId).toBe('j1')
	})

	test('a snapshot fetched before the end of a job never takes it back, while a running job takes its latest stage', async () => {
		const s = state()
		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ state: 'running', stage: 'preparing' }) })
		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ state: 'running', stage: 'solving' }) })
		expect(latestJob(s, 'i1')?.stage).toBe('solving')

		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ state: 'completed' }) })
		await refreshPlateSolving(s, fetcher({ '/api/plate-solving': [200, { jobs: [job({ state: 'running', stage: 'solving' })] }] }).request)
		expect(latestJob(s, 'i1')?.state).toBe('completed')
	})

	test('a refused submission is kept per image', async () => {
		const s = state()
		await runPlateSolve(s, 'i1', { provider: 'nova', strategy: 'blind' }, fetcher({ '/api/images/i1/plate-solving': [422, { error: 'Not configured' }] }).request)
		expect(s.submitErrors.i1).toBe('Not configured')
	})

	test('the snapshot fills the store', async () => {
		const s = state()
		await refreshPlateSolving(s, fetcher({ '/api/plate-solving': [200, { jobs: [job(), job({ jobId: 'j3', imageId: 'i2' })] }] }).request)
		expect(Object.keys(s.latest).sort()).toEqual(['i1', 'i2'])
	})
})

describe('solutions', () => {
	test('a late result stays with the image it solved', async () => {
		const s = state()
		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ state: 'completed' }) })
		const { urls, request } = fetcher({ '/api/plate-solving/j1/result': [200, result()] })

		await loadPlateSolveResult(s, 'j1', request)
		await loadPlateSolveResult(s, 'j1', request)

		expect(urls).toEqual(['/api/plate-solving/j1/result'])
		expect(selectedSolution(s, 'i1', undefined)).toEqual(SOLUTION)
		expect(selectedSolution(s, 'i2', undefined)).toBeUndefined()
		// A job of another image cannot be selected for this one.
		expect(selectedJob(s, 'i2', 'j1')).toBeUndefined()
	})

	test('a chosen job stays shown when a newer one ends', async () => {
		const s = state()
		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ state: 'completed' }) })
		await loadPlateSolveResult(s, 'j1', fetcher({ '/api/plate-solving/j1/result': [200, result()] }).request)
		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ jobId: 'j2', queuedAt: 2000, state: 'completed' }) })

		expect(selectedJob(s, 'i1', 'j1')?.jobId).toBe('j1')
		expect(selectedSolution(s, 'i1', 'j1')).toEqual(SOLUTION)
		expect(selectedJob(s, 'i1', undefined)?.jobId).toBe('j2')
	})

	test('the header solution is fetched once and chosen apart', async () => {
		const s = state()
		const { urls, request } = fetcher({ '/api/images/i1/plate-solutions': [200, { header: SOLUTION, jobs: [job({ jobId: 'old', state: 'completed', queuedAt: 10 })] }] })

		await loadSolutions(s, 'i1', request)
		await loadSolutions(s, 'i1', request)

		expect(urls).toHaveLength(1)
		expect(selectedSolution(s, 'i1', 'header')).toEqual(SOLUTION)
		expect(completedJobs(s, 'i1').map((known) => known.jobId)).toEqual(['old'])
	})

	test('a header solution can be chosen before any solve', async () => {
		const s = state()
		await loadSolutions(s, 'i1', fetcher({ '/api/images/i1/plate-solutions': [200, { header: SOLUTION, jobs: [] }] }).request)

		expect(selectedSolution(s, 'i1', undefined)).toBeUndefined()
		expect(solutionOptions(s, 'i1')).toEqual(['latest', 'header'])
	})

	test('solves are offered beside the header, newest first, and a single solve alone offers nothing', () => {
		const s = state()
		expect(solutionOptions(s, 'i1')).toEqual([])

		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ state: 'completed' }) })
		expect(solutionOptions(s, 'i1')).toEqual([])

		handlePlateSolvingEvent(s, { type: 'plateSolving:updated', job: job({ jobId: 'j2', queuedAt: 2000, state: 'completed' }) })
		expect(solutionOptions(s, 'i1')).toEqual(['latest', 'j2', 'j1'])

		s.headers.i1 = SOLUTION
		expect(solutionOptions(s, 'i1')).toEqual(['latest', 'header', 'j2', 'j1'])
	})

	test('an image without a header solution is remembered', async () => {
		const s = state()
		await loadSolutions(s, 'i1', fetcher({ '/api/images/i1/plate-solutions': [200, { jobs: [] }] }).request)

		expect(s.headers.i1).toBeNull()
		expect(selectedSolution(s, 'i1', 'header')).toBeUndefined()
	})
})

describe('mount sync', () => {
	test('sends the centre as J2000 decimal hours and degrees', () => {
		expect(mountSyncTarget({ rightAscension: Math.PI / 2, declination: -Math.PI / 4 })).toEqual({ frame: 'J2000', x: '6.000000', y: '-45.000000' })
		expect(mountSyncTarget({ rightAscension: -Math.PI / 2, declination: 0 }).x).toBe('18.000000')
	})

	test('is refused by a mount that cannot sync, is not ready, is parked, or is busy with a command', () => {
		const ready = { status: 'ready' } as const
		expect(mountSyncSupport({ canSync: false })).toBe('The mount cannot sync.')
		expect(mountSyncSupport({ canSync: true })).toBeUndefined()
		expect(mountSyncSupport(undefined)).toBeUndefined()
		expect(mountSyncBlocker({ status: 'notSelected', message: 'No Mount selected.' }, undefined, false)).toBe('No Mount selected.')
		expect(mountSyncBlocker(ready, undefined, false)).toBe('The mount state is not known yet.')
		expect(mountSyncBlocker(ready, { parked: true, parking: false }, false)).toBe('The mount is parked.')
		expect(mountSyncBlocker(ready, { parked: false, parking: false }, true)).toBe('A command of the mount is in flight.')
		expect(mountSyncBlocker(ready, { parked: false, parking: false }, false)).toBeUndefined()
	})
})
