import { describe, expect, test } from 'bun:test'
import type { ImageStatisticsJob, ImageStatisticsReport } from 'api'
import { proxy } from 'valtio'
import { handleStatisticsEvent, latestStatistics, loadStatisticsResult, refreshStatistics, runStatistics, type StatisticsState, statisticsKey, statisticsView, submittedActive } from './statistics'
import { binAt, binRange, HISTOGRAM_HEIGHT, HISTOGRAM_MARGIN, HISTOGRAM_WIDTH, histogramPath, histogramRange, histogramScale, plotX, valueAt } from './statistics.plot'

function state(): StatisticsState {
	return proxy<StatisticsState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {}, submitted: {} })
}

function job(patch: Partial<ImageStatisticsJob> = {}): ImageStatisticsJob {
	return { jobId: 'job-1', imageId: 'image-1', request: {}, state: 'queued', queuedAt: 1000, ...patch }
}

const AREA = { left: 1, top: 2, width: 3, height: 4 }

// Fake fetch answering each URL with a status and a JSON body, recording the calls and their bodies.
function fetcher(responses: Record<string, readonly [number, unknown]>) {
	const calls: { readonly url: string; readonly body?: string }[] = []

	const request = ((input: string, init?: RequestInit) => {
		calls.push({ url: input, body: typeof init?.body === 'string' ? init.body : undefined })
		const [status, body] = responses[input] ?? [404, { error: 'Not found', code: 'notFound' }]
		return Promise.resolve(Response.json(body, { status }))
	}) as unknown as typeof fetch

	return { request, calls }
}

describe('jobs', () => {
	test('keys the latest job by image and area', () => {
		const statistics = state()
		handleStatisticsEvent(statistics, { type: 'statistics:updated', job: job() })
		handleStatisticsEvent(statistics, { type: 'statistics:updated', job: job({ jobId: 'job-2', request: { area: AREA }, queuedAt: 2000 }) })
		handleStatisticsEvent(statistics, { type: 'statistics:updated', job: job({ jobId: 'job-3', imageId: 'image-2', queuedAt: 3000 }) })

		expect(statisticsKey('image-1')).toBe('image-1:full')
		expect(statisticsKey('image-1', AREA)).toBe('image-1:1,2,3,4')
		expect(latestStatistics(statistics, 'image-1')?.jobId).toBe('job-1')
		expect(latestStatistics(statistics, 'image-1', AREA)?.jobId).toBe('job-2')
		expect(latestStatistics(statistics, 'image-2')?.jobId).toBe('job-3')
		expect(latestStatistics(statistics, 'image-2', AREA)).toBeUndefined()
	})

	test('an ended job is never taken back by a late snapshot', async () => {
		const statistics = state()
		handleStatisticsEvent(statistics, { type: 'statistics:updated', job: job({ state: 'completed' }) })
		await refreshStatistics(statistics, fetcher({ '/api/statistics': [200, { jobs: [job({ state: 'running' })] }] }).request)
		expect(statistics.jobs['job-1'].state).toBe('completed')
	})

	test('submits once per image and area and follows the job of the document', async () => {
		const statistics = state()
		const { request, calls } = fetcher({ '/api/images/image-1/statistics': [202, job({ request: { area: AREA } })] })
		await Promise.all([runStatistics(statistics, 'doc', 'image-1', AREA, request), runStatistics(statistics, 'doc', 'image-1', AREA, request)])

		expect(calls).toEqual([{ url: '/api/images/image-1/statistics', body: JSON.stringify({ area: AREA }) }])
		expect(latestStatistics(statistics, 'image-1', AREA)?.jobId).toBe('job-1')
		expect(submittedActive(statistics, 'doc')).toBeTrue()
		handleStatisticsEvent(statistics, { type: 'statistics:updated', job: job({ request: { area: AREA }, state: 'completed' }) })
		expect(submittedActive(statistics, 'doc')).toBeFalse()
	})

	test('keeps why a submission was refused', async () => {
		const statistics = state()
		await runStatistics(statistics, 'doc', 'image-1', undefined, fetcher({ '/api/images/image-1/statistics': [503, { error: 'Too many', code: 'queueFull' }] }).request)
		expect(statistics.submitErrors['image-1:full']).toBe('Too many')
	})

	test('fetches a result once', async () => {
		const statistics = state()
		const result = { jobId: 'job-1', imageId: 'image-1', planes: [] } as unknown as ImageStatisticsReport
		const { request, calls } = fetcher({ '/api/statistics/job-1/result': [200, result] })
		await Promise.all([loadStatisticsResult(statistics, 'job-1', request), loadStatisticsResult(statistics, 'job-1', request)])
		await loadStatisticsResult(statistics, 'job-1', request)
		expect(calls).toHaveLength(1)
		expect(statistics.results['job-1'].jobId).toBe('job-1')
	})
})

describe('view', () => {
	test('is due only while open, ready, unmeasured, and with no scan of the document running', () => {
		const statistics = state()
		expect(statisticsView(statistics, 'doc', 'image-1', undefined, false).due).toBeFalse()
		expect(statisticsView(statistics, 'doc', undefined, undefined, true).due).toBeFalse()
		expect(statisticsView(statistics, 'doc', 'image-1', undefined, true).due).toBeTrue()

		// A camera tab whose scan of the previous frame still runs waits for it.
		statistics.jobs['job-0'] = job({ jobId: 'job-0', imageId: 'frame-0', state: 'running' })
		statistics.submitted.doc = 'job-0'
		expect(statisticsView(statistics, 'doc', 'frame-1', undefined, true).due).toBeFalse()
		statistics.jobs['job-0'] = job({ jobId: 'job-0', imageId: 'frame-0', state: 'completed' })
		expect(statisticsView(statistics, 'doc', 'frame-1', undefined, true).due).toBeTrue()
	})

	test('shows only the result of the image and area shown, and never retries a failure by itself', () => {
		const statistics = state()
		const result = { jobId: 'job-1' } as unknown as ImageStatisticsReport
		statistics.jobs['job-1'] = job({ state: 'completed' })
		statistics.latest['image-1:full'] = 'job-1'
		statistics.results['job-1'] = result

		expect(statisticsView(statistics, 'doc', 'image-1', undefined, true)).toEqual({ job: statistics.jobs['job-1'], result, error: undefined, due: false })
		expect(statisticsView(statistics, 'doc', 'image-1', AREA, true).result).toBeUndefined()
		expect(statisticsView(statistics, 'doc', 'image-2', undefined, true).result).toBeUndefined()

		statistics.jobs['job-2'] = job({ jobId: 'job-2', imageId: 'image-2', state: 'failed', error: 'Broken' })
		statistics.latest['image-2:full'] = 'job-2'
		expect(statisticsView(statistics, 'doc', 'image-2', undefined, true)).toMatchObject({ error: 'Broken', due: false })
	})
})

describe('plot', () => {
	const series = { min: 0, max: 4, counts: [1, 3, 0, 2] }

	test('maps values to the plot box and back', () => {
		const scale = histogramScale([series], [0, 4], false)
		expect(scale.top).toBe(3)
		expect(plotX(0, scale)).toBe(HISTOGRAM_MARGIN)
		expect(plotX(4, scale)).toBe(HISTOGRAM_WIDTH - HISTOGRAM_MARGIN)
		expect(valueAt(plotX(2.5, scale), scale)).toBeCloseTo(2.5, 12)
		expect(histogramScale([series], [0, 4], true).top).toBeCloseTo(Math.log10(4), 12)
	})

	test('draws each bin as a step from the baseline', () => {
		const path = histogramPath(series, histogramScale([series], [0, 4], false))
		const base = HISTOGRAM_HEIGHT - HISTOGRAM_MARGIN
		expect(path.startsWith(`M${HISTOGRAM_MARGIN} ${base}V`)).toBeTrue()
		expect(path.endsWith(`V${base}`)).toBeTrue()
		expect(path.match(/H/g)).toHaveLength(4)
		expect(histogramPath(series, histogramScale([series], [10, 20], false))).toBe('')
	})

	test('finds bins and ranges, a single-valued domain in bin 0', () => {
		expect(binRange(series, 1)).toEqual([1, 2])
		expect(binAt(series, 0)).toBe(0)
		expect(binAt(series, 1.5)).toBe(1)
		expect(binAt(series, 4)).toBe(3)
		expect(binAt(series, 4.1)).toBeUndefined()
		const constant = { min: 7, max: 7, counts: [9, 0] }
		expect(binAt(constant, 7)).toBe(0)
		expect(histogramRange([constant])[0]).toBeLessThan(7)
		expect(histogramRange([constant])[1]).toBeGreaterThan(7)
		expect(histogramPath(constant, histogramScale([constant], histogramRange([constant]), false))).toMatch(/^M[\d.]+ [\d.]+V[\d.]+$/)
		expect(histogramRange([series, { min: -1, max: 2, counts: [1] }])).toEqual([-1, 4])
	})
})
