import { describe, expect, test } from 'bun:test'
import type { ImageProcessingJob, ImageProcessingStep } from 'api'
import { proxy } from 'valtio'
import { addStep, duplicateStep, enabledSteps, handleImageProcessingEvent, type ImageProcessingState, moveStep, refreshImageProcessing, removeStep, runProcessing, setStepEnabled, toggleExpanded, updateStep } from './imageprocessing'
import { createOperation, pipelineIssue } from './imageprocessing.catalog'
import { type ImagesIo, type ImagesState, newView, openImage } from './images'

interface Call {
	readonly url: string
	readonly method: string
	readonly body?: unknown
}

const INFO = { origin: 'file', id: 'srv-1', name: 'm31.fits', path: '/data/m31.fits', format: 'fits', width: 4, height: 2, channels: 1, header: {} }
const OUTPUT = { origin: 'derived', id: 'out-1', name: 'm31 — Processed', width: 4, height: 2, channels: 1, header: {}, provenance: { kind: 'processing', source: 'srv-1', sourceName: 'm31.fits', steps: [], createdAt: '2026-10-27T00:00:00.000Z' } }

// Returns a job of the image srv-1 in a state.
function job(state: ImageProcessingJob['state'], patch: Partial<ImageProcessingJob> = {}): ImageProcessingJob {
	return { jobId: 'job-1', imageId: 'srv-1', state, queuedAt: 1, steps: [], completedSteps: 0, ...(state === 'completed' && { outputImageId: 'out-1' }), ...patch }
}

// Fake API: opens any path as INFO, answers a submission with the queued job (or refusal when set), the claim of any
// job with OUTPUT, the snapshot with snapshot, and renders anything.
function fakeIo() {
	const calls: Call[] = []
	const control: { refusal?: { readonly status: number; readonly body: object }; snapshot: ImageProcessingJob[] } = { snapshot: [] }

	function respond(input: string, init?: RequestInit) {
		const method = init?.method ?? 'GET'
		const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
		calls.push({ url: input, method, body })
		if (input === '/api/images') return Response.json(INFO, { status: 201 })
		if (input === '/api/image-processing') return Response.json({ jobs: control.snapshot })
		if (input.endsWith('/claim')) return Response.json(OUTPUT)

		if (input.endsWith('/processing')) {
			if (control.refusal) return Response.json(control.refusal.body, { status: control.refusal.status })
			return Response.json(job('queued', { steps: (body as { steps: ImageProcessingStep[] }).steps }), { status: 202 })
		}

		return new Response(new Blob(['jpeg']), { headers: { 'X-Image-Render': JSON.stringify({ stretch: [{ midtone: 0.5, shadow: 0, highlight: 1 }], channels: 1 }) } })
	}

	const io: ImagesIo = {
		fetch: (input: string, init?: RequestInit) => Promise.resolve(respond(input, init)),
		createObjectURL: () => 'blob:1',
		revokeObjectURL: () => undefined,
		loadDisplay: () => undefined,
		saveDisplay: () => undefined,
	}

	return { io, calls, control }
}

function newState() {
	return { images: proxy<ImagesState>({ documents: [], views: {}, tools: {} }), processing: proxy<ImageProcessingState>({ jobs: {}, submissions: {}, claims: {}, claimErrors: {} }) }
}

// Returns a document opened in images, with its key and pipeline.
async function opened(images: ImagesState, io: ImagesIo) {
	await openImage(images, '/data/m31.fits', io)
	const key = images.activeKey!
	return { key, draft: images.views[key].processing }
}

describe('draft', () => {
	test('adds, duplicates, toggles, edits, moves, and removes steps', () => {
		const draft = newView().processing
		addStep(draft, 'gaussianBlur')
		addStep(draft, 'sharpen')
		const [blur, sharpen] = draft.steps

		duplicateStep(draft, blur.id)
		const copy = draft.steps[1]
		expect(copy.id).not.toBe(blur.id)
		expect(draft.steps.map((s) => s.operation.type)).toEqual(['gaussianBlur', 'gaussianBlur', 'sharpen'])

		updateStep(draft, copy.id, { type: 'gaussianBlur', sigma: 3, size: 7 })
		expect(blur.operation).toEqual({ type: 'gaussianBlur', sigma: 1.4, size: 5 })

		setStepEnabled(draft, blur.id, false)
		toggleExpanded(draft, blur.id)
		expect(draft.steps[0]).toMatchObject({ enabled: false, operation: { sigma: 1.4 } })
		expect(draft.expanded).toEqual([sharpen.id, copy.id])

		moveStep(draft, 2, 0)
		expect(draft.steps.map((s) => s.id)).toEqual([sharpen.id, blur.id, copy.id])
		moveStep(draft, 0, 10)
		expect(draft.steps.map((s) => s.id)).toEqual([blur.id, copy.id, sharpen.id])

		removeStep(draft, copy.id)
		expect(draft.steps.map((s) => s.id)).toEqual([blur.id, sharpen.id])
		expect(draft.expanded).toEqual([sharpen.id])
	})

	test('the snapshot holds the enabled steps in order and never follows later edits', () => {
		const draft = newView().processing
		addStep(draft, 'gaussianBlur')
		addStep(draft, 'horizontalFlip')
		addStep(draft, 'sharpen')
		setStepEnabled(draft, draft.steps[1].id, false)

		const steps = enabledSteps(draft)
		updateStep(draft, draft.steps[0].id, { type: 'gaussianBlur', sigma: 4, size: 9 })

		expect(steps.map((s) => s.operation)).toEqual([{ type: 'gaussianBlur', sigma: 1.4, size: 5 }, { type: 'sharpen' }])
	})
})

describe('compatibility', () => {
	test('follows the channels and CFA pattern each step produces', () => {
		const step = (id: string, type: Parameters<typeof createOperation>[0]) => ({ id, operation: createOperation(type) })

		expect(pipelineIssue({ channels: 1, cfa: 'RGGB' }, [step('a', 'cosmeticCorrection'), step('b', 'verticalFlip'), step('c', 'debayer'), step('d', 'backgroundNeutralization'), step('e', 'grayscale'), step('f', 'mmt')])).toBeUndefined()
		expect(pipelineIssue({ channels: 1, cfa: 'RGGB' }, [step('a', 'gaussianBlur')])?.stepId).toBe('a')
		expect(pipelineIssue({ channels: 1 }, [step('a', 'debayer')])?.stepId).toBe('a')
		expect(pipelineIssue({ channels: 1 }, [step('a', 'backgroundNeutralization')])?.stepId).toBe('a')
		expect(pipelineIssue({ channels: 3 }, [step('a', 'grayscale'), step('b', 'backgroundNeutralization')])?.stepId).toBe('b')
	})
})

describe('jobs', () => {
	test('run submits the enabled steps and opens the output once when the job completes', async () => {
		const { images, processing } = newState()
		const { io, calls } = fakeIo()
		const { key, draft } = await opened(images, io)
		addStep(draft, 'gaussianBlur')
		addStep(draft, 'sharpen')
		setStepEnabled(draft, draft.steps[1].id, false)

		await runProcessing(processing, images, key, io)
		expect(calls.find((c) => c.url === '/api/images/srv-1/processing')?.body).toEqual({ steps: [{ id: draft.steps[0].id, operation: { type: 'gaussianBlur', sigma: 1.4, size: 5 } }] })
		expect(images.views[key].processing.jobId).toBe('job-1')

		handleImageProcessingEvent(processing, images, { type: 'imageProcessing:updated', job: job('completed') }, io)
		handleImageProcessingEvent(processing, images, { type: 'imageProcessing:updated', job: job('completed') }, io)
		await refreshImageProcessing(processing, images, io)
		await Bun.sleep(0)

		expect(calls.filter((c) => c.url.endsWith('/claim'))).toHaveLength(1)
		expect(images.documents.map((d) => d.name)).toEqual(['m31.fits', 'm31 — Processed'])
		expect(images.documents[1]).toMatchObject({ source: { kind: 'derived', sourceName: 'm31.fits' }, unsaved: true })
		expect(images.activeKey).toBe(images.documents[1].key)
	})

	test('a late event never takes a job back, and a job of another tab is never claimed', async () => {
		const { images, processing } = newState()
		const { io, calls } = fakeIo()

		handleImageProcessingEvent(processing, images, { type: 'imageProcessing:updated', job: job('running', { currentStepIndex: 1, completedSteps: 1 }) }, io)
		handleImageProcessingEvent(processing, images, { type: 'imageProcessing:updated', job: job('running', { currentStepIndex: 0, completedSteps: 0 }) }, io)
		expect(processing.jobs['job-1'].currentStepIndex).toBe(1)

		handleImageProcessingEvent(processing, images, { type: 'imageProcessing:updated', job: job('completed') }, io)
		handleImageProcessingEvent(processing, images, { type: 'imageProcessing:updated', job: job('running', { completedSteps: 2 }) }, io)
		await Bun.sleep(0)

		expect(processing.jobs['job-1'].state).toBe('completed')
		expect(calls.some((c) => c.url.endsWith('/claim'))).toBeFalse()
	})

	test('a job completed before its submission was answered is claimed by the answer', async () => {
		const { images, processing } = newState()
		const { io, calls } = fakeIo()
		const { key, draft } = await opened(images, io)
		addStep(draft, 'sharpen')

		handleImageProcessingEvent(processing, images, { type: 'imageProcessing:updated', job: job('completed') }, io)
		await runProcessing(processing, images, key, io)

		expect(calls.filter((c) => c.url.endsWith('/claim'))).toHaveLength(1)
		expect(images.documents).toHaveLength(2)
	})

	test('the output of a source no longer shown opens without taking the view', async () => {
		const { images, processing } = newState()
		const { io } = fakeIo()
		const { key, draft } = await opened(images, io)
		addStep(draft, 'sharpen')
		await runProcessing(processing, images, key, io)
		await openImage(images, '/data/other.fits', io)
		const other = images.activeKey

		processing.jobs['job-1'] = job('running')
		handleImageProcessingEvent(processing, images, { type: 'imageProcessing:updated', job: job('completed') }, io)
		await Bun.sleep(0)

		expect(images.documents).toHaveLength(3)
		expect(images.activeKey).toBe(other)
	})

	test('a refusal keeps the error and the step it names', async () => {
		const { images, processing } = newState()
		const { io, control } = fakeIo()
		const { key, draft } = await opened(images, io)
		addStep(draft, 'backgroundNeutralization')
		control.refusal = { status: 422, body: { error: 'Background neutralization needs an RGB image', code: 'incompatibleImage', stepId: draft.steps[0].id } }

		await runProcessing(processing, images, key, io)

		expect(images.views[key].processing).toMatchObject({ submitError: 'Background neutralization needs an RGB image', submitErrorStepId: draft.steps[0].id })
		expect(images.views[key].processing.jobId).toBeUndefined()
	})
})
