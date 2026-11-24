import { describe, expect, test } from 'bun:test'
import type { AnnotationJob, AnnotationRequest, AnnotationResult } from 'api'
import { proxy } from 'valtio'
import {
	annotationAnswers,
	annotationKey,
	annotationMatchesWcs,
	annotationPlateSolveJobId,
	annotationRequest,
	type AnnotationsState,
	handleAnnotationsEvent,
	latestAnnotationJob,
	loadAnnotationContext,
	loadAnnotationResult,
	minorBodyQuery,
	refreshAnnotations,
	resolveMinorBody,
	runAnnotation,
	shownAnnotationJob,
	shownAnnotationResult,
} from './annotations'

const REQUEST: AnnotationRequest = { kind: 'local', magnitudeLimit: 12 }

function state(): AnnotationsState {
	return proxy<AnnotationsState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {}, contexts: {} })
}

function job(patch: Partial<AnnotationJob> = {}): AnnotationJob {
	return { jobId: 'job-1', imageId: 'image-1', request: REQUEST, wcs: { source: 'header' }, observation: { time: 1000, origin: 'dateObs', approximate: false, center: 'geocentric' }, state: 'queued', queuedAt: 1000, ...patch }
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
		expect(shownAnnotationResult(annotations, 'image-1')).toBeUndefined()

		const { request, calls } = fetcher({ '/api/annotations/job-1/result': [200, { jobId: 'job-1', imageId: 'image-1', objects: [] }] })
		await loadAnnotationResult(annotations, 'job-1', request)
		await loadAnnotationResult(annotations, 'job-1', request)
		expect(calls).toHaveLength(1)
		expect(shownAnnotationResult(annotations, 'image-1')?.jobId).toBe('job-1')

		await loadAnnotationResult(annotations, 'job-9', fetcher({}).request)
		expect(annotations.resultErrors['job-9']).toBe('Not found')
	})

	test('a run that waits, fails, or is cancelled keeps the newest completed result of its kind shown', async () => {
		const annotations = state()
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ state: 'completed' }) })
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ jobId: 'minor', queuedAt: 1500, state: 'completed', request: { kind: 'solarSystemBodies', magnitudeLimit: 12 } }) })
		await loadAnnotationResult(annotations, 'job-1', fetcher({ '/api/annotations/job-1/result': [200, { jobId: 'job-1', imageId: 'image-1', objects: [] }] }).request)
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ jobId: 'job-2', queuedAt: 2000, state: 'running' }) })

		expect(latestAnnotationJob(annotations, 'image-1')?.jobId).toBe('job-2')
		expect(shownAnnotationJob(annotations, 'image-1')?.jobId).toBe('job-1')
		expect(shownAnnotationResult(annotations, 'image-1')?.jobId).toBe('job-1')

		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ jobId: 'job-2', queuedAt: 2000, state: 'failed' }) })
		expect(shownAnnotationJob(annotations, 'image-1')?.jobId).toBe('job-1')
		expect(shownAnnotationJob(annotations, 'image-1', 'solarSystemBodies')?.jobId).toBe('minor')
		expect(shownAnnotationJob(annotations, 'image-2')).toBeUndefined()

		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ jobId: 'job-3', queuedAt: 3000, state: 'completed' }) })
		expect(shownAnnotationJob(annotations, 'image-1')?.jobId).toBe('job-3')
	})
})

describe('requests and WCS', () => {
	test('a result answers a request it adds nothing to', () => {
		const local = { request: REQUEST }
		expect(annotationAnswers(local, { ...REQUEST })).toBeTrue()
		expect(annotationAnswers(local, { ...REQUEST, magnitudeLimit: 10 })).toBeTrue()
		expect(annotationAnswers(local, { ...REQUEST, magnitudeLimit: 13 })).toBeFalse()
		expect(annotationAnswers(local, { ...REQUEST, plateSolveJobId: 'p' })).toBeFalse()
		expect(annotationAnswers(local, { ...REQUEST, kind: 'solarSystemBodies' })).toBeFalse()

		const minor = { request: { kind: 'solarSystemBodies', magnitudeLimit: 12, bodies: { solarSystem: false, satellite: false, minorBody: true } } satisfies AnnotationRequest }
		expect(annotationAnswers(minor, { ...minor.request, magnitudeLimit: 18 })).toBeTrue()
		expect(annotationAnswers(minor, { ...minor.request, bodies: { solarSystem: false, satellite: false, minorBody: false } })).toBeTrue()
		expect(annotationAnswers(minor, { ...minor.request, bodies: { solarSystem: true, satellite: false, minorBody: true } })).toBeFalse()
		expect(annotationAnswers({ request: { kind: 'solarSystemBodies', magnitudeLimit: 12 } }, minor.request)).toBeTrue()
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
	test('a local run sends no groups of bodies', () => {
		const bodies = { solarSystem: true, satellite: false, minorBody: true }
		expect(annotationRequest({ magnitudeLimit: 10 })).toEqual({ kind: 'local', magnitudeLimit: 10 })
		expect(annotationRequest({ magnitudeLimit: 10, plateSolveJobId: 'p', bodies })).toEqual({ kind: 'local', magnitudeLimit: 10, plateSolveJobId: 'p' })
	})
})

describe('solar-system bodies', () => {
	test('the latest job of each kind of an image is kept apart', async () => {
		const annotations = state()
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job() })
		handleAnnotationsEvent(annotations, { type: 'annotations:updated', job: job({ jobId: 'minor', request: { ...REQUEST, kind: 'solarSystemBodies' }, queuedAt: 2000 }) })

		expect(latestAnnotationJob(annotations, 'image-1')?.jobId).toBe('job-1')
		expect(latestAnnotationJob(annotations, 'image-1', 'solarSystemBodies')?.jobId).toBe('minor')

		await runAnnotation(annotations, 'image-1', { ...REQUEST, kind: 'solarSystemBodies' }, fetcher({ '/api/images/image-1/annotations': [422, { error: 'No time', code: 'contextUnavailable' }] }).request)
		expect(annotations.submitErrors[annotationKey('image-1', 'solarSystemBodies')]).toBe('No time')
		expect(annotations.submitErrors[annotationKey('image-1', 'local')]).toBeUndefined()
	})

	test('a search sends the groups of bodies it lists', () => {
		const bodies = { solarSystem: true, satellite: false, minorBody: true }
		expect(annotationRequest({ kind: 'solarSystemBodies', magnitudeLimit: 12, plateSolveJobId: 'p', bodies })).toEqual({ kind: 'solarSystemBodies', magnitudeLimit: 12, plateSolveJobId: 'p', bodies })
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
