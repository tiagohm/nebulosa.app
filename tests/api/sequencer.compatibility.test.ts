import { describe, expect, test } from 'bun:test'
import { compile } from 'src/api/sequencer.compiler'
import type { Sequencer } from '#/sequencer'
import { action, complete } from './sequencer.fixture'

const CONSUMED = [
	'schemaVersion',
	'id',
	'revision',
	'name',
	'description',
	'devices.camera',
	'devices.mount',
	'devices.wheel',
	'devices.focuser',
	'devices.rotator',
	'devices.guideCamera',
	'devices.guideOutput',
	'devices.cover',
	'devices.flatPanel',
	'devices.dome',
	'target.id',
	'target.name',
	'target.enabled',
	'target.type',
	'target.J2000.x',
	'target.J2000.y',
	'target.tracking.enabled',
	'target.tracking.mode',
	'target.tracking.retry.maxAttempts',
	'target.tracking.retry.delay',
	'target.tracking.retry.backoff',
	'target.tracking.retry.maximumDelay',
	'target.tracking.retry.retryOn[]',
	'target.tracking.retry.onExhausted',
	'target.tracking.rightAscensionRate',
	'target.tracking.declinationRate',
	'target.goto.enabled',
	'target.goto.skipWhenAlreadyAtTarget',
	'target.goto.tolerance',
	'target.goto.arrivalTolerance',
	'target.goto.timeout',
	'target.goto.settle',
	'target.goto.retry.maxAttempts',
	'target.goto.retry.delay',
	'target.goto.retry.backoff',
	'target.goto.retry.maximumDelay',
	'target.goto.retry.retryOn[]',
	'target.goto.retry.onExhausted',
	'target.center.enabled',
	'target.center.solver.type',
	'target.center.solver.timeout',
	'target.center.solver.blind',
	'target.center.solver.searchRadius',
	'target.center.solver.downsample',
	'target.center.solver.maximumStars',
	'target.center.solver.minimumSNR',
	'target.center.tolerance',
	'target.center.maximumAttempts',
	'target.center.settle',
	'target.center.syncMount',
	'target.center.finalSolve',
	'target.center.recenterAfterDrift',
	'target.center.driftTolerance',
	'target.center.checkEveryFrames',
	'target.center.checkEveryTime',
	'target.center.capture.exposureTime',
	'target.center.capture.frameType',
	'target.center.capture.binX',
	'target.center.capture.binY',
	'target.center.capture.gain',
	'target.center.capture.offset',
	'target.center.capture.subframe.enabled',
	'target.center.capture.subframe.x',
	'target.center.capture.subframe.y',
	'target.center.capture.subframe.width',
	'target.center.capture.subframe.height',
	'target.center.capture.transferFormat',
	'target.center.capture.compressed',
	'target.center.retry.maxAttempts',
	'target.center.retry.delay',
	'target.center.retry.backoff',
	'target.center.retry.maximumDelay',
	'target.center.retry.retryOn[]',
	'target.center.retry.onExhausted',
	'capture.order',
	'capture.repeat',
	'capture.frames[].id',
	'capture.frames[].name',
	'capture.frames[].enabled',
	'capture.frames[].frameType',
	'capture.frames[].exposureTime',
	'capture.frames[].count',
	'capture.frames[].integrationTime',
	'capture.frames[].weight',
	'capture.frames[].camera.binX',
	'capture.frames[].camera.binY',
	'capture.frames[].camera.gain',
	'capture.frames[].camera.offset',
	'capture.frames[].camera.frameFormat',
	'capture.frames[].camera.transferFormat',
	'capture.frames[].camera.compressed',
	'capture.frames[].camera.subframe.enabled',
	'capture.frames[].camera.subframe.x',
	'capture.frames[].camera.subframe.y',
	'capture.frames[].camera.subframe.width',
	'capture.frames[].camera.subframe.height',
	'capture.frames[].abandonmentBudget',
	'capture.frames[].delay',
	'capture.frames[].filter.type',
	'capture.frames[].filter.name',
	'capture.defaults.binX',
	'capture.defaults.binY',
	'capture.defaults.gain',
	'capture.defaults.offset',
	'capture.defaults.frameFormat',
	'capture.defaults.transferFormat',
	'capture.defaults.compressed',
	'capture.defaults.subframe.enabled',
	'capture.defaults.subframe.x',
	'capture.defaults.subframe.y',
	'capture.defaults.subframe.width',
	'capture.defaults.subframe.height',
	'capture.delay',
	'capture.settle',
	'capture.retry.maxAttempts',
	'capture.retry.delay',
	'capture.retry.backoff',
	'capture.retry.maximumDelay',
	'capture.retry.retryOn[]',
	'capture.retry.onExhausted',
	'guiding.enabled',
	'guiding.connection.mode',
	'guiding.connection.host',
	'guiding.connection.port',
	'guiding.connection.profile',
	'guiding.connection.owned',
	'guiding.calibrateBeforeStart',
	'guiding.recalibrateAfterMeridianFlip',
	'guiding.restoreAfterInterruption',
	'guiding.settle.tolerance',
	'guiding.settle.time',
	'guiding.settle.timeout',
	'guiding.settle.minimumFrames',
	'guiding.retry.maxAttempts',
	'guiding.retry.delay',
	'guiding.retry.backoff',
	'guiding.retry.maximumDelay',
	'guiding.retry.retryOn[]',
	'guiding.retry.onExhausted',
	'dither.enabled',
	'dither.amount',
	'dither.raOnly',
	'dither.beforeFirstFrame',
	'dither.afterMeridianFlip',
	'dither.afterFilterChange',
	'dither.everyFrames',
	'dither.everyTime',
	'dither.settle.tolerance',
	'dither.settle.time',
	'dither.settle.timeout',
	'dither.settle.minimumFrames',
	'dither.retry.maxAttempts',
	'dither.retry.delay',
	'dither.retry.backoff',
	'dither.retry.maximumDelay',
	'dither.retry.retryOn[]',
	'dither.retry.onExhausted',
	'dither.onFailure',
	'autofocus.enabled',
	'autofocus.triggers.onStart',
	'autofocus.triggers.onFilterChange',
	'autofocus.triggers.afterMeridianFlip',
	'autofocus.triggers.afterRecovery',
	'autofocus.triggers.everyFrames',
	'autofocus.triggers.everyTime',
	'autofocus.triggers.temperatureChange',
	'autofocus.triggers.minimumTimeBetweenRuns',
	'autofocus.algorithm.initialOffsetSteps',
	'autofocus.algorithm.stepSize',
	'autofocus.algorithm.fittingMode',
	'autofocus.algorithm.rmsdThreshold',
	'autofocus.algorithm.reversed',
	'autofocus.algorithm.maximumPosition',
	'autofocus.algorithm.backlash.enabled',
	'autofocus.algorithm.backlash.mode',
	'autofocus.algorithm.backlash.steps',
	'autofocus.capture.exposureTime',
	'autofocus.capture.frameType',
	'autofocus.capture.binX',
	'autofocus.capture.binY',
	'autofocus.capture.gain',
	'autofocus.capture.offset',
	'autofocus.capture.subframe.enabled',
	'autofocus.capture.subframe.x',
	'autofocus.capture.subframe.y',
	'autofocus.capture.subframe.width',
	'autofocus.capture.subframe.height',
	'autofocus.capture.transferFormat',
	'autofocus.capture.compressed',
	'autofocus.starDetection.type',
	'autofocus.starDetection.timeout',
	'autofocus.starDetection.minimumSNR',
	'autofocus.starDetection.maximumStars',
	'autofocus.filterOffsets',
	'autofocus.settle',
	'autofocus.retry.maxAttempts',
	'autofocus.retry.delay',
	'autofocus.retry.backoff',
	'autofocus.retry.maximumDelay',
	'autofocus.retry.retryOn[]',
	'autofocus.retry.onExhausted',
	'autofocus.onFailure',
	'meridianFlip.enabled',
	'meridianFlip.minimumHourAngle',
	'meridianFlip.maximumHourAngle',
	'meridianFlip.safetyMargin',
	'meridianFlip.waitForCurrentExposure',
	'meridianFlip.stopGuiding',
	'meridianFlip.pauseDomeSlaving',
	'meridianFlip.settle',
	'meridianFlip.verifyPierSide',
	'meridianFlip.recenter',
	'meridianFlip.autofocus',
	'meridianFlip.restoreGuiding',
	'meridianFlip.restoreRotator',
	'meridianFlip.maximumAttempts',
	'meridianFlip.timeout',
	'meridianFlip.retry.maxAttempts',
	'meridianFlip.retry.delay',
	'meridianFlip.retry.backoff',
	'meridianFlip.retry.maximumDelay',
	'meridianFlip.retry.retryOn[]',
	'meridianFlip.retry.onExhausted',
	'meridianFlip.onFailure',
	'cooling.enabled',
	'cooling.temperature',
	'cooling.tolerance',
	'cooling.ramp',
	'cooling.waitForTarget',
	'cooling.timeout',
	'cooling.maintainDuringPause',
	'cooling.maintainDuringSuspension',
	'cooling.warmTemperature',
	'cooling.warmRamp',
	'cooling.warmTimeout',
	'cooling.turnCoolerOffAfterWarm',
	'execution.start.type',
	'execution.end.type',
	'execution.pauseMode',
	'execution.stopMode',
	'execution.defaultRetry.maxAttempts',
	'execution.defaultRetry.delay',
	'execution.defaultRetry.backoff',
	'execution.defaultRetry.maximumDelay',
	'execution.defaultRetry.retryOn[]',
	'execution.defaultRetry.onExhausted',
	'execution.checkpoint.afterEveryAction',
	'execution.checkpoint.afterEveryFrame',
	'execution.checkpoint.afterEveryArtifact',
	'execution.checkpoint.interval',
	'storage.root',
	'storage.fileNameTemplate',
	'storage.directoryTemplate',
	'storage.checksum',
	'storage.autoSubFolderMode',
	'storage.temporaryDirectory',
	'startup.enabled',
	'startup.actions[].id',
	'startup.actions[].enabled',
	'startup.actions[].timeout',
	'startup.actions[].retry.maxAttempts',
	'startup.actions[].retry.delay',
	'startup.actions[].retry.backoff',
	'startup.actions[].retry.maximumDelay',
	'startup.actions[].retry.retryOn[]',
	'startup.actions[].retry.onExhausted',
	'startup.actions[].type',
	'startup.actions[].devices[]',
	'startup.actions[].required',
	'startup.continueOnFailure',
	'shutdown.enabled',
	'shutdown.runOnCompletion',
	'shutdown.runOnStop',
	'shutdown.runOnFailure',
	'shutdown.actions[].id',
	'shutdown.actions[].enabled',
	'shutdown.actions[].timeout',
	'shutdown.actions[].retry.maxAttempts',
	'shutdown.actions[].retry.delay',
	'shutdown.actions[].retry.backoff',
	'shutdown.actions[].retry.maximumDelay',
	'shutdown.actions[].retry.retryOn[]',
	'shutdown.actions[].retry.onExhausted',
	'shutdown.actions[].type',
	'shutdown.actions[].required',
	'shutdown.continueOnFailure',
]

interface Classified {
	readonly root: string
	readonly path: string
	readonly declare: (definition: Sequencer) => Sequencer
}

const REJECTED: readonly Classified[] = [
	{ root: 'enabled', path: 'enabled', declare: (d) => ({ ...d, enabled: false }) },
	{ root: 'target.constraints', path: 'target.constraints.enabled', declare: (d) => ({ ...d, target: { ...d.target, constraints: { ...d.target.constraints, enabled: true } } }) },
	{ root: 'capture.abortOnDeviceAlert', path: 'capture.abortOnDeviceAlert', declare: (d) => ({ ...d, capture: { ...d.capture, abortOnDeviceAlert: true } }) },
	{ root: 'guiding.thresholds', path: 'guiding.thresholds.enabled', declare: (d) => ({ ...d, guiding: { ...d.guiding, thresholds: { ...d.guiding.thresholds, enabled: true } } }) },
	{ root: 'guiding.recovery', path: 'guiding.recovery.enabled', declare: (d) => ({ ...d, guiding: { ...d.guiding, recovery: { ...d.guiding.recovery, enabled: true } } }) },
	{ root: 'autofocus.triggers.starSizeChange', path: 'autofocus.triggers.starSizeChange', declare: (d) => ({ ...d, autofocus: { ...d.autofocus, triggers: { ...d.autofocus.triggers, starSizeChange: 0.2 } } }) },
	{ root: 'rotator', path: 'rotator.enabled', declare: (d) => ({ ...d, rotator: { ...d.rotator, enabled: true } }) },
	{ root: 'dome', path: 'dome.enabled', declare: (d) => ({ ...d, dome: { ...d.dome, enabled: true } }) },
	{ root: 'cover', path: 'cover.enabled', declare: (d) => ({ ...d, cover: { ...d.cover, enabled: true } }) },
	{ root: 'flatPanel', path: 'flatPanel.enabled', declare: (d) => ({ ...d, flatPanel: { ...d.flatPanel, enabled: true } }) },
	{ root: 'calibration.dark', path: 'calibration.dark.enabled', declare: (d) => ({ ...d, calibration: { ...d.calibration, dark: { ...d.calibration.dark, enabled: true } } }) },
	{ root: 'calibration.bias', path: 'calibration.bias.enabled', declare: (d) => ({ ...d, calibration: { ...d.calibration, bias: { ...d.calibration.bias, enabled: true } } }) },
	{ root: 'calibration.flat', path: 'calibration.flat.enabled', declare: (d) => ({ ...d, calibration: { ...d.calibration, flat: { ...d.calibration.flat, enabled: true } } }) },
	{ root: 'calibration.darkFlat', path: 'calibration.darkFlat.enabled', declare: (d) => ({ ...d, calibration: { ...d.calibration, darkFlat: { ...d.calibration.darkFlat, enabled: true } } }) },
	{ root: 'monitoring', path: 'monitoring.enabled', declare: (d) => ({ ...d, monitoring: { ...d.monitoring, enabled: true } }) },
	{ root: 'safety', path: 'safety.enabled', declare: (d) => ({ ...d, safety: { ...d.safety, enabled: true } }) },
	{ root: 'quality', path: 'quality.enabled', declare: (d) => ({ ...d, quality: { ...d.quality, enabled: true } }) },
	{ root: 'execution.checkpoint.enabled', path: 'execution.checkpoint.enabled', declare: (d) => ({ ...d, execution: { ...d.execution, checkpoint: { ...d.execution.checkpoint, enabled: false } } }) },
	{ root: 'execution.maximumParallelActions', path: 'execution.maximumParallelActions', declare: (d) => ({ ...d, execution: { ...d.execution, maximumParallelActions: 2 } }) },
	{ root: 'execution.releaseResourcesWhilePaused', path: 'execution.releaseResourcesWhilePaused', declare: (d) => ({ ...d, execution: { ...d.execution, releaseResourcesWhilePaused: true } }) },
	{ root: 'execution.releaseResourcesWhileSuspended', path: 'execution.releaseResourcesWhileSuspended', declare: (d) => ({ ...d, execution: { ...d.execution, releaseResourcesWhileSuspended: true } }) },
	{ root: 'execution.continueAfterApplicationRestart', path: 'execution.continueAfterApplicationRestart', declare: (d) => ({ ...d, execution: { ...d.execution, continueAfterApplicationRestart: true } }) },
	{ root: 'storage.enabled', path: 'storage.enabled', declare: (d) => ({ ...d, storage: { ...d.storage, enabled: false } }) },
	{ root: 'storage.atomicWrite', path: 'storage.atomicWrite', declare: (d) => ({ ...d, storage: { ...d.storage, atomicWrite: false } }) },
	{ root: 'storage.overwrite', path: 'storage.overwrite', declare: (d) => ({ ...d, storage: { ...d.storage, overwrite: true } }) },
	{ root: 'shutdown.runOnUnsafe', path: 'shutdown.runOnUnsafe', declare: (d) => ({ ...d, shutdown: { ...d.shutdown, runOnUnsafe: true } }) },
]

const REMOVED: readonly Classified[] = [
	{ root: 'notification', path: 'notification', declare: (d) => ({ ...d, notification: { ...d.notification, enabled: true } }) },
	{ root: 'capture.continueAfterRejectedFrame', path: 'capture.continueAfterRejectedFrame', declare: (d) => ({ ...d, capture: { ...d.capture, continueAfterRejectedFrame: true } }) },
]

function leaves(value: unknown, prefix: string, out: string[]) {
	if (Array.isArray(value)) {
		if (value.length === 0) out.push(prefix)
		else leaves(value[0], `${prefix}[]`, out)
		return
	}

	if (value !== null && typeof value === 'object') {
		for (const [key, item] of Object.entries(value)) leaves(item, prefix ? `${prefix}.${key}` : key, out)
		return
	}

	out.push(prefix)
}

function classifiedBy(path: string, entries: readonly Classified[]) {
	return entries.some((entry) => path === entry.root || path.startsWith(`${entry.root}.`))
}

describe('compatibility rule', () => {
	test('every property of a complete definition is consumed, rejected or observably removed', () => {
		const paths: string[] = []
		leaves(complete(), '', paths)
		const consumed = new Set(CONSUMED)
		const unclassified = paths.filter((path) => !consumed.has(path) && !classifiedBy(path, REJECTED) && !classifiedBy(path, REMOVED))

		expect(unclassified).toEqual([])
	})

	test('no classification is stale', () => {
		const paths: string[] = []
		leaves(complete(), '', paths)
		const declared = new Set(paths)
		const stale = CONSUMED.filter((path) => !declared.has(path))
		const orphans = [...REJECTED, ...REMOVED].filter((entry) => !paths.some((path) => path === entry.root || path.startsWith(`${entry.root}.`)))

		expect(stale).toEqual([])
		expect(orphans.map((entry) => entry.root)).toEqual([])
	})

	test('a complete definition compiles', () => {
		const compilation = compile(complete())

		expect(compilation.ok).toBe(true)
	})

	for (const entry of REJECTED) {
		test(`declaring ${entry.path} is rejected`, () => {
			const compilation = compile(entry.declare(complete()))

			expect(compilation.ok).toBe(false)
			if (!compilation.ok) expect(compilation.diagnostics.map((diagnostic) => diagnostic.path)).toContain(entry.path)
		})
	}

	for (const entry of REMOVED) {
		test(`declaring ${entry.path} is observably removed`, () => {
			const compilation = compile(entry.declare(complete()))

			expect(compilation.ok).toBe(true)
			if (compilation.ok) expect(compilation.removals.map((removal) => removal.path)).toContain(entry.path)
		})
	}

	test('a definition serialized against another schema version is rejected', () => {
		const compilation = compile({ ...complete(), schemaVersion: 2 } as unknown as Sequencer)

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics.map((diagnostic) => diagnostic.path)).toContain('schemaVersion')
	})

	test('an altitude start or end condition is rejected', () => {
		const definition = complete()
		const start = compile({ ...definition, execution: { ...definition.execution, start: { type: 'sunAltitude', altitude: -0.2, direction: 'setting' } } })
		const end = compile({ ...definition, execution: { ...definition.execution, end: { type: 'targetAltitude', altitude: 0.5, direction: 'setting' } } })

		expect(start.ok).toBe(false)
		if (!start.ok) expect(start.diagnostics.map((diagnostic) => diagnostic.path)).toContain('execution.start.type')
		expect(end.ok).toBe(false)
		if (!end.ok) expect(end.diagnostics.map((diagnostic) => diagnostic.path)).toContain('execution.end.type')
	})

	test('a dome lifecycle action is rejected', () => {
		const definition = complete()
		const compilation = compile({ ...definition, startup: { ...definition.startup, actions: [action('open', { type: 'openDome' })] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics.map((diagnostic) => diagnostic.path)).toContain('startup.actions[0].type')
	})

	test('a disabled dome lifecycle action is not rejected', () => {
		const definition = complete()
		const compilation = compile({ ...definition, startup: { ...definition.startup, actions: [action('open', { type: 'openDome', enabled: false }), action('unpark')] } })

		expect(compilation.ok).toBe(true)
	})
})
