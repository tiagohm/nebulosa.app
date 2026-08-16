import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { sequencerCaptureHandler } from 'src/api/sequencer.capture'
import type { SequencerCaptureServices } from 'src/api/sequencer.capture'
import { compile } from 'src/api/sequencer.compiler'
import type { SequencerCapture } from 'src/api/sequencer.compiler'
import type { SequencerActionContext } from 'src/api/sequencer.registry'
import type { SequencerPlanAction, SequencerPlanLoop, SequencerPlanNode } from '#/sequencer.plan'
import type { SequencerArtifactDraft, SequencerCheckpoint } from '#/sequencer.state'
import { camera, canonical, frame, retry } from './sequencer.fixture'

let root = ''

function captureConfiguration(): SequencerCapture {
	const base = canonical()
	const compilation = compile({
		...base,
		guiding: { ...base.guiding, enabled: false },
		dither: { ...base.dither, enabled: false },
		autofocus: { ...base.autofocus, enabled: false },
		meridianFlip: { ...base.meridianFlip, enabled: false },
		cooling: { ...base.cooling, enabled: false },
		capture: { ...base.capture, order: 'sequential', repeat: 1, delay: 0, frames: [frame('lum', { count: 1, camera: camera() })], retry: retry() },
		startup: { ...base.startup, actions: [] },
		shutdown: { ...base.shutdown, actions: [] },
	})

	expect(compilation.ok).toBeTrue()

	const found = compilation.ok ? loopOf(compilation.plan.root) : undefined

	expect(found).toBeDefined()

	const node = found!.body.children.find((it) => it.kind === 'action' && it.id.endsWith('capture.frame[lum]'))

	expect(node).toBeDefined()

	return (node as SequencerPlanAction).configuration as SequencerCapture
}

function loopOf(node: SequencerPlanNode): SequencerPlanLoop | undefined {
	if (node.kind === 'loop') return node
	if (node.kind !== 'sequence') return undefined

	for (const child of node.children) {
		const found = loopOf(child)
		if (found !== undefined) return found
	}

	return undefined
}

function contextOf(signal: AbortSignal, drafts: SequencerArtifactDraft[]): SequencerActionContext {
	return {
		sessionId: 'session-1',
		nodeId: 'target[m42].capture.frame[lum]',
		attempt: 0,
		scope: {} as SequencerActionContext['scope'],
		signal,
		now: Date.now,
		request: (role) => (role === 'camera' ? ({ device: { type: 'camera', name: 'Camera Simulator' } } as never) : undefined),
		progress: () => undefined,
		artifact: (draft) => void drafts.push(draft),
		auxiliary: () => undefined,
		checkpoint: {} as SequencerCheckpoint,
		frame: { logicalSlotId: 'm42:lum:1:1', cycle: 1, ordinal: 1, path: join(root, 'm42-lum-60.fit'), write: { valid: () => Promise.resolve(true) } },
	}
}

beforeEach(async () => {
	root = await mkdtemp(tmpdir() + sep)
})

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

describe('capture block', () => {
	test('commands no exposure when the frame was cancelled while its destination was prepared', async () => {
		const controller = new AbortController()
		const drafts: SequencerArtifactDraft[] = []
		let commanded = 0
		const services = {
			cameraHandler: {
				capture: () => {
					commanded++
					return { started: Promise.resolve({ ok: true, value: undefined }), result: Promise.resolve({ ok: true, value: undefined }) }
				},
			},
		} as unknown as SequencerCaptureServices
		const configuration = captureConfiguration()
		const context = contextOf(controller.signal, drafts)

		controller.abort()

		const result = await sequencerCaptureHandler(services).execute(context, configuration)

		expect(commanded).toBe(0)
		expect(drafts).toBeEmpty()
		expect(result.type).toBe('fatalFailure')
		expect(result.type === 'fatalFailure' && result.reason).toBe('aborted')
	})

	test('commands the exposure of a frame the session has not cancelled', async () => {
		const drafts: SequencerArtifactDraft[] = []
		let commanded = 0
		const services = {
			cameraHandler: {
				capture: () => {
					commanded++
					return { started: Promise.resolve({ ok: false, reason: 'commandFailed' }), result: Promise.resolve({ ok: false, reason: 'commandFailed' }) }
				},
			},
		} as unknown as SequencerCaptureServices
		const configuration = captureConfiguration()
		const context = contextOf(new AbortController().signal, drafts)

		const result = await sequencerCaptureHandler(services).execute(context, configuration)

		expect(commanded).toBe(1)
		expect(drafts.map((it) => it.status)).toEqual(['pending', 'rejected'])
		expect(result.type).toBe('retryableFailure')
	})
})
