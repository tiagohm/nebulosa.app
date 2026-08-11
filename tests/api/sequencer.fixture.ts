import type { Sequencer, SequencerCamera, SequencerFrame, SequencerLifecycleAction, SequencerRetryPolicy } from '#/sequencer'

// Canonical sequencer definition shared by the compiler and resolution tests: every feature the V1 lowering
// understands is enabled, so a test only has to override the property it is about.
export function retry(): SequencerRetryPolicy {
	return { maxAttempts: 3, delay: 5, backoff: 2, maximumDelay: 60, retryOn: ['timeout', 'commandFailed'], onExhausted: 'fail' }
}

export function camera(): SequencerCamera {
	return { binX: 1, binY: 1, gain: 100, offset: 10, frameFormat: 'RAW16', transferFormat: 'FITS', compressed: false, subframe: { enabled: false, x: 0, y: 0, width: 0, height: 0 } }
}

export function frame(id: string, overrides?: Partial<SequencerFrame>): SequencerFrame {
	return { id, name: id, enabled: true, frameType: 'LIGHT', exposureTime: 60, count: 10, integrationTime: 0, weight: 1, camera: {}, ...overrides }
}

export function action(id: string, overrides?: Partial<SequencerLifecycleAction>): SequencerLifecycleAction {
	return { id, enabled: true, timeout: 30, retry: retry(), type: 'unparkMount', ...overrides } as SequencerLifecycleAction
}

// Canonical definition with every optional property of the contract declared, which is what the compatibility
// test walks: a property absent from this object is a property no case classifies.
export function complete(): Sequencer {
	const definition = canonical()

	return {
		...definition,
		devices: {
			camera: 'Camera Simulator',
			mount: 'Mount Simulator',
			wheel: 'Wheel Simulator',
			focuser: 'Focuser Simulator',
			rotator: 'Rotator Simulator',
			guideCamera: 'Guide Camera Simulator',
			guideOutput: 'Guide Output Simulator',
			cover: 'Cover Simulator',
			flatPanel: 'Flat Panel Simulator',
			dome: 'Dome Simulator',
		},
		target: { ...definition.target, tracking: { ...definition.target.tracking, rightAscensionRate: 0, declinationRate: 0 } },
		capture: { ...definition.capture, frames: [frame('lum', { abandonmentBudget: 2, delay: 8, filter: { type: 'name', name: 'L' }, camera: camera() })] },
		guiding: { ...definition.guiding, connection: { mode: 'remote', host: 'localhost', port: 4400, profile: 'default', owned: true } },
		storage: { ...definition.storage, temporaryDirectory: '/data/nebulosa/.tmp' },
		startup: { ...definition.startup, actions: [action('connect', { type: 'connectDevices', devices: ['camera', 'mount'], required: true })] },
		shutdown: { ...definition.shutdown, actions: [action('park', { type: 'parkMount', required: true })] },
	}
}

export function canonical(): Sequencer {
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
			type: 'J2000',
			J2000: { x: 1.4, y: -0.09 },
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
			enabled: true,
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

// Canonical definition without a guider, and therefore without the dither that commands one.
export function unguided(): Sequencer {
	const definition = canonical()
	return { ...definition, guiding: { ...definition.guiding, enabled: false }, dither: { ...definition.dither, enabled: false } }
}
