import type { SequencerGuidingServices } from 'src/api/sequencer.guiding'
import type { SequencerPreparationServices } from 'src/api/sequencer.prepare'
import type { GuiderSessionInfo } from '#/guider'
import { successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { Sequencer, SequencerCameraCapture, SequencerFrame, SequencerRetryPolicy } from '#/sequencer'

// Device services the runtime hands the executor, absent in the tests that never reach the optical path.
// The guider commander is the exception: a canonical session declares a guider and opens it before its first
// node, so it answers the connect with a session that is open and not guiding.
export function services(): { readonly preparation: SequencerPreparationServices; readonly guiding: SequencerGuidingServices } {
	return { preparation: {} as SequencerPreparationServices, guiding: guiding() }
}

export function guiding(connect?: () => OperationResult<GuiderSessionInfo>): SequencerGuidingServices {
	return {
		guiderCommander: {
			connect: () => Promise.resolve(connect === undefined ? successfulOperationResult({ id: 'guider-1', mode: 'remote', key: 'logical:guider:remote:localhost:4400', target: 'localhost:4400', state: 'idle', connected: true, looping: false, running: false }) : connect()),
			running: () => false,
			looping: () => false,
		},
	} as unknown as SequencerGuidingServices
}

// Canonical sequencer definition shared by the compiler and resolution tests: every feature the V1 lowering
// understands is enabled, so a test only has to override the property it is about.
export function retry(policy?: Partial<SequencerRetryPolicy>): SequencerRetryPolicy {
	return { maxAttempts: 3, delay: 5, backoff: 2, maximumDelay: 60, retryOn: ['timeout', 'commandFailed'], onExhausted: 'fail', ...policy }
}

export function camera(capture?: Partial<SequencerCameraCapture>): SequencerCameraCapture {
	return { exposureTime: 60, exposureTimeUnit: 'second', frameType: 'LIGHT', binX: 1, binY: 1, gain: 100, offset: 10, frameFormat: 'RAW16', transferFormat: 'FITS', compressed: false, subframe: false, x: 0, y: 0, width: 0, height: 0, ...capture }
}

export function frame(id: string, frame?: Partial<SequencerFrame>, capture?: Partial<SequencerCameraCapture>): SequencerFrame {
	return { id, enabled: true, count: 10, weight: 1, ...frame, capture: { ...camera(), ...frame?.capture, ...capture } }
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
		target: { ...definition.target, tracking: { ...definition.target.tracking } },
		capture: { ...definition.capture, frames: [frame('lum', { abandonmentBudget: 2, delay: 8, capture: camera({ filter: { type: 'name', name: 'L' } }) })] },
		guiding: { ...definition.guiding, connection: { mode: 'remote', host: 'localhost', port: 4400, profile: 'default' } },
		storage: { ...definition.storage, temporaryDirectory: '/data/nebulosa/.tmp' },
		mount: { ...definition.mount, unparkOnStartup: false },
	}
}

export function canonical(): Sequencer {
	return {
		schemaVersion: 1,
		id: 'definition-1',
		revision: 7,
		name: 'M42',
		devices: { camera: 'Camera Simulator', mount: 'Mount Simulator', wheel: 'Wheel Simulator', focuser: 'Focuser Simulator' },
		target: {
			id: 'm42',
			name: 'Orion Nebula',
			type: 'J2000',
			J2000: { x: '05 20 51.38', y: '05 09 23.83' },
			timeout: 300,
			settle: 5,
			retry: retry(),
			tracking: { enabled: true, mode: 'SIDEREAL', stopOnShutdown: false, retry: retry() },
			center: {
				enabled: true,
				solver: { type: 'astap', executable: '', focalLength: 0, pixelSize: 0, fov: 0, blind: true, rightAscension: '00 00 00', declination: '+00 00 00', radius: 4, downsample: 0, timeout: 300000, apiUrl: '', apiKey: '' },
				tolerance: 0.0001,
				maximumAttempts: 5,
				settle: 3,
				syncMount: true,
				capture: { exposureTime: 5, exposureTimeUnit: 'second', frameType: 'LIGHT', binX: 2, binY: 2, gain: 100, offset: 10, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: '', transferFormat: 'FITS', compressed: false },
				retry: retry(),
			},
			constraints: { enabled: false, window: { enabled: false }, onViolation: 'wait', stableFor: 60 },
		},
		capture: { order: 'sequential', repeat: 2, frames: [frame('lum'), frame('red')], delay: 4, continueAfterRejectedFrame: false, retry: retry() },
		guiding: {
			enabled: true,
			connection: { mode: 'remote', host: 'localhost', port: 4400 },
			calibrateBeforeStart: false,
			recalibrateAfterMeridianFlip: true,
			restoreAfterInterruption: true,
			stopOnShutdown: false,
			settle: { tolerance: 1.5, time: 10, timeout: 120 },
			thresholds: { enabled: false, pauseCaptureWhenExceeded: false },
			recovery: { enabled: false, maximumAttempts: 3, stopBeforeRetry: true, findStarBeforeRetry: true, recalibrate: false, settle: { tolerance: 1.5, time: 10, timeout: 120 }, onFailure: 'pause' },
			retry: retry(),
		},
		dither: { enabled: true, amount: 3, raOnly: false, beforeFirstFrame: false, afterFilterChange: false, everyFrames: 1, everyTime: 0, retry: retry(), onFailure: 'continue' },
		autofocus: {
			enabled: true,
			triggers: { onStart: true, onFilterChange: true, afterMeridianFlip: true, everyFrames: 20, everyTime: 3600, temperatureChange: 1, minimumTimeBetweenRuns: 600 },
			algorithm: { initialOffsetSteps: 4, stepSize: 100, fittingMode: 'TREND_HYPERBOLIC', rmsdThreshold: 0.5, reversed: false, maximumPosition: 50000, backlash: { enabled: false, mode: 'overshoot', steps: 0 } },
			capture: { exposureTime: 3, exposureTimeUnit: 'second', frameType: 'LIGHT', binX: 2, binY: 2, gain: 100, offset: 10, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: '', transferFormat: 'FITS', compressed: false },
			starDetection: { type: 'nebulosa', timeout: 30, minimumSNR: 10, maximumStars: 500 },
			filterOffsets: [],
			settle: 2,
			retry: retry(),
			onFailure: 'continue',
		},
		rotator: { enabled: false, angle: 0, tolerance: 0.001, settle: 2, moveBeforeCentering: true, restoreAfterMeridianFlip: true, reverse: false, retry: retry() },
		meridianFlip: {
			enabled: true,
			minimumHourAngle: 0.01,
			maximumHourAngle: 0.1,
			safetyMargin: 60,
			settle: 5,
			timeout: 600,
			retry: retry(),
			onFailure: 'pause',
		},
		mount: { enabled: true, unparkOnStartup: true, parkOnShutdown: true, timeout: 30, retry: retry() },
		cooling: { enabled: true, temperature: -10, tolerance: 1, ramp: 2, waitForTarget: true, timeout: 900, warmTemperature: 15, warmRamp: 2, turnCoolerOffAfterWarm: true, warmOnShutdown: true, retry: retry() },
		dome: { enabled: false, unparkOnStartup: false, openOnStartup: false, parkOnShutdown: false, closeOnShutdown: false, closeOnUnsafe: true, slaving: false, synchronizeBeforeCapture: false, settle: 5, timeout: 300, retry: retry(), onFailure: 'pause' },
		cover: { enabled: false, openOnStartup: false, closeOnShutdown: false, closeOnUnsafe: true, openBeforeCapture: true, closeForDarkFrames: true, timeout: 120, retry: retry() },
		flatPanel: { enabled: false, brightness: 100, brightnessByFilter: [], timeout: 60, retry: retry() },
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
				reconnectDevices: true,
				unparkMount: true,
				restoreTracking: true,
				resumeCapture: true,
				onFailure: 'pause',
			},
		},
		quality: { enabled: false, starDetection: { type: 'nebulosa', timeout: 30, minimumSNR: 10, maximumStars: 500 }, evaluateEveryFrames: 1, rejectFrame: false },
		execution: {
			start: { type: 'manual' },
			end: { type: 'afterSequence' },
			pauseMode: 'afterCurrentExposure',
			stopMode: 'graceful',
			defaultRetry: retry(),
			checkpoint: { afterEveryAction: true, afterEveryFrame: true, afterEveryArtifact: true, interval: 60 },
		},
		storage: { root: '/data/nebulosa', fileNameTemplate: '{target}-{filter}-{exposure}', directoryTemplate: '{target}/{frameType}', autoSubFolderMode: 'noon' },
		startup: { enabled: true, continueOnFailure: false },
		shutdown: { enabled: true, runOnCompletion: true, runOnStop: true, runOnFailure: false, continueOnFailure: true },
		notification: { enabled: false, events: [], channels: [], minimumSeverity: 'warning' },
	}
}

// Canonical definition without a guider, and therefore without the dither and the derived startup step that command one.
export function unguided(): Sequencer {
	const definition = canonical()
	return { ...definition, guiding: { ...definition.guiding, enabled: false }, dither: { ...definition.dither, enabled: false } }
}
