import { describe, expect, test } from 'bun:test'
import { compile } from 'src/api/sequencer.compiler'
import { SequencerOverheadMeter, SequencerProgressEmitter, deriveSequencerSnapshot } from 'src/api/sequencer.snapshot'
import type { SequencerSnapshotObservation } from 'src/api/sequencer.snapshot'
import { InMemorySequencerStore } from 'src/api/sequencer.store'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'
import type { SequencerPlan } from '#/sequencer.plan'
import type { SequencerCaptureProgress, SequencerSession, SequencerSessionSnapshot } from '#/sequencer.state'
import { canonical } from './sequencer.fixture'

function plan(): SequencerPlan {
	const compilation = compile(canonical())

	expect(compilation.ok).toBeTrue()

	return compilation.ok ? compilation.plan : ({} as SequencerPlan)
}

function session(overrides?: Partial<SequencerSession>, capture: SequencerCaptureProgress = {}): SequencerSession {
	const store = new InMemorySequencerStore(() => 1000)
	const created = store.createSession({ definitionId: 'definition-1', definitionRevision: 7, handlerVersions: {} })

	return { ...created, state: 'running', startedAt: 1000, ...overrides, checkpoint: { ...created.checkpoint, capture, ...overrides?.checkpoint } }
}

function observation(overrides?: Partial<SequencerSnapshotObservation>): SequencerSnapshotObservation {
	return { session: session(), plan: plan(), now: 10000, ...overrides }
}

function group(accepted: number, integration: number) {
	return { cursor: accepted, accepted, captured: accepted, rejected: 0, abandoned: 0, integration, attemptWindowStart: 0 }
}

describe('overhead meter', () => {
	test('reports nothing until an interval between two exposures is closed', () => {
		const meter = new SequencerOverheadMeter()

		expect(meter.average).toBeUndefined()

		meter.exposureStarted(1000)

		expect(meter.average).toBeUndefined()

		meter.exposureEnded(61000)

		expect(meter.average).toBeUndefined()

		meter.exposureStarted(69000)

		expect(meter.average).toBe(8)
		expect(meter.samples).toBe(1)
	})

	test('averages the last intervals and forgets the ones beyond the window', () => {
		const meter = new SequencerOverheadMeter()

		for (let i = 0; i < 12; i++) {
			meter.exposureEnded(0)
			meter.exposureStarted(10000)
		}

		expect(meter.samples).toBe(8)
		expect(meter.average).toBe(10)

		meter.exposureEnded(0)
		meter.exposureStarted(2000)

		expect(meter.samples).toBe(8)
		expect(meter.average).toBeCloseTo(9, 10)
	})

	test('never pairs an end with the start of an exposure of another run', () => {
		const meter = new SequencerOverheadMeter()

		meter.exposureEnded(1000)
		meter.exposureStarted(3000)
		meter.exposureStarted(3600000)

		expect(meter.average).toBe(2)

		meter.reset()

		expect(meter.average).toBeUndefined()
		expect(meter.samples).toBe(0)
	})

	test('ignores an interval taken from a clock that moved backwards', () => {
		const meter = new SequencerOverheadMeter()

		meter.exposureEnded(5000)
		meter.exposureStarted(1000)

		expect(meter.average).toBeUndefined()
	})
})

describe('snapshot derivation', () => {
	test('describes a session that never started without inventing progress', () => {
		const snapshot = deriveSequencerSnapshot(observation({ session: session({ state: 'created', startedAt: undefined }) }))

		expect(snapshot.state).toBe('created')
		expect(snapshot.desiredState).toBe('running')
		expect(snapshot.converging).toBeFalse()
		expect(snapshot.target).toEqual({ id: 'm42', name: 'Orion Nebula' })
		expect(snapshot.capture.accepted).toBe(0)
		expect(snapshot.capture.exposure).toBeUndefined()
		expect(snapshot.capture.groups).toHaveLength(2)
		expect(snapshot.foreground).toBeUndefined()
		expect(snapshot.background).toBeEmpty()
		expect(snapshot.monitors).toBeEmpty()
		expect(snapshot.lastEventSequence).toBe(0)
		expect(snapshot.timestamp).toBe(10000)
	})

	test('reports the declared roles against the devices they resolved to', () => {
		const snapshot = deriveSequencerSnapshot(observation({ resolved: { camera: 'Camera Simulator', mount: 'Mount Simulator' } }))

		expect(snapshot.devices).toEqual([
			{ role: 'camera', declaredId: 'Camera Simulator', deviceId: 'Camera Simulator' },
			{ role: 'mount', declaredId: 'Mount Simulator', deviceId: 'Mount Simulator' },
			{ role: 'wheel', declaredId: 'Wheel Simulator', deviceId: undefined },
			{ role: 'focuser', declaredId: 'Focuser Simulator', deviceId: undefined },
		])
	})

	test('joins the checkpoint counters with the groups of the plan', () => {
		const capture: SequencerCaptureProgress = { m42: { cycle: 0, groups: { lum: { cursor: 4, accepted: 3, captured: 3, rejected: 1, abandoned: 1, integration: 180, attemptWindowStart: 3 } } } }
		const snapshot = deriveSequencerSnapshot(observation({ session: session(undefined, capture) }))
		const lum = snapshot.capture.groups[0]

		expect(lum.id).toBe('lum')
		expect(lum.frameType).toBe('LIGHT')
		expect(lum.exposureTime).toBe(60)
		expect(lum.cursor).toBe(4)
		expect(lum.accepted).toBe(3)
		expect(lum.rejected).toBe(1)
		expect(lum.abandoned).toBe(1)
		expect(lum.requiredSlots).toBe(10)
		expect(lum.slotLimit).toBe(10)
		expect(lum.integration).toBe(180)
		expect(snapshot.capture.accepted).toBe(3)
		expect(snapshot.capture.requiredSlots).toBe(20)
		expect(snapshot.capture.integration).toBe(180)
	})

	test('estimates the remaining work from the required slots and the measured overhead', () => {
		const capture: SequencerCaptureProgress = { m42: { cycle: 1, groups: { lum: group(10, 600), red: group(4, 240) } } }
		const snapshot = deriveSequencerSnapshot(observation({ session: session(undefined, capture), overhead: 5 }))

		// Six slots are left in the last cycle of the two the definition repeats, at sixty seconds of exposure
		// plus the five seconds of measured overhead each.
		expect(snapshot.capture.remaining).toBe(390)
		expect(snapshot.capture.estimatedCompletion).toBe(10000 + 390000)
		expect(snapshot.capture.overhead).toBe(5)
	})

	test('projects every cycle the plan still repeats and never the abandonment budget', () => {
		const snapshot = deriveSequencerSnapshot(observation())

		// Two cycles of twenty required slots at sixty seconds, with no overhead measured yet.
		expect(snapshot.capture.remaining).toBe(2400)
	})

	test('estimates nothing for a terminal session or for one whose plan is gone', () => {
		const ended = deriveSequencerSnapshot(observation({ session: session({ state: 'completed', desiredState: 'stopped', endedAt: 9000 }) }))

		expect(ended.capture.remaining).toBeUndefined()
		expect(ended.capture.estimatedCompletion).toBeUndefined()
		expect(ended.converging).toBeFalse()

		const unplanned = deriveSequencerSnapshot(observation({ plan: undefined }))

		expect(unplanned.capture.remaining).toBeUndefined()
		expect(unplanned.capture.groups).toBeEmpty()
		expect(unplanned.target).toBeUndefined()
		expect(unplanned.devices).toBeEmpty()
	})

	test('clamps the elapsed exposure while the sensor is reading out', () => {
		const running = deriveSequencerSnapshot(observation({ exposure: { startedAt: 4000, total: 20 }, now: 10000 }))

		expect(running.capture.exposure).toEqual({ startedAt: 4000, elapsed: 6, total: 20, remaining: 14 })

		const readingOut = deriveSequencerSnapshot(observation({ exposure: { startedAt: 5000, total: 3 }, now: 10000 }))

		expect(readingOut.capture.exposure).toEqual({ startedAt: 5000, elapsed: 3, total: 3, remaining: 0 })
	})

	test('reports a long wait as the foreground action instead of a stalled estimate', () => {
		const wait = { reason: 'waiting for the meridian flip window', until: 70000 }
		const snapshot = deriveSequencerSnapshot(observation({ foreground: { nodeId: 'flip', type: 'meridianFlip', state: 'waiting', attempt: 1, startedAt: 9000, wait } }))

		expect(snapshot.capture.exposure).toBeUndefined()
		expect(snapshot.foreground).toEqual({ nodeId: 'flip', type: 'meridianFlip', name: 'meridianFlip', state: 'waiting', attempt: 1, progress: undefined, detail: undefined, startedAt: 9000, wait })
	})

	test('reports how far every periodic trigger is from firing', () => {
		const anchors = { ...sequencerInitialTriggerAnchors(1000), autofocus: { at: 1000, frames: 8 }, dither: { at: 1000, frames: 1 } }
		const snapshot = deriveSequencerSnapshot(
			observation({
				session: session({ checkpoint: { ...session().checkpoint, anchors } }),
				triggers: {
					autofocus: { triggers: { onStart: true, onFilterChange: true, afterMeridianFlip: true, afterRecovery: true, everyFrames: 20, everyTime: 3600, temperatureChange: 1, minimumTimeBetweenRuns: 600 } } as never,
					dither: { everyFrames: 1, everyTime: 0 } as never,
					meridianFlip: {} as never,
				},
				meridianFlipDue: true,
			}),
		)

		expect(snapshot.triggers).toEqual([
			{ name: 'meridianFlip', armed: true },
			{ name: 'autofocus', armed: false, frames: 12, elapsed: 3591 },
			{ name: 'dither', armed: true, frames: 0, elapsed: undefined },
		])
	})

	test('names no group while the cursor is not a capture action', () => {
		const captureNode = plan().groups[0].nodeId
		const inside = deriveSequencerSnapshot(observation({ session: session({ checkpoint: { ...session().checkpoint, cursor: captureNode } }) }))
		const outside = deriveSequencerSnapshot(observation({ session: session({ checkpoint: { ...session().checkpoint, cursor: 'autofocus' } }) }))

		expect(inside.capture.groupId).toBe('lum')
		expect(outside.capture.groupId).toBeUndefined()
	})
})

describe('progress emitter', () => {
	test('emits on start, on every change, and at the configured cadence', async () => {
		const emitted: SequencerSessionSnapshot[] = []
		const emitter = new SequencerProgressEmitter({ interval: 10, snapshot: () => deriveSequencerSnapshot(observation()), emit: (snapshot) => emitted.push(snapshot) })

		expect(emitter.started).toBeFalse()

		emitter.start()

		expect(emitter.started).toBeTrue()
		expect(emitted).toHaveLength(1)

		emitter.changed()

		expect(emitted).toHaveLength(2)

		await Bun.sleep(35)

		emitter.stop()

		const ticked = emitted.length

		expect(ticked).toBeGreaterThan(2)
		expect(emitter.started).toBeFalse()

		await Bun.sleep(30)

		expect(emitted).toHaveLength(ticked)
	})

	test('is inert while stopped and never lets a failing sink escape', () => {
		let derived = 0
		const emitter = new SequencerProgressEmitter({
			interval: 10,
			snapshot: () => {
				derived++
				throw new Error('derivation failed')
			},
			emit: () => undefined,
		})

		emitter.changed()

		expect(derived).toBe(0)

		expect(() => emitter.start()).not.toThrow()
		expect(derived).toBe(1)

		emitter.stop()
	})

	test('emits nothing when there is no session to describe', () => {
		let emitted = 0
		const emitter = new SequencerProgressEmitter({ interval: 10, snapshot: () => undefined, emit: () => emitted++ })

		emitter.start()
		emitter.changed()
		emitter.stop()

		expect(emitted).toBe(0)
	})
})
