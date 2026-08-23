import { describe, expect, test } from 'bun:test'
import { compile } from 'src/api/sequencer.compiler'
import type { Sequencer } from '#/sequencer'
import { complete } from './sequencer.fixture'

const CONSUMED = [
	'schemaVersion',
	'id',
	'revision',
	'name',
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
	'target.type',
	'target.J2000.x',
	'target.J2000.y',
	'target.timeout',
	'target.settle',
	'target.retry.maxAttempts',
	'target.retry.delay',
	'target.retry.backoff',
	'target.retry.maximumDelay',
	'target.retry.retryOn[]',
	'target.retry.onExhausted',
	'target.tracking.enabled',
	'target.tracking.mode',
	'target.tracking.stopOnShutdown',
	'target.tracking.retry.maxAttempts',
	'target.tracking.retry.delay',
	'target.tracking.retry.backoff',
	'target.tracking.retry.maximumDelay',
	'target.tracking.retry.retryOn[]',
	'target.tracking.retry.onExhausted',
	'target.center.enabled',
	'target.center.solver.type',
	'target.center.solver.timeout',
	'target.center.solver.blind',
	'target.center.solver.radius',
	'target.center.solver.downsample',
	'target.center.solver.executable',
	'target.center.solver.focalLength',
	'target.center.solver.pixelSize',
	'target.center.solver.fov',
	'target.center.solver.rightAscension',
	'target.center.solver.declination',
	'target.center.solver.apiUrl',
	'target.center.solver.apiKey',
	'target.center.tolerance',
	'target.center.maximumAttempts',
	'target.center.settle',
	'target.center.syncMount',
	'target.center.capture.exposureTime',
	'target.center.capture.frameType',
	'target.center.capture.binX',
	'target.center.capture.binY',
	'target.center.capture.gain',
	'target.center.capture.offset',
	'target.center.capture.subframe',
	'target.center.capture.x',
	'target.center.capture.y',
	'target.center.capture.width',
	'target.center.capture.height',
	'target.center.capture.transferFormat',
	'target.center.capture.frameFormat',
	'target.center.capture.compressed',
	'target.center.retry.maxAttempts',
	'target.center.retry.delay',
	'target.center.retry.backoff',
	'target.center.retry.maximumDelay',
	'target.center.retry.retryOn[]',
	'target.center.retry.onExhausted',
	'capture.repeat',
	'capture.frames[].id',
	'capture.frames[].name',
	'capture.frames[].enabled',
	'capture.frames[].frameType',
	'capture.frames[].exposureTime',
	'capture.frames[].count',
	'capture.frames[].weight',
	'capture.frames[].camera.binX',
	'capture.frames[].camera.binY',
	'capture.frames[].camera.gain',
	'capture.frames[].camera.offset',
	'capture.frames[].camera.frameFormat',
	'capture.frames[].camera.transferFormat',
	'capture.frames[].camera.compressed',
	'capture.frames[].camera.subframe',
	'capture.frames[].camera.x',
	'capture.frames[].camera.y',
	'capture.frames[].camera.width',
	'capture.frames[].camera.height',
	'capture.frames[].abandonmentBudget',
	'capture.frames[].delay',
	'capture.frames[].filter.type',
	'capture.frames[].filter.name',
	'capture.binX',
	'capture.binY',
	'capture.gain',
	'capture.offset',
	'capture.frameFormat',
	'capture.transferFormat',
	'capture.compressed',
	'capture.subframe',
	'capture.x',
	'capture.y',
	'capture.width',
	'capture.height',
	'capture.delay',
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
	'guiding.calibrateBeforeStart',
	'guiding.recalibrateAfterMeridianFlip',
	'guiding.stopOnShutdown',
	'guiding.settle.tolerance',
	'guiding.settle.time',
	'guiding.settle.timeout',
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
	'dither.afterFilterChange',
	'dither.everyFrames',
	'dither.everyTime',
	'dither.retry.maxAttempts',
	'dither.retry.delay',
	'dither.retry.backoff',
	'dither.retry.maximumDelay',
	'dither.retry.retryOn[]',
	'dither.onFailure',
	'autofocus.enabled',
	'autofocus.triggers.onStart',
	'autofocus.triggers.onFilterChange',
	'autofocus.triggers.afterMeridianFlip',
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
	'autofocus.capture.subframe',
	'autofocus.capture.x',
	'autofocus.capture.y',
	'autofocus.capture.width',
	'autofocus.capture.height',
	'autofocus.capture.transferFormat',
	'autofocus.capture.frameFormat',
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
	'autofocus.onFailure',
	'meridianFlip.enabled',
	'meridianFlip.minimumHourAngle',
	'meridianFlip.maximumHourAngle',
	'meridianFlip.safetyMargin',
	'meridianFlip.settle',
	'meridianFlip.timeout',
	'meridianFlip.retry.maxAttempts',
	'meridianFlip.retry.delay',
	'meridianFlip.retry.backoff',
	'meridianFlip.retry.maximumDelay',
	'meridianFlip.retry.retryOn[]',
	'meridianFlip.onFailure',
	'mount.enabled',
	'mount.unparkOnStartup',
	'mount.parkOnShutdown',
	'mount.timeout',
	'mount.retry.maxAttempts',
	'mount.retry.delay',
	'mount.retry.backoff',
	'mount.retry.maximumDelay',
	'mount.retry.retryOn[]',
	'mount.retry.onExhausted',
	'cooling.enabled',
	'cooling.temperature',
	'cooling.tolerance',
	'cooling.ramp',
	'cooling.waitForTarget',
	'cooling.timeout',
	'cooling.warmTemperature',
	'cooling.warmRamp',
	'cooling.turnCoolerOffAfterWarm',
	'cooling.warmOnShutdown',
	'cooling.retry.maxAttempts',
	'cooling.retry.delay',
	'cooling.retry.backoff',
	'cooling.retry.maximumDelay',
	'cooling.retry.retryOn[]',
	'cooling.retry.onExhausted',
	'rotator.enabled',
	'rotator.angle',
	'rotator.tolerance',
	'rotator.settle',
	'rotator.moveBeforeCentering',
	'rotator.restoreAfterMeridianFlip',
	'rotator.reverse',
	'rotator.retry.maxAttempts',
	'rotator.retry.delay',
	'rotator.retry.backoff',
	'rotator.retry.maximumDelay',
	'rotator.retry.retryOn[]',
	'rotator.retry.onExhausted',
	'cover.enabled',
	'cover.openOnStartup',
	'cover.closeOnShutdown',
	'cover.closeOnUnsafe',
	'cover.openBeforeCapture',
	'cover.closeForDarkFrames',
	'cover.timeout',
	'cover.retry.maxAttempts',
	'cover.retry.delay',
	'cover.retry.backoff',
	'cover.retry.maximumDelay',
	'cover.retry.retryOn[]',
	'cover.retry.onExhausted',
	'flatPanel.enabled',
	'flatPanel.brightness',
	'flatPanel.brightnessByFilter',
	'flatPanel.timeout',
	'flatPanel.retry.maxAttempts',
	'flatPanel.retry.delay',
	'flatPanel.retry.backoff',
	'flatPanel.retry.maximumDelay',
	'flatPanel.retry.retryOn[]',
	'flatPanel.retry.onExhausted',
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
	'storage.autoSubFolderMode',
	'storage.temporaryDirectory',
	'startup.enabled',
	'startup.continueOnFailure',
	'shutdown.enabled',
	'shutdown.runOnCompletion',
	'shutdown.runOnStop',
	'shutdown.runOnFailure',
	'shutdown.continueOnFailure',
]

interface Classified {
	readonly root: string
	readonly path: string
	readonly declare: (definition: Sequencer) => Sequencer
}

const REJECTED: readonly Classified[] = [
	{ root: 'target.constraints', path: 'target.constraints.enabled', declare: (d) => ({ ...d, target: { ...d.target, constraints: { ...d.target.constraints, enabled: true } } }) },
	{ root: 'capture.order', path: 'capture.order', declare: (d) => ({ ...d, capture: { ...d.capture, order: 'roundRobin' } }) },
	{ root: 'guiding.thresholds', path: 'guiding.thresholds.enabled', declare: (d) => ({ ...d, guiding: { ...d.guiding, thresholds: { ...d.guiding.thresholds, enabled: true } } }) },
	{ root: 'guiding.recovery', path: 'guiding.recovery.enabled', declare: (d) => ({ ...d, guiding: { ...d.guiding, recovery: { ...d.guiding.recovery, enabled: true } } }) },
	{ root: 'dome', path: 'dome.enabled', declare: (d) => ({ ...d, dome: { ...d.dome, enabled: true } }) },
	{ root: 'cover.closeOnUnsafe', path: 'cover.closeOnUnsafe', declare: (d) => ({ ...d, cover: { ...d.cover, enabled: true, closeOnUnsafe: true } }) },
	{ root: 'rotator.restoreAfterMeridianFlip', path: 'rotator.restoreAfterMeridianFlip', declare: (d) => ({ ...d, rotator: { ...d.rotator, enabled: true, restoreAfterMeridianFlip: true } }) },
	{ root: 'rotator.reverse', path: 'rotator.reverse', declare: (d) => ({ ...d, rotator: { ...d.rotator, enabled: true, reverse: true } }) },
	{ root: 'monitoring', path: 'monitoring.enabled', declare: (d) => ({ ...d, monitoring: { ...d.monitoring, enabled: true } }) },
	{ root: 'safety', path: 'safety.enabled', declare: (d) => ({ ...d, safety: { ...d.safety, enabled: true } }) },
	{ root: 'quality', path: 'quality.enabled', declare: (d) => ({ ...d, quality: { ...d.quality, enabled: true } }) },
]

const REMOVED: readonly Classified[] = [
	{ root: 'notification', path: 'notification', declare: (d) => ({ ...d, notification: { ...d.notification, enabled: true } }) },
	{ root: 'guiding.restoreAfterInterruption', path: 'guiding.restoreAfterInterruption', declare: (d) => d },
	{ root: 'capture.continueAfterRejectedFrame', path: 'capture.continueAfterRejectedFrame', declare: (d) => ({ ...d, capture: { ...d.capture, continueAfterRejectedFrame: true } }) },
	{ root: 'dither.retry.onExhausted', path: 'dither.retry.onExhausted', declare: (d) => d },
	{ root: 'autofocus.retry.onExhausted', path: 'autofocus.retry.onExhausted', declare: (d) => d },
	{ root: 'meridianFlip.retry.onExhausted', path: 'meridianFlip.retry.onExhausted', declare: (d) => d },
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

	test('a frame weight other than 1 is rejected', () => {
		const definition = complete()
		const compilation = compile({ ...definition, capture: { ...definition.capture, frames: [{ ...definition.capture.frames[0], weight: 2 }] } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics.map((diagnostic) => diagnostic.path)).toContain('capture.frames[0].weight')
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

	test('an enabled dome is rejected', () => {
		const definition = complete()
		const compilation = compile({ ...definition, dome: { ...definition.dome, enabled: true } })

		expect(compilation.ok).toBe(false)
		if (!compilation.ok) expect(compilation.diagnostics.map((diagnostic) => diagnostic.path)).toContain('dome.enabled')
	})

	test('a disabled dome is not rejected', () => {
		const definition = complete()
		const compilation = compile({ ...definition, dome: { ...definition.dome, enabled: false, unparkOnStartup: true, openOnStartup: true } })

		expect(compilation.ok).toBe(true)
	})
})
