import { describe, expect, test } from 'bun:test'
import { sequencerNodeId } from 'src/api/sequencer.compiler'
import { SEQUENCER_TEMPLATE_PLACEHOLDERS, sequencerArtifactId, sequencerFrameDirectories, sequencerFrameFileName, sequencerLogicalSlotId, sequencerSlotAttempt, sequencerSlotToken, sequencerUnknownPlaceholders } from 'src/api/sequencer.identity'
import type { SequencerFrameNaming } from 'src/api/sequencer.identity'
import { isSequencerPathSegment } from 'src/api/sequencer.path'
import type { SequencerPlanFrameGroup } from '#/sequencer.plan'
import type { SequencerArtifact, SequencerArtifactStatus } from '#/sequencer.state'
import { camera, retry } from './sequencer.fixture'

function group(id: string, overrides?: Partial<SequencerPlanFrameGroup>): SequencerPlanFrameGroup {
	return {
		id,
		name: id,
		nodeId: sequencerNodeId.captureFrame('m42', id),
		frameType: 'LIGHT',
		exposureTime: 60,
		count: 3,
		integrationTime: 0,
		delay: 0,
		weight: 1,
		camera: camera(),
		retry: retry(),
		requiredSlots: 3,
		abandonmentBudget: 0,
		slotLimit: 3,
		projectedIntegration: 180,
		...overrides,
	}
}

function naming(overrides?: Partial<SequencerFrameNaming>): SequencerFrameNaming {
	return { targetId: 'm42', group: group('lum'), cycle: 0, ordinal: 0, attempt: 0, filter: 'L', ...overrides }
}

function artifact(logicalSlotId: string, attempt: number, status: SequencerArtifactStatus): SequencerArtifact {
	return { sessionId: 'session-1', logicalSlotId, attempt, status, createdAt: 0, updatedAt: 0 }
}

describe('logical slot identity', () => {
	test('is derived from the node, the group, the cycle and the ordinal', () => {
		const node = sequencerNodeId.captureFrame('m42', 'lum')

		expect(sequencerLogicalSlotId(node, 'lum', 0, 2)).toBe('target[m42].capture.frame[lum]#lum#0#2')
		expect(sequencerLogicalSlotId(node, 'lum', 1, 2)).not.toBe(sequencerLogicalSlotId(node, 'lum', 0, 2))
	})

	test('separates two targets declaring the same frame groups', () => {
		const first = sequencerLogicalSlotId(sequencerNodeId.captureFrame('m42', 'lum'), 'lum', 0, 0)
		const second = sequencerLogicalSlotId(sequencerNodeId.captureFrame('m31', 'lum'), 'lum', 0, 0)

		expect(first).not.toBe(second)
		expect(sequencerSlotToken(first)).not.toBe(sequencerSlotToken(second))
	})

	test('keys an artifact by session, slot and attempt', () => {
		const slot = sequencerLogicalSlotId(sequencerNodeId.captureFrame('m42', 'lum'), 'lum', 0, 0)

		expect(sequencerArtifactId('session-1', slot, 0)).not.toBe(sequencerArtifactId('session-1', slot, 1))
		expect(sequencerArtifactId('session-1', slot, 0)).not.toBe(sequencerArtifactId('session-2', slot, 0))
	})

	test('renders a slot token that is a valid path segment and stays unique', () => {
		const token = sequencerSlotToken(sequencerLogicalSlotId(sequencerNodeId.captureFrame('m42', 'lum'), 'lum', 0, 3))

		expect(isSequencerPathSegment(token)).toBeTrue()
		expect(token).toStartWith('target-m42-capture.frame-lum')
		expect(sequencerSlotToken('a b#g#0#0')).not.toBe(sequencerSlotToken('a-b#g#0#0'))
	})
})

describe('attempt derivation', () => {
	test('starts at zero when the registry holds nothing for the slot', () => {
		expect(sequencerSlotAttempt([], 'slot-1')).toBe(0)
		expect(sequencerSlotAttempt([artifact('slot-2', 4, 'committed')], 'slot-1')).toBe(0)
	})

	test('repeats a pending attempt instead of advancing past it', () => {
		expect(sequencerSlotAttempt([artifact('slot-1', 0, 'pending')], 'slot-1')).toBe(0)
		expect(sequencerSlotAttempt([artifact('slot-1', 0, 'rejected'), artifact('slot-1', 1, 'pending')], 'slot-1')).toBe(1)
	})

	test('advances past an attempt that is over', () => {
		expect(sequencerSlotAttempt([artifact('slot-1', 0, 'rejected')], 'slot-1')).toBe(1)
		expect(sequencerSlotAttempt([artifact('slot-1', 1, 'rejected'), artifact('slot-1', 0, 'rejected')], 'slot-1')).toBe(2)
		expect(sequencerSlotAttempt([artifact('slot-1', 0, 'committed')], 'slot-1')).toBe(1)
	})
})

describe('frame naming', () => {
	test('renders the readable part of the template and always carries the slot', () => {
		const slot = sequencerLogicalSlotId(sequencerNodeId.captureFrame('m42', 'lum'), 'lum', 0, 0)
		const name = sequencerFrameFileName('{target}-{filter}-{exposure}', naming(), slot, 'fit')

		expect(name).toStartWith('m42-L-60-')
		expect(name).toEndWith('.fit')
		expect(name).toContain(sequencerSlotToken(slot))
		expect(isSequencerPathSegment(name)).toBeTrue()
	})

	test('names every slot differently even with a template carrying no placeholder', () => {
		const first = sequencerLogicalSlotId(sequencerNodeId.captureFrame('m42', 'lum'), 'lum', 0, 0)
		const second = sequencerLogicalSlotId(sequencerNodeId.captureFrame('m42', 'lum'), 'lum', 0, 1)

		expect(sequencerFrameFileName('light', naming(), first, 'fit')).not.toBe(sequencerFrameFileName('light', naming({ ordinal: 1 }), second, 'fit'))
	})

	test('suffixes the attempt only from the second attempt on', () => {
		const slot = sequencerLogicalSlotId(sequencerNodeId.captureFrame('m42', 'lum'), 'lum', 0, 0)
		const clean = sequencerFrameFileName('{target}', naming(), slot, 'fit')
		const retried = sequencerFrameFileName('{target}', naming({ attempt: 1 }), slot, 'fit')

		expect(clean).not.toContain('-a')
		expect(retried).toBe(clean.replace('.fit', '-a1.fit'))
	})

	test('encodes an interpolated value that would escape the directory', () => {
		const slot = sequencerLogicalSlotId(sequencerNodeId.captureFrame('..', 'lum'), 'lum', 0, 0)
		const escaping = naming({ targetId: '../../etc', group: group('lum', { frameType: 'DARK' }) })
		const name = sequencerFrameFileName('{target}', escaping, slot, 'fit')

		expect(isSequencerPathSegment(name)).toBeTrue()
		expect(name).not.toContain('..')
		expect(sequencerFrameDirectories('{target}/{frameType}', escaping)).toEqual(['etc', 'DARK'])
		expect(sequencerFrameDirectories('{target}', naming({ targetId: '..' }))).toEqual([])
	})

	test('drops the segments a template rendered empty', () => {
		expect(sequencerFrameDirectories('{target}/{filter}', naming({ filter: undefined }))).toEqual(['m42'])
		expect(sequencerFrameDirectories('', naming())).toEqual([])
	})

	test('renders a fractional exposure without trailing noise', () => {
		const slot = sequencerLogicalSlotId(sequencerNodeId.captureFrame('m42', 'bias'), 'bias', 0, 0)

		expect(sequencerFrameFileName('{exposure}', naming({ group: group('bias', { exposureTime: 0.5 }) }), slot, 'fit')).toStartWith('0.5-')
		expect(sequencerFrameFileName('{exposure}', naming({ group: group('lum', { exposureTime: 60 }) }), slot, 'fit')).toStartWith('60-')
	})

	test('reports a placeholder no renderer interpolates', () => {
		expect(sequencerUnknownPlaceholders('{target}-{filter}-{exposure}')).toEqual([])
		expect(sequencerUnknownPlaceholders('{target}-{camera}-{camera}')).toEqual(['camera'])
		expect(SEQUENCER_TEMPLATE_PLACEHOLDERS).toContain('frameType')
	})
})
