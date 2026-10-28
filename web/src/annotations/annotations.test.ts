import { describe, expect, test } from 'bun:test'
import type { AnnotationJob, AnnotationRequest, AnnotationResult } from 'api'
import { proxy } from 'valtio'
import { annotationMatchesWcs, annotationPlateSolveJobId, annotationRequest, type AnnotationsState, handleAnnotationsEvent, latestAnnotationJob, latestAnnotationResult, loadAnnotationResult, parseUtcInput, refreshAnnotations, runAnnotation, sameAnnotationRequest, utcInputValue } from './annotations'

const REQUEST: AnnotationRequest = { kind: 'local', magnitudeLimit: 12 }

function state(): AnnotationsState {
	return proxy<AnnotationsState>({ jobs: {}, latest: {}, results: {}, resultErrors: {}, submitErrors: {} })
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
		expect(annotations.submitErrors['image-2']).toBe('No WCS')
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
