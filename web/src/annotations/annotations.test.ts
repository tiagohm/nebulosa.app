import { describe, expect, test } from 'bun:test'
import type { AnnotationJob, AnnotationRequest, AnnotationResult } from 'api'
import { proxy } from 'valtio'
import {
	annotationKey,
	annotationMatchesWcs,
	annotationPlateSolveJobId,
	annotationRequest,
	type AnnotationsState,
	handleAnnotationsEvent,
	latestAnnotationJob,
	latestAnnotationResult,
	loadAnnotationContext,
	loadAnnotationResult,
	minorBodyQuery,
	parseUtcInput,
	refreshAnnotations,
	resolveMinorBody,
	runAnnotation,
	sameAnnotationRequest,
	utcInputValue,
} from './annotations'

const REQUEST: AnnotationRequest = { kind: 'local', magnitudeLimit: 12 }

function state(): AnnotationsState {
	return proxy<AnnotationsState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {}, contexts: {} })
}

function job(patch: Partial<AnnotationJob> = {}): AnnotationJob {
	return { jobId: 'job-1', imageId: 'image-1', request: REQUEST, wcs: { source: 'header' }, state: 'queued', queuedAt: 1000, ...patch }
}

// Fake fetch answering each URL with a status and a JSON body.
function fetcher(responses: Record<string, readonly [number, unknown]>) {
	const calls: { url: string; body?: unknown }[] = []

	const request = ((input: string, init?: RequestInit) => {
		calls.push({ url: input, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
		const [status, body] = responses[input] ?? [404, { error: 'Not found' }]
		return Promise.resolve(Response.json(body, { status }))
	}) as unknown as typeof fetch

	return { request, calls }
}

describe('jobs', () => {
	test('the latest job of an image follows its events, and an older job ending late never replaces it', () => {
		const annotations = state()
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job() })
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ jobId: 'job-2', queuedAt: 2000 }) })
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ state: 'completed' }) })

		expect(latestAnnotationJob(annotations, 'image-1')?.jobId).toBe('job-2')
		expect(annotations.jobs['job-1'].state).toBe('completed')
	})

	test('a submission becomes the latest job, and a refusal is kept', async () => {
		const annotations = state()
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ jobId: 'newer', queuedAt: 5000 }) })
		const { request, calls } = fetcher({ '/api/images/image-1/annotations': [200, job({ state: 'completed' })] })
		await runAnnotation(annotations, 'image-1', REQUEST, request)

		expect(calls).toEqual([{ url: '/api/images/image-1/annotations', body: REQUEST }])
		expect(latestAnnotationJob(annotations, 'image-1')?.jobId).toBe('job-1')

		await runAnnotation(annotations, 'image-2', REQUEST, fetcher({ '/api/images/image-2/annotations': [422, { error: 'No WCS', code: 'contextUnavailable' }] }).request)
		expect(annotations.submitErrors[annotationKey('image-2', 'local')]).toBe('No WCS')
	})

	test('the snapshot and the result of the latest completed job', async () => {
		const annotations = state()
		const completed = job({ state: 'completed' })
		await refreshAnnotations(annotations, fetcher({ '/api/annotations': [200, { jobs: [completed] }] }).request)
		expect(latestAnnotationResult(annotations, 'image-1')).toBeUndefined()

		const { request, calls } = fetcher({ '/api/annotations/job-1/result': [200, { jobId: 'job-1', imageId: 'image-1', objects: [] }] })
		await loadAnnotationResult(annotations, 'job-1', request)
		await loadAnnotationResult(annotations, 'job-1', request)
		expect(calls).toHaveLength(1)
		expect(latestAnnotationResult(annotations, 'image-1')?.jobId).toBe('job-1')

		await loadAnnotationResult(annotations, 'job-9', fetcher({}).request)
		expect(annotations.resultErrors['job-9']).toBe('Not found')
	})
})

describe('requests and WCS', () => {
	test('equivalent requests', () => {
		expect(sameAnnotationRequest(REQUEST, { ...REQUEST })).toBeTrue()
		expect(sameAnnotationRequest(REQUEST, { ...REQUEST, plateSolveJobId: 'p' })).toBeFalse()
		expect(sameAnnotationRequest(REQUEST, { ...REQUEST, magnitudeLimit: 10 })).toBeFalse()
		expect(sameAnnotationRequest({ ...REQUEST, observer: { latitude: 1, longitude: 2, elevation: 3 } }, { ...REQUEST, observer: { latitude: 1, longitude: 2, elevation: 3 } })).toBeTrue()
		expect(sameAnnotationRequest({ ...REQUEST, observer: { latitude: 1, longitude: 2, elevation: 3 } }, REQUEST)).toBeFalse()
	})

	test('a result is drawn only with the WCS it was computed with', () => {
		expect(annotationPlateSolveJobId({ job: { jobId: 'p' }, solution: {} })).toBe('p')
		expect(annotationPlateSolveJobId({ job: { jobId: 'p' } })).toBeUndefined()
		expect(annotationPlateSolveJobId({ solution: {} })).toBeUndefined()

		const header = { request: REQUEST } as Pick<AnnotationResult, 'request'>
		const solved = { request: { ...REQUEST, plateSolveJobId: 'p' } } as Pick<AnnotationResult, 'request'>
		expect(annotationMatchesWcs(header, undefined)).toBeTrue()
		expect(annotationMatchesWcs(header, 'p')).toBeFalse()
		expect(annotationMatchesWcs(solved, 'p')).toBeTrue()
		expect(annotationMatchesWcs(solved, 'q')).toBeFalse()
	})
})

describe('next run', () => {
	test('the request sends the time and only the position of the observer', () => {
		expect(annotationRequest({ magnitudeLimit: 10 })).toEqual({ kind: 'local', magnitudeLimit: 10 })
		const observer = { name: 'Backyard', latitude: -23.5, longitude: -46.6, elevation: 760, timeZone: 'America/Sao_Paulo' }
		expect(annotationRequest({ magnitudeLimit: 10, plateSolveJobId: 'p', time: 1000, observer })).toEqual({ kind: 'local', magnitudeLimit: 10, plateSolveJobId: 'p', time: 1000, observer: { latitude: -23.5, longitude: -46.6, elevation: 760 } })
	})

	test('UTC date-times of the time input', () => {
		const time = Date.UTC(2026, 0, 15, 2, 0, 30)
		expect(utcInputValue(time)).toBe('2026-01-15T02:00:30')
		expect(parseUtcInput('2026-01-15T02:00:30')).toBe(time)
		expect(parseUtcInput('2026-01-15T02:00')).toBe(Date.UTC(2026, 0, 15, 2))
		expect(parseUtcInput('')).toBeUndefined()
		expect(parseUtcInput('2026-01-15')).toBeUndefined()
		expect(parseUtcInput('2026-13-45T99:00')).toBeUndefined()
	})
})

describe('minor bodies', () => {
	test('the latest job of each kind of an image is kept apart', async () => {
		const annotations = state()
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job() })
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ jobId: 'minor', request: { ...REQUEST, kind: 'minorBodies' }, queuedAt: 2000 }) })

		expect(latestAnnotationJob(annotations, 'image-1')?.jobId).toBe('job-1')
		expect(latestAnnotationJob(annotations, 'image-1', 'minorBodies')?.jobId).toBe('minor')

		await runAnnotation(annotations, 'image-1', { ...REQUEST, kind: 'minorBodies' }, fetcher({ '/api/images/image-1/annotations': [422, { error: 'No time', code: 'contextUnavailable' }] }).request)
		expect(annotations.submitErrors[annotationKey('image-1', 'minorBodies')]).toBe('No time')
		expect(annotations.submitErrors[annotationKey('image-1', 'local')]).toBeUndefined()
	})

	test('a search sends no observer: the server uses the site of the image header', () => {
		const observer = { latitude: 1, longitude: 2, elevation: 3 }
		expect(annotationRequest({ kind: 'minorBodies', magnitudeLimit: 12, plateSolveJobId: 'p', observer })).toEqual({ kind: 'minorBodies', magnitudeLimit: 12, plateSolveJobId: 'p' })
	})

	test('the context of an image is fetched once', async () => {
		const annotations = state()
		const context = { observation: { time: 1000, origin: 'dateObs', approximate: false, center: 'geocentricCorrected', site: { latitude: 1, longitude: 2, elevation: 3, source: 'siteKeywords' } }, site: { latitude: 1, longitude: 2, elevation: 3, source: 'siteKeywords' } }
		const { request, calls } = fetcher({ '/api/images/image-9/annotations/context': [200, context] })
		await loadAnnotationContext(annotations, 'image-9', request)
		await loadAnnotationContext(annotations, 'image-9', request)

		expect(calls).toHaveLength(1)
		expect(annotations.contexts['image-9']).toEqual(context as never)
	})

	test('a body is resolved in SBDB by its number or designation only when it is the only match', async () => {
		const body = { spkId: '20172438', designation: '172438', name: '172438 (2003 QW37)' }
		const found = fetcher({ '/api/sky/minorbodies/search?q=172438': [200, { kind: 'found', body }] })
		expect(await resolveMinorBody({ id: 'skybot:172438' }, found.request)).toEqual(body as never)
		expect(minorBodyQuery({ id: 'skybot:2017 YJ66' })).toBe('2017 YJ66')

		const ambiguous = fetcher({ '/api/sky/minorbodies/search?q=2017%20YJ66': [200, { kind: 'ambiguous', matches: [] }] })
		expect(await resolveMinorBody({ id: 'skybot:2017 YJ66' }, ambiguous.request)).toContain('several')
		const missing = fetcher({ '/api/sky/minorbodies/search?q=X': [200, { kind: 'notFound', message: 'No match' }] })
		expect(await resolveMinorBody({ id: 'skybot:X' }, missing.request)).toBe('No match')
		const down = fetcher({ '/api/sky/minorbodies/search?q=X': [503, { error: 'SBDB is unavailable', code: 'serviceUnavailable' }] })
		expect(await resolveMinorBody({ id: 'skybot:X' }, down.request)).toBe('SBDB is unavailable')
	})
})

test('the answer to a submission arriving after the end of its job does not bring it back', async () => {
	const annotations = state()
	handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ state: 'completed' }) })
	await runAnnotation(annotations, 'image-1', REQUEST, fetcher({ '/api/images/image-1/annotations': [202, job()] }).request)
	expect(annotations.jobs['job-1'].state).toBe('completed')
	expect(latestAnnotationJob(annotations, 'image-1')?.jobId).toBe('job-1')
})
