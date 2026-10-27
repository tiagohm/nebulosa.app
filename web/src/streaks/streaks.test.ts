import { describe, expect, test } from 'bun:test'
import type { StreakDetectionJob, StreakDetectionResult } from 'api'
import type { Streak } from 'nebulosa/src/imaging/analysis/streak/types'
import { proxy } from 'valtio'
import { clampStreakSettings, DEFAULT_STREAK_SETTINGS, handleStreaksEvent, latestStreakJob, latestStreakResult, loadStreakResult, maxOrientationTolerance, pickStreak, refreshStreaks, runStreakDetection, sameStreakRequest, streakPlanes, streakSegments, type StreaksState } from './streaks'

function state(): StreaksState {
	return proxy<StreaksState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {} })
}

function job(patch: Partial<StreakDetectionJob> = {}): StreakDetectionJob {
	return { jobId: 'job-1', imageId: 'image-1', request: { settings: DEFAULT_STREAK_SETTINGS }, context: {}, state: 'queued', queuedAt: 1000, ...patch }
}

function streak(start: { x: number; y: number }, end: { x: number; y: number }): Streak {
	const length = Math.hypot(end.x - start.x, end.y - start.y)
	return { start, end, center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, length, width: 2, angle: 0, linearity: 1, rmsResidual: 0, coverage: 1, supportPixels: 10, clippedAtBorder: false, flux: 1, meanSignal: 1, peakSignal: 1, confidence: 1 }
}

// Horizontal, vertical, diagonal, and short streaks.
const RESULT = { streaks: [streak({ x: 10, y: 10 }, { x: 90, y: 10 }), streak({ x: 50, y: 20 }, { x: 50, y: 80 }), streak({ x: 100, y: 100 }, { x: 140, y: 140 }), streak({ x: 200, y: 200 }, { x: 202, y: 200 })] } as const

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
	test('the latest job of an image follows its events, and an older job ending late never replaces it', () => {
		const streaks = state()
		handleStreaksEvent(streaks, { type: 'streaks:updated', job: job() })
		handleStreaksEvent(streaks, { type: 'streaks:updated', job: job({ jobId: 'job-2', queuedAt: 2000 }) })
		handleStreaksEvent(streaks, { type: 'streaks:updated', job: job({ state: 'completed' }) })

		expect(latestStreakJob(streaks, 'image-1')?.jobId).toBe('job-2')
		expect(streaks.jobs['job-1'].state).toBe('completed')
		expect(latestStreakJob(streaks, 'image-2')).toBeUndefined()
	})

	test('other events are ignored', () => {
		const streaks = state()
		handleStreaksEvent(streaks, { type: 'stars:updated', job: { jobId: 'x', imageId: 'image-1', origin: { kind: 'manual' }, request: { detector: { provider: 'builtin', maxStars: 1, minSNR: 0, searchRegion: 0 }, acceptance: { minSNR: 0, minHfd: 0, maxHfd: 0, edgeMargin: 0 } }, state: 'queued', queuedAt: 1 } })
		expect(streaks.jobs).toEqual({})
	})

	test('the snapshot is merged without undoing a submission', async () => {
		const streaks = state()
		const { request } = fetcher({ '/api/images/image-1/streaks': [200, job({ jobId: 'old', state: 'completed', queuedAt: 500 })], '/api/streaks': [200, { jobs: [job({ jobId: 'other', imageId: 'image-2' })] }] })

		await runStreakDetection(streaks, 'image-1', { settings: DEFAULT_STREAK_SETTINGS }, request)
		handleStreaksEvent(streaks, { type: 'streaks:updated', job: job({ jobId: 'old', state: 'completed', queuedAt: 500 }) })
		await refreshStreaks(streaks, request)

		// The answer of a submission is the latest job of the image even when older, such as an equivalent earlier job.
		expect(latestStreakJob(streaks, 'image-1')?.jobId).toBe('old')
		expect(latestStreakJob(streaks, 'image-2')?.jobId).toBe('other')
	})

	test('a refused submission is kept as the error of the image', async () => {
		const streaks = state()
		const { request } = fetcher({ '/api/images/image-1/streaks': [422, { error: 'The detected stars are not available for this image', code: 'contextUnavailable' }] })

		await runStreakDetection(streaks, 'image-1', { settings: DEFAULT_STREAK_SETTINGS, starDetectionJobId: 'gone' }, request)
		expect(streaks.submitErrors['image-1']).toBe('The detected stars are not available for this image')
		expect(latestStreakJob(streaks, 'image-1')).toBeUndefined()
	})

	test('the result of a completed job is fetched once and only shown for its image', async () => {
		const streaks = state()
		const result = { jobId: 'job-1', imageId: 'image-1', streaks: [] } as unknown as StreakDetectionResult
		const { request, calls } = fetcher({ '/api/streaks/job-1/result': [200, result] })
		handleStreaksEvent(streaks, { type: 'streaks:updated', job: job({ state: 'completed' }) })

		await loadStreakResult(streaks, 'job-1', request)
		await loadStreakResult(streaks, 'job-1', request)
		expect(calls).toEqual(['/api/streaks/job-1/result'])
		expect(latestStreakResult(streaks, 'image-1')).toEqual(result)
		expect(latestStreakResult(streaks, 'image-2')).toBeUndefined()
	})

	test('requests differ by settings and by context jobs', () => {
		const request = { settings: DEFAULT_STREAK_SETTINGS }
		expect(sameStreakRequest(request, { settings: { ...DEFAULT_STREAK_SETTINGS } })).toBeTrue()
		expect(sameStreakRequest(request, { settings: { ...DEFAULT_STREAK_SETTINGS, minSNR: 6 } })).toBeFalse()
		expect(sameStreakRequest(request, { ...request, plateSolveJobId: 'p' })).toBeFalse()
		expect(sameStreakRequest(request, { ...request, starDetectionJobId: 's' })).toBeFalse()
	})
})

describe('settings', () => {
	test('are kept within the ranges of the toolkit', () => {
		const clamped = clampStreakSettings({ ...DEFAULT_STREAK_SETTINGS, minLength: 0, maxWidth: 1000, minLinearity: 2, minCoverage: 1.5, minCoherence: -0.1, maxStreaks: 10.4, backgroundCellSize: 2, minSNR: Number.NaN })
		expect(clamped).toEqual({ ...DEFAULT_STREAK_SETTINGS, minLength: 1, maxWidth: 256, minLinearity: 1, minCoverage: 1, minCoherence: 0, maxStreaks: 10, backgroundCellSize: 8 })
	})

	test('keep the orientation tolerance within the voting budget of the angle step', () => {
		expect(maxOrientationTolerance(Math.PI / 90)).toBeCloseTo((16 * Math.PI) / 90, 9)
		expect(maxOrientationTolerance(Math.PI / 4)).toBe(Math.PI / 2)
		expect(clampStreakSettings({ ...DEFAULT_STREAK_SETTINGS, angleStep: Math.PI / 1800, orientationTolerance: Math.PI / 2 }).orientationTolerance).toBeCloseTo((16 * Math.PI) / 1800, 9)
		expect(clampStreakSettings(DEFAULT_STREAK_SETTINGS)).toEqual(DEFAULT_STREAK_SETTINGS)
	})

	test('planes follow the layout of the image', () => {
		expect(streakPlanes(1, false)).toEqual(['auto', 'mono'])
		expect(streakPlanes(3, false)).toEqual(['auto', 'red', 'green', 'blue'])
		expect(streakPlanes(1, true)).toEqual(['auto', 'red', 'green1', 'green2', 'blue'])
	})
})

describe('overlay geometry', () => {
	test('picks the closest segment, its endpoints at pixel centres', () => {
		expect(pickStreak(RESULT, { x: 50.5, y: 13 }, 4)).toBe(0)
		expect(pickStreak(RESULT, { x: 52, y: 60 }, 4)).toBe(1)
		expect(pickStreak(RESULT, { x: 121, y: 120 }, 4)).toBe(2)
		expect(pickStreak(RESULT, { x: 201.5, y: 201 }, 4)).toBe(3)
		// Beyond the end of the horizontal streak.
		expect(pickStreak(RESULT, { x: 96, y: 10.5 }, 4)).toBeUndefined()
		expect(pickStreak(RESULT, { x: 180, y: 50 }, 4)).toBeUndefined()
	})

	test('a tie goes to the selected streak, then to the first one', () => {
		const crossing = { streaks: [streak({ x: 0, y: 10 }, { x: 20, y: 10 }), streak({ x: 10, y: 0 }, { x: 10, y: 20 })] }
		expect(pickStreak(crossing, { x: 10.5, y: 10.5 }, 4)).toBe(0)
		expect(pickStreak(crossing, { x: 10.5, y: 10.5 }, 4, 1)).toBe(1)
	})

	test('keeps the segments in view, in the order of the result', () => {
		expect(streakSegments(RESULT, { x: 0, y: 0, width: 110, height: 110 }).map((segment) => segment.index)).toEqual([0, 1, 2])
		expect(streakSegments(RESULT, { x: 0, y: 0, width: 100, height: 100 }).map((segment) => segment.index)).toEqual([0, 1])
		expect(streakSegments(RESULT, { x: 0, y: 0, width: 100, height: 100 }, 1).map((segment) => segment.index)).toEqual([0, 1, 2])
		expect(streakSegments(RESULT, { x: 150, y: 150, width: 100, height: 100 }).map((segment) => segment.index)).toEqual([3])
		expect(streakSegments(RESULT, { x: 141, y: 0, width: 10, height: 10 }, 0)).toEqual([])
		expect(streakSegments(RESULT, { x: 0, y: 0, width: 20, height: 20 })[0]).toEqual({ index: 0, start: { x: 10.5, y: 10.5 }, end: { x: 90.5, y: 10.5 } })
	})
})
