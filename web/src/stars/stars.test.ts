import { describe, expect, test } from 'bun:test'
import type { StarDetectionJob, StarDetectionResult } from 'api'
import { proxy } from 'valtio'
import { DEFAULT_ASTAP_SETTINGS, DEFAULT_STAR_REQUEST, handleStarsEvent, latestJob, latestResult, loadResult, markerRadius, pickStar, refreshStars, runDetection, sameRequest, starPaths, type StarsState } from './stars'

function state(): StarsState {
	return proxy<StarsState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {} })
}

function job(patch: Partial<StarDetectionJob> = {}): StarDetectionJob {
	return { jobId: 'job-1', imageId: 'image-1', origin: { kind: 'manual' }, request: DEFAULT_STAR_REQUEST, state: 'queued', queuedAt: 1000, ...patch }
}

const RESULT = {
	stars: [
		{ x: 10, y: 10, hfd: 3, snr: 20, flux: 100 },
		{ x: 50, y: 20, hfd: 2, snr: 5, flux: 50 },
		{ x: 12, y: 11, hfd: 4, snr: 30, flux: 200 },
	],
	accepted: [true, false, true],
} as const

// Fake fetch answering each URL with a status and a JSON body.
function fetcher(responses: Record<string, readonly [number, unknown]>) {
	const calls: string[] = []

	const request = ((input: string) => {
		calls.push(input)
		const [status, body] = responses[input] ?? [404, { error: 'Not found' }]
		return Promise.resolve(Response.json(body, { status }))
	}) as unknown as typeof fetch

	return { request, calls }
}

describe('jobs', () => {
	test('the latest job of an image follows its events', () => {
		const stars = state()
		handleStarsEvent(stars, { type: 'stars:updated', job: job() })
		handleStarsEvent(stars, { type: 'stars:updated', job: job({ state: 'running' }) })
		expect(latestJob(stars, 'image-1')?.state).toBe('running')

		handleStarsEvent(stars, { type: 'stars:updated', job: job({ jobId: 'job-2', queuedAt: 2000 }) })
		expect(latestJob(stars, 'image-1')?.jobId).toBe('job-2')

		// An older job ending late never replaces the newer one of its image.
		handleStarsEvent(stars, { type: 'stars:updated', job: job({ state: 'completed' }) })
		expect(latestJob(stars, 'image-1')?.jobId).toBe('job-2')
		expect(stars.jobs['job-1'].state).toBe('completed')
	})

	test('jobs of other images never change the latest job of an image', () => {
		const stars = state()
		handleStarsEvent(stars, { type: 'stars:updated', job: job() })
		handleStarsEvent(stars, { type: 'stars:updated', job: job({ jobId: 'job-2', imageId: 'image-2', queuedAt: 5000 }) })

		expect(latestJob(stars, 'image-1')?.jobId).toBe('job-1')
		expect(latestJob(stars, 'image-2')?.jobId).toBe('job-2')
		expect(latestJob(stars, 'image-3')).toBeUndefined()
	})

	test('the snapshot restores the jobs after a reconnection', async () => {
		const stars = state()
		const { request } = fetcher({ '/api/stars': [200, { jobs: [job({ state: 'completed' }), job({ jobId: 'job-2', imageId: 'image-2' })] }] })
		await refreshStars(stars, request)

		expect(latestJob(stars, 'image-1')?.state).toBe('completed')
		expect(latestJob(stars, 'image-2')?.jobId).toBe('job-2')
	})

	test('a submission becomes the latest job, and a refusal is kept', async () => {
		const stars = state()
		const { request, calls } = fetcher({ '/api/images/image-1/stars': [202, job()], '/api/images/image-2/stars': [422, { error: 'ASTAP is not configured' }] })
		await runDetection(stars, 'image-1', DEFAULT_STAR_REQUEST, request)
		await runDetection(stars, 'image-2', DEFAULT_STAR_REQUEST, request)

		expect(calls).toEqual(['/api/images/image-1/stars', '/api/images/image-2/stars'])
		expect(latestJob(stars, 'image-1')?.jobId).toBe('job-1')
		expect(stars.submitErrors['image-2']).toBe('ASTAP is not configured')
	})

	test('the result of a completed job is fetched once and matched to its image', async () => {
		const stars = state()
		const result = { ...RESULT, jobId: 'job-1', imageId: 'image-1' } as unknown as StarDetectionResult
		const { request, calls } = fetcher({ '/api/stars/job-1/result': [200, result], '/api/stars/job-2/result': [404, { error: 'The result is not available' }] })
		handleStarsEvent(stars, { type: 'stars:updated', job: job({ state: 'completed' }) })

		await loadResult(stars, 'job-1', request)
		await loadResult(stars, 'job-1', request)
		await loadResult(stars, 'job-2', request)

		expect(calls).toEqual(['/api/stars/job-1/result', '/api/stars/job-2/result'])
		expect(latestResult(stars, 'image-1')?.stars).toHaveLength(3)
		expect(latestResult(stars, 'image-2')).toBeUndefined()
		expect(stars.resultErrors['job-2']).toBe('The result is not available')
	})

	test('compares requests field by field', () => {
		expect(sameRequest(DEFAULT_STAR_REQUEST, { detector: { ...DEFAULT_STAR_REQUEST.detector }, acceptance: { ...DEFAULT_STAR_REQUEST.acceptance } })).toBeTrue()
		expect(sameRequest(DEFAULT_STAR_REQUEST, { ...DEFAULT_STAR_REQUEST, detector: DEFAULT_ASTAP_SETTINGS })).toBeFalse()
		expect(sameRequest(DEFAULT_STAR_REQUEST, { ...DEFAULT_STAR_REQUEST, acceptance: { ...DEFAULT_STAR_REQUEST.acceptance, minHfd: 1 } })).toBeFalse()
	})
})

describe('overlay geometry', () => {
	test('picks the closest star centre within the radius, at pixel centres', () => {
		expect(pickStar(RESULT, { x: 10.5, y: 10.5 }, 2, false)).toBe(0)
		expect(pickStar(RESULT, { x: 12.4, y: 11.6 }, 2, false)).toBe(2)
		expect(pickStar(RESULT, { x: 30, y: 30 }, 2, false)).toBeUndefined()
		expect(pickStar(RESULT, { x: 50.5, y: 20.5 }, 2, false)).toBe(1)
		expect(pickStar(RESULT, { x: 50.5, y: 20.5 }, 2, true)).toBeUndefined()
	})

	test('draws one path per class, only for the stars in view', () => {
		const all = starPaths(RESULT, false, { x: 0, y: 0, width: 100, height: 100 }, 1)
		expect(all.accepted.match(/M/g)).toHaveLength(2)
		expect(all.rejected.match(/M/g)).toHaveLength(1)

		expect(starPaths(RESULT, true, { x: 0, y: 0, width: 100, height: 100 }, 1).rejected).toBe('')
		const corner = starPaths(RESULT, false, { x: 40, y: 0, width: 60, height: 100 }, 1)
		expect(corner.accepted).toBe('')
		expect(corner.rejected.match(/M/g)).toHaveLength(1)
	})

	test('marker circles are centred on the pixel and never smaller than the minimum', () => {
		const { accepted } = starPaths({ stars: [RESULT.stars[0]], accepted: [true] }, false, { x: 0, y: 0, width: 100, height: 100 }, 1)
		expect(accepted.startsWith('M7.50 10.50a3.00 3.00')).toBeTrue()
		expect(markerRadius(3, 5)).toBe(5)
		expect(markerRadius(Number.NaN, 5)).toBe(5)
		expect(markerRadius(8, 5)).toBe(8)
	})
})
