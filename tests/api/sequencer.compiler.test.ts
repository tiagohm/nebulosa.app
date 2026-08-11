import { describe, expect, test } from 'bun:test'
import { compile, sequencerNodeId, sequencerPlanNodes } from 'src/api/sequencer.compiler'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import type { Sequencer, SequencerCameraSettings, SequencerFrame, SequencerLifecycleAction, SequencerRetryPolicy } from '#/sequencer'
import type { SequencerPlanLoop, SequencerPlanSequence } from '#/sequencer.plan'

function retry(): SequencerRetryPolicy {
	return { maxAttempts: 3, delay: 5, backoff: 2, maximumDelay: 60, retryOn: ['timeout', 'commandFailed'], onExhausted: 'fail' }
}

function camera(): SequencerCameraSettings {
	return { binX: 1, binY: 1, gain: 100, offset: 10, frameFormat: 'RAW16', transferFormat: 'FITS', compressed: false, subframe: { enabled: false, x: 0, y: 0, width: 0, height: 0 } }
}

function frame(id: string, overrides?: Partial<SequencerFrame>): SequencerFrame {
	return { id, name: id, enabled: true, frameType: 'LIGHT', exposureTime: 60, count: 10, integrationTime: 0, weight: 1, camera: {}, ...overrides }
}

function action(id: string, overrides?: Partial<SequencerLifecycleAction>): SequencerLifecycleAction {
	return { id, enabled: true, timeout: 30, retry: retry(), type: 'unparkMount', ...overrides } as SequencerLifecycleAction
}

function canonical(): Sequencer {
	return {
		schemaVersion: 1,
		id: 'definition-1',
		revision: 7,
		name: 'M42',
		description: '',
		enabled: true,
		devices: { camera: 'Camera Simulator', mount: 'Mount Simulator', wheel: 'Wheel Simulator', focuser: 'Focuser Simulator' },
		target: {
			id: 'm42',
			name: 'Orion Nebula',
			enabled: true,
			coordinateType: 'J2000',
			rightAscension: 1.4,
			declination: -0.09,
			tracking: { enabled: true, mode: 'SIDEREAL', retry: retry() },
			goto: { enabled: true, skipWhenAlreadyAtTarget: true, tolerance: 0.001, arrivalTolerance: 0.0005, timeout: 300, settle: 5, retry: retry() },
			center: {
				enabled: true,
				solver: { type: 'astap', timeout: 60, blind: false, searchRadius: 0.05, downsample: 2, maximumStars: 500, minimumSNR: 10 },
				tolerance: 0.0001,
				maximumAttempts: 5,
				settle: 3,
				syncMount: true,
				finalSolve: true,
				recenterAfterDrift: false,
				driftTolerance: 0.0002,
				checkEveryFrames: 0,
				checkEveryTime: 0,
				capture: { exposureTime: 5, frameType: 'LIGHT', binX: 2, binY: 2, gain: 100, offset: 10, subframe: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, transferFormat: 'FITS', compressed: false },
				retry: retry(),
			},
			constraints: { enabled: false, window: { enabled: false }, stopWhenViolated: false, onViolation: 'wait', stableFor: 60 },
		},
		capture: { order: 'sequential', repeat: 2, frames: [frame('lum'), frame('red')], defaults: camera(), delay: 4, settle: 2, abortOnDeviceAlert: false, continueAfterRejectedFrame: false, retry: retry() },
		guiding: {
			enabled: false,
			connection: { mode: 'remote', host: 'localhost', port: 4400, owned: true },
			calibrateBeforeStart: false,
			recalibrateAfterMeridianFlip: true,
			restoreAfterInterruption: true,
			settle: { tolerance: 1.5, time: 10, timeout: 120, minimumFrames: 5 },
			thresholds: { enabled: false, pauseCaptureWhenExceeded: false },
			recovery: { enabled: false, maximumAttempts: 3, stopBeforeRetry: true, findStarBeforeRetry: true, recalibrate: false, settle: { tolerance: 1.5, time: 10, timeout: 120, minimumFrames: 5 }, onFailure: 'pause' },
			retry: retry(),
		},
		dither: { enabled: true, amount: 3, raOnly: false, beforeFirstFrame: false, afterMeridianFlip: true, afterFilterChange: false, everyFrames: 1, everyTime: 0, settle: { tolerance: 1.5, time: 10, timeout: 120, minimumFrames: 5 }, retry: retry(), onFailure: 'continue' },
		autofocus: {
			enabled: true,
			triggers: { onStart: true, onFilterChange: true, afterMeridianFlip: true, afterRecovery: true, everyFrames: 20, everyTime: 3600, temperatureChange: 1, starSizeChange: 0, minimumTimeBetweenRuns: 600 },
			algorithm: { initialOffsetSteps: 4, stepSize: 100, fittingMode: 'TREND_HYPERBOLIC', rmsdThreshold: 0.5, reversed: false, maximumPosition: 50000, backlash: { enabled: false, mode: 'overshoot', steps: 0 } },
			capture: { exposureTime: 3, frameType: 'LIGHT', binX: 2, binY: 2, gain: 100, offset: 10, subframe: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, transferFormat: 'FITS', compressed: false },
			starDetection: { type: 'nebulosa', timeout: 30, minimumSNR: 10, maximumStars: 500 },
			filterOffsets: [],
			settle: 2,
			retry: retry(),
			onFailure: 'continue',
		},
		rotator: { enabled: false, angle: 0, tolerance: 0.001, settle: 2, moveBeforeCentering: true, restoreAfterMeridianFlip: true, restoreAfterRecovery: true, reverse: false, retry: retry() },
		meridianFlip: {
			enabled: true,
			minimumHourAngle: 0.01,
			maximumHourAngle: 0.1,
			safetyMargin: 60,
			waitForCurrentExposure: true,
			stopGuiding: true,
			pauseDomeSlaving: true,
			settle: 5,
			verifyPierSide: true,
			recenter: true,
			autofocus: false,
			restoreGuiding: true,
			restoreRotator: false,
			maximumAttempts: 3,
			timeout: 600,
			retry: retry(),
			onFailure: 'pause',
		},
		cooling: { enabled: true, temperature: -10, tolerance: 1, ramp: 2, waitForTarget: true, timeout: 900, maintainDuringPause: true, maintainDuringSuspension: true, warmTemperature: 15, warmRamp: 2, warmTimeout: 900, turnCoolerOffAfterWarm: true },
		dome: { enabled: false, closeOnUnsafe: true, slaving: false, synchronizeBeforeCapture: false, settle: 5, timeout: 300, retry: retry(), onFailure: 'pause' },
		cover: { enabled: false, closeOnUnsafe: true, openBeforeCapture: true, closeForDarkFrames: true, timeout: 120, retry: retry() },
		flatPanel: { enabled: false, brightness: 100, brightnessByFilter: [], timeout: 60, retry: retry() },
		calibration: {
			dark: { enabled: false, order: 'afterLights', count: 20, retry: retry(), everyFrames: 0, temperatureChange: 0, matchLightFrames: true, exposureTimes: [], closeCover: true, moveDarkFilter: false },
			bias: { enabled: false, order: 'afterLights', count: 50, retry: retry() },
			flat: {
				enabled: false,
				order: 'afterLights',
				count: 20,
				retry: retry(),
				source: 'panel',
				filters: [],
				exposure: { mode: 'automatic', exposureTime: 1, minimumExposureTime: 0.1, maximumExposureTime: 10, targetMean: 30000, tolerance: 2000, maximumAttempts: 10 },
				rotateAwayFromTarget: false,
				parkMount: false,
			},
			darkFlat: { enabled: false, order: 'afterLights', count: 20, retry: retry(), matchFlatFrames: true, exposureTimes: [], closeCover: true, moveDarkFilter: false },
		},
		monitoring: { enabled: false, interval: 30, monitors: [] },
		safety: {
			enabled: false,
			triggerOnWarning: false,
			abortCurrentExposure: true,
			actions: [],
			recovery: {
				enabled: false,
				automatic: true,
				stableFor: 600,
				maximumWait: 3600,
				maximumAttempts: 3,
				reconnectDevices: true,
				reopenDome: true,
				reopenCover: true,
				unparkMount: true,
				restoreTracking: true,
				restoreRotator: true,
				recenterTarget: true,
				runAutofocus: true,
				restoreGuiding: true,
				resumeCapture: true,
				onFailure: 'pause',
			},
		},
		quality: { enabled: false, starDetection: { type: 'nebulosa', timeout: 30, minimumSNR: 10, maximumStars: 500 }, evaluateEveryFrames: 1, rejectFrame: false, repeatRejectedFrame: false, maximumRepeatedFrames: 0, triggerAutofocus: false, triggerCentering: false, pauseAfterConsecutiveRejectedFrames: 0 },
		execution: {
			start: { type: 'manual' },
			end: { type: 'afterSequence' },
			pauseMode: 'afterCurrentExposure',
			stopMode: 'graceful',
			defaultRetry: retry(),
			checkpoint: { enabled: true, afterEveryAction: true, afterEveryFrame: true, afterEveryArtifact: true, interval: 60 },
			maximumParallelActions: 1,
			releaseResourcesWhilePaused: false,
			releaseResourcesWhileSuspended: false,
			continueAfterApplicationRestart: false,
		},
		storage: { enabled: true, root: '/data/nebulosa', fileNameTemplate: '{target}-{filter}-{exposure}', directoryTemplate: '{target}/{frameType}', atomicWrite: true, overwrite: false, checksum: 'sha256', autoSubFolderMode: 'noon' },
		startup: { enabled: true, actions: [action('connect', { type: 'connectDevices', devices: ['camera', 'mount'] }), action('unpark')], continueOnFailure: false },
		shutdown: { enabled: true, runOnCompletion: true, runOnStop: true, runOnFailure: false, runOnUnsafe: false, actions: [action('park', { type: 'parkMount' }), action('warm', { type: 'warmCamera' })], continueOnFailure: true },
		notification: { enabled: false, events: [], channels: [], minimumSeverity: 'warning' },
	}
}

function ok(definition: Sequencer) {
	const compilation = compile(definition)
	if (!compilation.ok) throw new Error(`expected a plan, got ${JSON.stringify(compilation.diagnostics)}`)
	return compilation
}

describe('lowering', () => {
	test('startup, target and finalize are siblings of the root', () => {
		const { plan } = ok(canonical())

		expect(plan.root.kind).toBe('sequence')
		expect(plan.root.children.map((node) => node.id)).toEqual(['startup', 'target[m42]', 'finalize'])
		expect(plan.definitionId).toBe('definition-1')
		expect(plan.definitionRevision).toBe(7)
	})

	test('the target block lowers slew, center and the capture loop in order', () => {
		const { plan } = ok(canonical())
		const target = plan.root.children[1] as SequencerPlanSequence

		expect(target.children.map((node) => node.id)).toEqual(['target[m42].slew', 'target[m42].center', 'target[m42].capture.loop'])
		expect(target.children.map((node) => node.kind)).toEqual(['action', 'action', 'loop'])
	})

	test('the capture loop carries the cycle body with triggers before frames', () => {
		const { plan } = ok(canonical())
		const target = plan.root.children[1] as SequencerPlanSequence
		const loop = target.children[2] as SequencerPlanLoop

		expect(loop.repeat).toBe(2)
		expect(loop.order).toBe('sequential')
		expect(loop.body.id).toBe('target[m42].capture.cycle')
		expect(loop.body.children.map((node) => node.id)).toEqual(['target[m42].trigger.meridianFlip', 'target[m42].trigger.autofocus', 'target[m42].trigger.dither', 'target[m42].capture.frame[lum]', 'target[m42].capture.frame[red]'])
	})

	test('a disabled trigger produces no node', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, dither: { ...definition.dither, enabled: false }, meridianFlip: { ...definition.meridianFlip, enabled: false } })
		const target = plan.root.children[1] as SequencerPlanSequence
		const loop = target.children[2] as SequencerPlanLoop

		expect(loop.body.children.map((node) => node.id)).toEqual(['target[m42].trigger.autofocus', 'target[m42].capture.frame[lum]', 'target[m42].capture.frame[red]'])
	})

	test('a disabled slew or centering produces no node', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, target: { ...definition.target, goto: { ...definition.target.goto, enabled: false }, center: { ...definition.target.center, enabled: false } } })
		const target = plan.root.children[1] as SequencerPlanSequence

		expect(target.children.map((node) => node.id)).toEqual(['target[m42].capture.loop'])
	})

	test('lifecycle actions keep the declared order and carry no target segment', () => {
		const { plan } = ok(canonical())
		const startup = plan.root.children[0] as SequencerPlanSequence
		const finalize = plan.root.children[2] as SequencerPlanSequence

		expect(startup.children.map((node) => node.id)).toEqual(['startup.action[connect]', 'startup.action[unpark]'])
		expect(finalize.children.map((node) => node.id)).toEqual(['finalize.action[park]', 'finalize.action[warm]'])
		expect(startup.children.every((node) => !node.id.includes('target['))).toBe(true)
		expect(finalize.children.every((node) => !node.id.includes('target['))).toBe(true)
	})

	test('a disabled pipeline or a pipeline with no enabled action produces no block', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, startup: { ...definition.startup, enabled: false }, shutdown: { ...definition.shutdown, actions: [action('park', { type: 'parkMount', enabled: false })] } })

		expect(plan.root.children.map((node) => node.id)).toEqual(['target[m42]'])
		expect(plan.startup).toBeUndefined()
		expect(plan.finalize).toBeUndefined()
	})

	test('the finalize block records the terminal states it runs for', () => {
		const { plan } = ok(canonical())

		expect(plan.finalize).toEqual({ continueOnFailure: true, runOn: ['completed', 'stopped'] })
		expect(plan.startup).toEqual({ continueOnFailure: false })
	})

	test('frame groups resolve the camera overrides and the delay', () => {
		const definition = canonical()
		const frames = [frame('lum'), frame('red', { delay: 12, camera: { binX: 2, binY: 2 }, filter: { type: 'name', name: 'R' } })]
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames } })

		expect(plan.groups.map((group) => group.id)).toEqual(['lum', 'red'])
		expect(plan.groups[0].delay).toBe(4)
		expect(plan.groups[0].camera).toEqual(camera())
		expect(plan.groups[1].delay).toBe(12)
		expect(plan.groups[1].camera).toEqual({ ...camera(), binX: 2, binY: 2 })
		expect(plan.groups[1].filter).toEqual({ type: 'name', name: 'R' })
		expect(plan.groups[1].nodeId).toBe('target[m42].capture.frame[red]')
	})

	test('a disabled frame produces no group', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum'), frame('red', { enabled: false })] } })

		expect(plan.groups.map((group) => group.id)).toEqual(['lum'])
	})

	test('the plan collects the roles it commands', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { filter: { type: 'position', position: 1 } })] } })

		expect(plan.roles).toEqual(['camera', 'mount', 'wheel', 'focuser'])
	})

	test('storage decisions are carried into the plan', () => {
		const { plan } = ok(canonical())

		expect(plan.storage).toEqual({ root: '/data/nebulosa', fileNameTemplate: '{target}-{filter}-{exposure}', directoryTemplate: '{target}/{frameType}', temporaryDirectory: undefined, checksum: 'sha256', autoSubFolderMode: 'noon' })
	})

	test('compiling the same definition twice produces an identical plan', () => {
		const a = ok(canonical())
		const b = ok(canonical())

		expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan))
	})

	test('a definition with no enabled frame is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { enabled: false })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames', message: 'the definition has no enabled frame group to capture' }])
	})

	test('a disabled target is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, target: { ...definition.target, enabled: false } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics[0].path).toBe('target.enabled')
	})
})

describe('structural validation', () => {
	test('a repeated frame id is refused at the property that repeats it', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum'), frame('lum')] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames[1].id', message: 'the frame id "lum" is declared more than once' }])
	})

	test('an empty lifecycle action id is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, shutdown: { ...definition.shutdown, actions: [action('', { type: 'parkMount' })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'shutdown.actions[0].id', message: 'the shutdown action id is empty and cannot address a node' }])
	})

	test('a feature commanding a role the definition does not declare is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, devices: { camera: 'Camera Simulator', mount: 'Mount Simulator', wheel: 'Wheel Simulator' } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'devices.focuser', message: 'autofocus requires the focuser role, which the definition does not declare' }])
	})

	test('a lifecycle action commanding a missing role names the role', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, shutdown: { ...definition.shutdown, actions: [action('close', { type: 'closeDome' })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'devices.dome', message: 'shutdown.actions[0] requires the dome role, which the definition does not declare' }])
	})

	test('a disabled lifecycle action requires no role', () => {
		const definition = canonical()

		expect(ok({ ...definition, shutdown: { ...definition.shutdown, actions: [action('close', { type: 'closeDome', enabled: false })] } }).plan.roles).not.toContain('dome')
	})

	test('a role required twice is reserved once', () => {
		const { plan } = ok(canonical())

		expect(plan.roles).toEqual(['camera', 'mount', 'focuser'])
	})

	test('without a registry the block types are not resolved', () => {
		expect(ok(canonical()).ok).toBe(true)
	})

	test('an unregistered block type is refused at the node that needs it', () => {
		const registry = new SequencerBlockRegistry()
		const compilation = compile(canonical(), { registry })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics[0]).toEqual({ path: 'startup.action[connect]', message: 'no handler is registered for the block type "lifecycle.connectDevices"' })
	})

	test('a handler issue is addressed below the node it came from', () => {
		const registry = new SequencerBlockRegistry()

		for (const type of ['slew', 'center', 'capture.frame', 'trigger.autofocus', 'trigger.dither', 'trigger.meridianFlip', 'lifecycle.connectDevices', 'lifecycle.unparkMount', 'lifecycle.parkMount', 'lifecycle.warmCamera']) {
			registry.register({
				type,
				version: 1,
				validate: (configuration) => (type === 'slew' ? { ok: false, issues: [{ path: 'tolerance', message: 'the tolerance is below the arrival tolerance' }] } : { ok: true, configuration }),
				resources: () => [],
				execute: () => Promise.resolve({ type: 'completed', value: undefined } as const),
			})
		}

		const compilation = compile(canonical(), { registry })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'target[m42].slew.tolerance', message: 'the tolerance is below the arrival tolerance' }])
	})
})

describe('termination', () => {
	test('a frame count alone decides the slots', () => {
		const { plan } = ok(canonical())

		expect(plan.groups[0].requiredSlots).toBe(10)
		expect(plan.groups[0].abandonmentBudget).toBe(0)
		expect(plan.groups[0].slotLimit).toBe(10)
		expect(plan.groups[0].projectedIntegration).toBe(600)
	})

	test('an integration time alone decides the slots, rounded up', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: 500, exposureTime: 60 })] } })

		expect(plan.groups[0].requiredSlots).toBe(9)
		expect(plan.groups[0].projectedIntegration).toBe(540)
	})

	test('with both criteria active the cheaper one decides the slots', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 10, integrationTime: 300, exposureTime: 60 }), frame('red', { count: 3, integrationTime: 600, exposureTime: 60 })] } })

		expect(plan.groups.map((group) => group.requiredSlots)).toEqual([5, 3])
	})

	test('the abandonment budget raises the slot limit without raising the target', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 10, abandonmentBudget: 2 })] } })

		expect(plan.groups[0].requiredSlots).toBe(10)
		expect(plan.groups[0].slotLimit).toBe(12)
		expect(plan.groups[0].projectedIntegration).toBe(600)
	})

	test('the exposures of one cycle are bounded by the slot limit times the attempts per slot', () => {
		const { plan } = ok(canonical())
		const group = plan.groups[0]

		expect(group.slotLimit * group.retry.maxAttempts).toBe(30)
	})

	test('a group with neither criterion is disabled', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, capture: { ...definition.capture, frames: [frame('lum'), frame('red', { count: 0, integrationTime: 0 })] } })

		expect(plan.groups.map((group) => group.id)).toEqual(['lum'])
	})

	test('a definition whose every group is disabled by its criteria is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: 0 })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames', message: 'the definition has no enabled frame group to capture' }])
	})

	test('an integration time with a zero exposure time is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [frame('lum', { count: 0, integrationTime: 600, exposureTime: 0 })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.frames[0].exposureTime', message: 'a frame group with an integration time requires a positive exposure time' }])
	})

	test('a capture with no cycle is refused', () => {
		const definition = canonical()
		const compilation = compile({ ...definition, capture: { ...definition.capture, repeat: 0 } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics).toEqual([{ path: 'capture.repeat', message: 'the capture must run at least one cycle' }])
	})
})

describe('node identity', () => {
	test('every node id is unique', () => {
		const { plan } = ok(canonical())
		const ids = [...sequencerPlanNodes(plan.root)].map((node) => node.id)

		expect(new Set(ids).size).toBe(ids.length)
	})

	test('inserting an action does not rename any other node', () => {
		const definition = canonical()
		const before = [...sequencerPlanNodes(ok(definition).plan.root)].map((node) => node.id)
		const actions = [definition.startup.actions[0], action('cool', { type: 'coolCamera' }), definition.startup.actions[1]]
		const after = [...sequencerPlanNodes(ok({ ...definition, startup: { ...definition.startup, actions } }).plan.root)].map((node) => node.id)

		expect(after).toContain('startup.action[cool]')
		expect(after.filter((id) => id !== 'startup.action[cool]')).toEqual(before)
	})

	test('inserting a frame does not rename any other capture node', () => {
		const definition = canonical()
		const before = ok(definition).plan.groups.map((group) => group.nodeId)
		const frames = [frame('lum'), frame('green'), frame('red')]
		const after = ok({ ...definition, capture: { ...definition.capture, frames } }).plan.groups.map((group) => group.nodeId)

		expect(after).toEqual(['target[m42].capture.frame[lum]', 'target[m42].capture.frame[green]', 'target[m42].capture.frame[red]'])
		expect(after.filter((id) => !id.includes('green'))).toEqual(before)
	})

	test('reordering frames keeps the node id of each one', () => {
		const definition = canonical()
		const reversed = ok({ ...definition, capture: { ...definition.capture, frames: [frame('red'), frame('lum')] } }).plan

		expect(reversed.groups.map((group) => group.nodeId)).toEqual(['target[m42].capture.frame[red]', 'target[m42].capture.frame[lum]'])
	})

	test('renaming a target changes no node id', () => {
		const definition = canonical()
		const before = [...sequencerPlanNodes(ok(definition).plan.root)].map((node) => node.id)
		const after = [...sequencerPlanNodes(ok({ ...definition, target: { ...definition.target, name: 'Great Orion Nebula' } }).plan.root)].map((node) => node.id)

		expect(after).toEqual(before)
	})

	test('the target segment is below the target and never in a pipeline', () => {
		const { plan } = ok(canonical())
		const segment = sequencerNodeId.target('m42')

		for (const node of sequencerPlanNodes(plan.root)) {
			if (node.id === 'plan' || node.id.startsWith('startup') || node.id.startsWith('finalize')) expect(node.id).not.toContain(segment)
			else expect(node.id.startsWith(segment)).toBe(true)
		}
	})

	test('another target id moves only the nodes below the target', () => {
		const definition = canonical()
		const { plan } = ok({ ...definition, target: { ...definition.target, id: 'm31' } })
		const ids = [...sequencerPlanNodes(plan.root)].map((node) => node.id)

		expect(ids).toContain('target[m31].capture.frame[lum]')
		expect(ids).toContain('startup.action[connect]')
		expect(ids.some((id) => id.includes('m42'))).toBe(false)
	})

	test('the loop body is entered exactly once by the traversal', () => {
		const { plan } = ok(canonical())
		const ids = [...sequencerPlanNodes(plan.root)].map((node) => node.id)

		expect(ids.filter((id) => id === 'target[m42].capture.cycle')).toHaveLength(1)
	})
})
