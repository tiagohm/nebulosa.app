import { spyOn } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { DeepPartial } from 'nebulosa/src/core/types'
import type { Camera, Cover, Device, FlatPanel, Focuser, GuideOutput, Mount, Rotator, Wheel } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_CAMERA, DEFAULT_COVER, DEFAULT_FLAT_PANEL, DEFAULT_FOCUSER, DEFAULT_GUIDE_OUTPUT, DEFAULT_MOUNT, DEFAULT_ROTATOR, DEFAULT_WHEEL } from 'nebulosa/src/devices/indi/device'
import { writeImageToFits } from 'nebulosa/src/imaging/model/image'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { bufferSink } from 'nebulosa/src/io/io'
import type { AutoFocusRunner } from 'src/api/autofocus.runner'
import type { CameraHandler } from 'src/api/camera'
import type { CameraCommander } from 'src/api/camera.commander'
import type { CoverCommander } from 'src/api/cover.commander'
import type { FocuserCommander } from 'src/api/focuser.commander'
import type { GuiderCommander } from 'src/api/guider.session'
import type { MountCommander } from 'src/api/mount.commander'
import { OperationCoordinator } from 'src/api/operation'
import type { OperationScope } from 'src/api/operation'
import type { PlateSolverHandler } from 'src/api/platesolver'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import type { RotatorCommander } from 'src/api/rotator.commander'
import { SequencerHandler } from 'src/api/sequencer'
import type { SequencerSessionStart } from 'src/api/sequencer'
import { sequencerCaptureHandler } from 'src/api/sequencer.capture'
import { sequencerMeridianFlipHandler } from 'src/api/sequencer.flip'
import { sequencerAutofocusHandler } from 'src/api/sequencer.focus'
import { sequencerDitherHandler } from 'src/api/sequencer.guiding'
import type { SequencerGuidingServices } from 'src/api/sequencer.guiding'
import { sequencerLifecycleHandlers } from 'src/api/sequencer.lifecycle'
import { sequencerCenterHandler, sequencerSlewHandler } from 'src/api/sequencer.pointing'
import type { SequencerPreparationServices } from 'src/api/sequencer.prepare'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import type { SequencerControlResult } from 'src/api/sequencer.runtime'
import { SequencerRuntime } from 'src/api/sequencer.runtime'
import { InMemorySequencerStore } from 'src/api/sequencer.store'
import type { WheelCommander } from 'src/api/wheel.commander'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { Sequencer, SequencerAuxiliaryCapture, SequencerRetryPolicy } from '#/sequencer'
import type { SequencerArtifact, SequencerEvent, SequencerSession, SequencerSessionSnapshot } from '#/sequencer.state'
import { camera, frame } from './sequencer.fixture'

export interface SimulatorCommand {
	readonly name: string
	readonly detail?: string
	readonly at: number
}

export interface SimulatorClock {
	now: number
	readonly advance: (ms: number) => void
}

export interface SimulatorDevices {
	readonly camera: Camera
	readonly mount: Mount
	readonly wheel: Wheel
	readonly focuser: Focuser
	readonly rotator: Rotator
	readonly cover: Cover
	readonly flatPanel: FlatPanel
	readonly guideCamera: Camera
	readonly guideOutput: GuideOutput
	guiderConnected: boolean
	guiderRunning: boolean
	guiderLooping: boolean
}

export interface NightResult {
	readonly session: SequencerSession
	readonly log: readonly SimulatorCommand[]
	readonly devices: SimulatorDevices
	readonly artifacts: readonly SequencerArtifact[]
	readonly files: readonly string[]
	readonly arbiter: ResourceArbiter
	readonly root: string
	readonly events: readonly SequencerEvent[]
	readonly started: SequencerSessionStart
}

export interface NightControl {
	readonly snapshot: () => SequencerSessionSnapshot | undefined
	readonly waitUntil: (predicate: (snapshot: SequencerSessionSnapshot) => boolean) => Promise<SequencerSessionSnapshot>
	readonly arbiter: ResourceArbiter
	readonly coordinator: OperationCoordinator
	readonly devices: SimulatorDevices
	readonly log: readonly SimulatorCommand[]
	readonly events: () => readonly SequencerEvent[]
	// Asks the session to stop. Must not be awaited while a hold is open: a graceful stop waits for the
	// current exposure, and that exposure is waiting for this callback to return.
	readonly stop: () => Promise<SequencerControlResult>
}

export interface NightOptions {
	readonly patch?: DeepPartial<Sequencer>
	readonly sim?: {
		readonly mount?: Partial<Mount>
		readonly camera?: Partial<Camera>
		readonly cover?: Partial<Cover>
		readonly wheel?: Partial<Wheel>
		readonly options?: {
			readonly mount?: Readonly<{ hourAngle?: number; unpark?: 'fail' | number }>
			readonly camera?: Readonly<{ temperature?: 'timeout' }>
			readonly guider?: Readonly<{ start?: 'fail'; running?: boolean }>
		}
	}
	readonly control?: (api: NightControl) => void | Promise<void>
	// Existing storage root to reuse. When omitted, the night creates and owns a temporary directory.
	readonly root?: string
	// Holds the first science exposure until `control` returns, so a mid-capture assertion can run.
	readonly holdFirstExposure?: boolean
}

// One Sequencer process with a shared runtime, arbiter, and device registry. Admission cases start more
// than one session against this handle so the process gate, not a second harness, is what refuses.
export interface SimulatorProcess {
	readonly handler: SequencerHandler
	readonly runtime: SequencerRuntime
	readonly arbiter: ResourceArbiter
	readonly store: InMemorySequencerStore
	readonly root: string
	readonly log: SimulatorCommand[]
	// Registers another physical observatory under unique device names and hardware ids.
	readonly addObservatory: (tag: string, sim?: NightOptions['sim']) => SimulatorDevices
	// Builds a Sequencer whose device names resolve to the given observatory, then applies `patch`.
	readonly definition: (devices: SimulatorDevices, patch?: DeepPartial<Sequencer>) => Sequencer
	// Restores the virtual-clock spy. `disposeProcess` calls this.
	readonly restore: VoidFunction
}

export const RETRY: SequencerRetryPolicy = { maxAttempts: 3, delay: 0, backoff: 1, maximumDelay: 0, retryOn: ['timeout', 'commandFailed'], onExhausted: 'fail' }

const AUX_3S: SequencerAuxiliaryCapture = { exposureTime: 3, frameType: 'LIGHT', binX: 2, binY: 2, gain: 100, offset: 10, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: '', transferFormat: 'FITS', compressed: false }
const AUX_5S: SequencerAuxiliaryCapture = { ...AUX_3S, exposureTime: 5 }
const T0 = 1_700_000_000_000
const FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'O3', 'S2', 'Dark'] as const

export function defaultSequencer(root: string): Sequencer {
	return {
		schemaVersion: 1,
		id: 'simulator-default',
		revision: 1,
		name: 'LRGB M42',
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
		},
		target: {
			id: 'm42',
			name: 'Orion Nebula',
			enabled: true,
			type: 'J2000',
			J2000: { x: 1.4, y: -0.09 },
			tracking: { enabled: true, mode: 'SIDEREAL', stopOnShutdown: true, retry: RETRY },
			goto: { enabled: true, skipTolerance: 0.001, arrivalTolerance: 0.0005, timeout: 300, settle: 2, retry: RETRY },
			center: { enabled: true, solver: { type: 'astap', rightAscension: 0, declination: 0, executable: '', focalLength: 490, pixelSize: 4.8, fov: 0, timeout: 60, blind: false, radius: 4, downsample: 2 }, tolerance: 0.0001, maximumAttempts: 3, settle: 1, syncMount: true, capture: AUX_5S, retry: RETRY },
			constraints: { enabled: false, window: { enabled: false }, onViolation: 'wait', stableFor: 60 },
		},
		capture: {
			order: 'sequential',
			repeat: 1,
			delay: 1,
			continueAfterRejectedFrame: false,
			retry: RETRY,
			...camera(),
			frames: [
				frame('lum', { name: 'Luminance', count: 3, exposureTime: 2, filter: { type: 'name', name: 'L' } }),
				frame('red', { name: 'Red', count: 2, exposureTime: 2, filter: { type: 'name', name: 'R' } }),
				frame('green', { name: 'Green', count: 2, exposureTime: 2, filter: { type: 'name', name: 'G' } }),
				frame('blue', { name: 'Blue', count: 2, exposureTime: 2, filter: { type: 'name', name: 'B' } }),
			],
		},
		guiding: {
			enabled: true,
			connection: { mode: 'remote', host: '127.0.0.1', port: 4400 },
			calibrateBeforeStart: false,
			recalibrateAfterMeridianFlip: true,
			restoreAfterInterruption: true,
			stopOnShutdown: true,
			settle: { tolerance: 1.5, time: 2, timeout: 30 },
			thresholds: { enabled: false, pauseCaptureWhenExceeded: false },
			recovery: { enabled: false, maximumAttempts: 3, stopBeforeRetry: true, findStarBeforeRetry: true, recalibrate: false, settle: { tolerance: 1.5, time: 2, timeout: 30 }, onFailure: 'pause' },
			retry: RETRY,
		},
		dither: { enabled: true, amount: 3, raOnly: false, beforeFirstFrame: false, afterFilterChange: false, everyFrames: 2, everyTime: 0, retry: RETRY, onFailure: 'continue' },
		autofocus: {
			enabled: true,
			triggers: { onStart: true, onFilterChange: true, afterMeridianFlip: true, everyFrames: 0, everyTime: 0, temperatureChange: 0, minimumTimeBetweenRuns: 30 },
			algorithm: { initialOffsetSteps: 3, stepSize: 50, fittingMode: 'TREND_HYPERBOLIC', rmsdThreshold: 0.5, reversed: false, maximumPosition: 50000, backlash: { enabled: false, mode: 'overshoot', steps: 0 } },
			capture: AUX_3S,
			starDetection: { type: 'nebulosa', timeout: 10, minimumSNR: 10, maximumStars: 200 },
			filterOffsets: [],
			settle: 1,
			retry: RETRY,
			onFailure: 'continue',
		},
		rotator: { enabled: true, angle: 0.5, tolerance: 0.001, settle: 1, moveBeforeCentering: true, restoreAfterMeridianFlip: false, reverse: false, retry: RETRY },
		meridianFlip: { enabled: true, minimumHourAngle: 0.01, maximumHourAngle: 0.08, safetyMargin: 10, settle: 2, timeout: 120, retry: RETRY, onFailure: 'pause' },
		mount: { enabled: true, unparkOnStartup: true, parkOnShutdown: true, timeout: 30, retry: RETRY },
		cooling: { enabled: true, temperature: -10, tolerance: 1, ramp: 2, waitForTarget: true, timeout: 60, warmTemperature: 15, warmRamp: 2, turnCoolerOffAfterWarm: true, warmOnShutdown: true, retry: RETRY },
		dome: { enabled: false, unparkOnStartup: false, openOnStartup: false, parkOnShutdown: false, closeOnShutdown: false, closeOnUnsafe: true, slaving: false, synchronizeBeforeCapture: false, settle: 5, timeout: 300, retry: RETRY, onFailure: 'pause' },
		cover: { enabled: true, openOnStartup: true, closeOnShutdown: true, closeOnUnsafe: false, openBeforeCapture: true, closeForDarkFrames: true, timeout: 30, retry: RETRY },
		flatPanel: { enabled: true, brightness: 80, brightnessByFilter: [{ filter: { type: 'name', name: 'L' }, brightness: 40 }], timeout: 20, retry: RETRY },
		monitoring: { enabled: false, interval: 30, monitors: [] },
		safety: { enabled: false, triggerOnWarning: false, abortCurrentExposure: true, actions: [], recovery: { enabled: false, automatic: true, stableFor: 600, maximumWait: 3600, reconnectDevices: true, unparkMount: true, restoreTracking: true, resumeCapture: true, onFailure: 'pause' } },
		quality: { enabled: false, starDetection: { type: 'nebulosa', timeout: 10, minimumSNR: 10, maximumStars: 200 }, evaluateEveryFrames: 1, rejectFrame: false },
		execution: { start: { type: 'manual' }, end: { type: 'afterSequence' }, pauseMode: 'afterCurrentExposure', stopMode: 'graceful', defaultRetry: RETRY, checkpoint: { afterEveryAction: true, afterEveryFrame: true, afterEveryArtifact: true, interval: 30 } },
		storage: { root, fileNameTemplate: '{target}-{filter}-{exposure}', directoryTemplate: '{target}/{frameType}', autoSubFolderMode: 'off' },
		startup: { enabled: true, continueOnFailure: false },
		shutdown: { enabled: true, runOnCompletion: true, runOnStop: true, runOnFailure: true, continueOnFailure: true },
		notification: { enabled: false, events: [], channels: [], minimumSeverity: 'warning' },
	}
}

export function mergeSequencer(base: Sequencer, patch?: DeepPartial<Sequencer>): Sequencer {
	return (patch === undefined ? structuredClone(base) : mergeValue(base, patch)) as Sequencer
}

export async function runNight(options: NightOptions = {}): Promise<NightResult> {
	const owned = options.root === undefined
	const root = options.root ?? (await mkdtemp(join(tmpdir(), 'sequencer-sim-')))
	const clock: SimulatorClock = {
		now: T0,
		advance(ms: number) {
			clock.now += Math.max(0, ms)
		},
	}
	const wait = await import('src/api/operation.wait')
	const delay = spyOn(wait, 'abortableDelay').mockImplementation((ms: number, signal: AbortSignal) => {
		if (signal.aborted) return Promise.resolve(failedOperationResult('aborted'))

		clock.advance(ms)
		return Promise.resolve(successfulOperationResult(undefined))
	})

	try {
		const definition = mergeSequencer(defaultSequencer(root), options.patch)
		const devices = observatory(options.sim)
		const log: SimulatorCommand[] = []
		const frameBytes = await syntheticFits()
		const firstAutofocus = options.control === undefined || options.holdFirstExposure ? undefined : Promise.withResolvers<void>()
		const firstExposure = options.holdFirstExposure ? Promise.withResolvers<void>() : undefined
		const { arbiter, coordinator, runtime, handler, store } = environment(definition, devices, log, clock, frameBytes, firstAutofocus?.promise, undefined, firstExposure?.promise, options.sim)
		const started = await handler.start(definition)

		if (!started.ok) {
			if (owned) await rm(root, { recursive: true, force: true })
			const diagnostics = started.preflight?.diagnostics.map((item) => `${item.path}: ${item.message}`).join('; ')
			throw new Error(`session refused: ${started.reason}${started.detail === undefined ? '' : `: ${started.detail}`}${diagnostics === undefined || diagnostics.length === 0 ? '' : ` (${diagnostics})`}`)
		}

		try {
			if (options.control !== undefined) await options.control(nightControl(handler, started.session.id, arbiter, coordinator, devices, log))
		} finally {
			firstAutofocus?.resolve()
			firstExposure?.resolve()
		}

		const session = (await runtime.settled(started.session.id)) ?? store.session(started.session.id)

		if (session === undefined) {
			if (owned) await rm(root, { recursive: true, force: true })
			throw new Error('session vanished before it settled')
		}

		return { session, log, devices, artifacts: store.artifacts(session.id), files: await listFiles(root), arbiter, root, events: store.events(session.id), started }
	} finally {
		delay.mockRestore()
	}
}

export async function disposeNight(night: NightResult) {
	await rm(night.root, { recursive: true, force: true })
}

// Opens a process that can register several disjoint observatories and start more than one session.
export async function openProcess(options: { readonly root?: string } = {}): Promise<SimulatorProcess> {
	const root = options.root ?? (await mkdtemp(join(tmpdir(), 'sequencer-sim-')))
	const clock: SimulatorClock = {
		now: T0,
		advance(ms: number) {
			clock.now += Math.max(0, ms)
		},
	}
	const wait = await import('src/api/operation.wait')
	const delay = spyOn(wait, 'abortableDelay').mockImplementation((ms: number, signal: AbortSignal) => {
		if (signal.aborted) return Promise.resolve(failedOperationResult('aborted'))

		clock.advance(ms)
		return Promise.resolve(successfulOperationResult(undefined))
	})
	const log: SimulatorCommand[] = []
	const frameBytes = await syntheticFits()
	const byName: Record<string, Device> = {}
	const { arbiter, runtime, handler, store } = environment(defaultSequencer(root), observatory(undefined, 'host'), log, clock, frameBytes, undefined, byName)

	return {
		handler,
		runtime,
		arbiter,
		store,
		root,
		log,
		addObservatory(tag, sim) {
			const devices = observatory(sim, tag)

			registerDevices(byName, devices)

			return devices
		},
		definition(devices, patch) {
			return mergeSequencer(
				mergeSequencer(defaultSequencer(root), {
					devices: {
						camera: devices.camera.name,
						mount: devices.mount.name,
						wheel: devices.wheel.name,
						focuser: devices.focuser.name,
						rotator: devices.rotator.name,
						guideCamera: devices.guideCamera.name,
						guideOutput: devices.guideOutput.name,
						cover: devices.cover.name,
						flatPanel: devices.flatPanel.name,
					},
				}),
				patch,
			)
		},
		restore: () => delay.mockRestore(),
	}
}

// Stops the admitted session if it is still live, restores the clock spy, and deletes the process root.
export async function disposeProcess(process: SimulatorProcess) {
	try {
		const active = process.runtime.activeSessionId

		if (active !== undefined) await process.runtime.stop(active)
	} finally {
		process.restore()
		await rm(process.root, { recursive: true, force: true })
	}
}

export function commandNames(log: readonly SimulatorCommand[]) {
	return log.map((entry) => entry.name)
}

function observatory(sim?: NightOptions['sim'], tag?: string): SimulatorDevices {
	const suffix = tag === undefined ? '' : ` ${tag}`
	const id = tag === undefined ? '' : `-${tag}`

	const mount = structuredClone(DEFAULT_MOUNT)
	Object.assign(mount, {
		id: `mount-1${id}`,
		hardwareId: `hw-mount${id}`,
		name: `Mount Simulator${suffix}`,
		connected: true,
		parked: true,
		tracking: false,
		canFlip: true,
		hasPierSide: true,
		pierSide: 'WEST',
		trackMode: 'SIDEREAL',
		canPark: true,
		canUnpark: true,
		canSetTracking: true,
		canSlew: true,
		...sim?.mount,
	})

	const imaging = structuredClone(DEFAULT_CAMERA)
	Object.assign(imaging, { id: `camera-1${id}`, hardwareId: `hw-camera${id}`, name: `Camera Simulator${suffix}`, connected: true, hasCooler: true, hasCoolerControl: true, hasThermometer: true, cooler: false, temperature: 20, canSetTemperature: true, ...sim?.camera })

	const guideCamera = structuredClone(DEFAULT_CAMERA)
	Object.assign(guideCamera, { id: `guide-camera-1${id}`, hardwareId: `hw-guide-camera${id}`, name: `Guide Camera Simulator${suffix}`, connected: true })

	const wheel = structuredClone(DEFAULT_WHEEL)
	Object.assign(wheel, { id: `wheel-1${id}`, hardwareId: `hw-wheel${id}`, name: `Wheel Simulator${suffix}`, connected: true, count: FILTERS.length, position: FILTERS.length - 1, names: [...FILTERS], ...sim?.wheel })

	const focuser = structuredClone(DEFAULT_FOCUSER)
	Object.assign(focuser, { id: `focuser-1${id}`, hardwareId: `hw-focuser${id}`, name: `Focuser Simulator${suffix}`, connected: true, position: { value: 25000, min: 0, max: 50000, step: 1 } })

	const rotator = structuredClone(DEFAULT_ROTATOR)
	Object.assign(rotator, { id: `rotator-1${id}`, hardwareId: `hw-rotator${id}`, name: `Rotator Simulator${suffix}`, connected: true, angle: { value: 0, min: 0, max: 360, step: 0.1 } })

	const cover = structuredClone(DEFAULT_COVER)
	Object.assign(cover, { id: `cover-1${id}`, hardwareId: `hw-cover${id}`, name: `Cover Simulator${suffix}`, connected: true, parked: true, canPark: true, canUnpark: true, ...sim?.cover })

	const flatPanel = structuredClone(DEFAULT_FLAT_PANEL)
	Object.assign(flatPanel, { id: `flat-1${id}`, hardwareId: `hw-flat${id}`, name: `Flat Panel Simulator${suffix}`, connected: true, enabled: false, intensity: { value: 0, min: 0, max: 255, step: 1 } })

	const guideOutput = structuredClone(DEFAULT_GUIDE_OUTPUT)
	Object.assign(guideOutput, { id: `guide-output-1${id}`, hardwareId: `hw-mount${id}`, name: `Guide Output Simulator${suffix}`, connected: true, canPulseGuide: true })

	return {
		camera: imaging,
		mount,
		wheel,
		focuser,
		rotator,
		cover,
		flatPanel,
		guideCamera,
		guideOutput,
		guiderConnected: false,
		guiderRunning: sim?.options?.guider?.running === true,
		guiderLooping: sim?.options?.guider?.running === true,
	}
}

function registerDevices(byName: Record<string, Device>, devices: SimulatorDevices) {
	byName[devices.camera.name] = devices.camera
	byName[devices.mount.name] = devices.mount
	byName[devices.wheel.name] = devices.wheel
	byName[devices.focuser.name] = devices.focuser
	byName[devices.rotator.name] = devices.rotator
	byName[devices.cover.name] = devices.cover
	byName[devices.flatPanel.name] = devices.flatPanel
	byName[devices.guideCamera.name] = devices.guideCamera
	byName[devices.guideOutput.name] = devices.guideOutput
}

function environment(definition: Sequencer, devices: SimulatorDevices, log: SimulatorCommand[], clock: SimulatorClock, frameBytes: Uint8Array, holdFirstAutofocus?: Promise<void>, byName: Record<string, Device> = {}, holdFirstExposure?: Promise<void>, sim?: NightOptions['sim']) {
	const arbiter = new ResourceArbiter()
	const coordinator = new OperationCoordinator(arbiter)
	const registry = new SequencerBlockRegistry()
	const store = new InMemorySequencerStore()

	registerDevices(byName, devices)
	const commanders = simulatedCommanders(devices, log, clock, frameBytes, holdFirstAutofocus, holdFirstExposure, sim)
	const runtime = new SequencerRuntime({
		store,
		registry,
		coordinator,
		now: () => clock.now,
		resolve: (_role, deviceId) => {
			const device = byName[deviceId]
			return device === undefined ? undefined : { key: device.hardwareId, device }
		},
		preparation: { wheelCommander: commanders.wheel, focuserCommander: commanders.focuser, coverCommander: commanders.cover, flatPanelCommander: commanders.flatPanel, rotatorCommander: commanders.rotator, mountCommander: commanders.mount } as unknown as SequencerPreparationServices,
		guiding: { guiderCommander: commanders.guider } as unknown as SequencerGuidingServices,
	})

	registry.register(sequencerSlewHandler(commanders.mount as unknown as MountCommander))
	registry.register(
		sequencerCenterHandler({
			cameraHandler: commanders.camera as unknown as CameraHandler,
			mountCommander: commanders.mount as unknown as MountCommander,
			wheelCommander: commanders.wheel as unknown as WheelCommander,
			rotatorCommander: commanders.rotator as unknown as RotatorCommander,
			plateSolver: commanders.solver as unknown as PlateSolverHandler,
		}),
	)
	registry.register(sequencerAutofocusHandler({ runner: commanders.autofocus as unknown as AutoFocusRunner, focuserCommander: commanders.focuser as unknown as FocuserCommander, wheelCommander: commanders.wheel as unknown as WheelCommander }))
	registry.register(sequencerDitherHandler({ guiderCommander: commanders.guider as unknown as GuiderCommander }))
	registry.register(
		sequencerMeridianFlipHandler({
			cameraHandler: commanders.camera as unknown as CameraHandler,
			mountCommander: commanders.mount as unknown as MountCommander,
			wheelCommander: commanders.wheel as unknown as WheelCommander,
			rotatorCommander: commanders.rotator as unknown as RotatorCommander,
			plateSolver: commanders.solver as unknown as PlateSolverHandler,
			runner: commanders.autofocus as unknown as AutoFocusRunner,
			focuserCommander: commanders.focuser as unknown as FocuserCommander,
		}),
	)
	registry.register(sequencerCaptureHandler({ cameraHandler: commanders.camera as unknown as CameraHandler }))

	for (const handler of sequencerLifecycleHandlers({ mountCommander: commanders.mount as unknown as MountCommander, coverCommander: commanders.cover as unknown as CoverCommander, cameraCommander: commanders.thermal as unknown as CameraCommander, guiderCommander: commanders.guider as unknown as GuiderCommander })) {
		registry.register(handler)
	}

	return { arbiter, coordinator, registry, store, runtime, handler: new SequencerHandler({ store, runtime, registry, now: () => clock.now, observe: (sessionId) => runtime.observation(sessionId) }) }
}

function nightControl(handler: SequencerHandler, sessionId: string, arbiter: ResourceArbiter, coordinator: OperationCoordinator, devices: SimulatorDevices, log: readonly SimulatorCommand[]): NightControl {
	const snapshot = () => handler.snapshot(sessionId)

	return {
		arbiter,
		coordinator,
		devices,
		log,
		events: (afterSequence?: number) => handler.events(sessionId, afterSequence),
		stop: () => handler.stop(sessionId),
		snapshot,
		waitUntil: async (predicate) => {
			const deadline = Date.now() + 5_000

			while (Date.now() < deadline) {
				const current = snapshot()

				if (current !== undefined && predicate(current)) return current

				await new Promise<void>((resolve) => {
					setTimeout(resolve, 1)
				})
			}

			throw new Error('the night did not reach the expected snapshot')
		},
	}
}

function simulatedCommanders(devices: SimulatorDevices, log: SimulatorCommand[], clock: SimulatorClock, frameBytes: Uint8Array, holdFirstAutofocus?: Promise<void>, holdFirstExposure?: Promise<void>, sim?: NightOptions['sim']) {
	const push = (name: string, detail?: string) => log.push(detail === undefined ? { name, at: clock.now } : { name, detail, at: clock.now })
	const ok = <T>(value: T) => Promise.resolve(successfulOperationResult(value))
	let heldScienceExposure = false
	let remainingUnparkFailures = sim?.options?.mount?.unpark === 'fail' ? Number.POSITIVE_INFINITY : typeof sim?.options?.mount?.unpark === 'number' ? sim.options.mount.unpark : 0

	return {
		mount: {
			goTo: (_scope: unknown, mount: Mount, target: { readonly type?: string; readonly J2000?: { readonly x: number; readonly y: number } }) => {
				push('slew')

				if (mount.parked) return Promise.resolve(failedOperationResult('unexpectedState', `mount ${mount.name} is parked`))

				mount.parked = false

				if (target.J2000 !== undefined) {
					mount.equatorialCoordinate.rightAscension = target.J2000.x
					mount.equatorialCoordinate.declination = target.J2000.y
				}

				return ok({ rightAscension: mount.equatorialCoordinate.rightAscension, declination: mount.equatorialCoordinate.declination, pierSide: mount.pierSide })
			},
			sync: () => {
				push('sync')
				return ok(undefined)
			},
			park: (_scope: unknown, mount: Mount) => {
				push('park')
				mount.parked = true
				mount.tracking = false
				return ok(undefined)
			},
			unpark: (_scope: unknown, mount: Mount) => {
				push('unpark')

				if (remainingUnparkFailures > 0) {
					remainingUnparkFailures--
					return Promise.resolve(failedOperationResult('commandFailed', 'the mount refused to unpark'))
				}

				mount.parked = false
				return ok(undefined)
			},
			setTracking: (_scope: unknown, mount: Mount, enabled: boolean) => {
				push('track', enabled ? 'on' : 'off')
				mount.tracking = enabled
				return ok(undefined)
			},
			setTrackMode: (_scope: unknown, mount: Mount, mode: Mount['trackMode']) => {
				push('track.mode', mode)
				mount.trackMode = mode
				return ok(undefined)
			},
			flip: (_scope: unknown, mount: Mount) => {
				push('flip')
				mount.pierSide = mount.pierSide === 'WEST' ? 'EAST' : 'WEST'
				return ok({ rightAscension: mount.equatorialCoordinate.rightAscension, declination: mount.equatorialCoordinate.declination, pierSide: mount.pierSide, initialPierSide: mount.pierSide === 'WEST' ? 'EAST' : 'WEST', pierSideVerified: true })
			},
		},
		cover: {
			park: (_scope: unknown, cover: Cover) => {
				push('cover.close')
				cover.parked = true
				return ok(undefined)
			},
			unpark: (_scope: unknown, cover: Cover) => {
				push('cover.open')
				cover.parked = false
				return ok(undefined)
			},
		},
		wheel: {
			moveTo: (_scope: unknown, wheel: Wheel, slot: number) => {
				wheel.position = slot
				push('wheel.move', wheel.names[slot] || String(slot))
				return ok(undefined)
			},
		},
		focuser: {
			moveTo: (_scope: unknown, focuser: Focuser, position: number) => {
				push('focuser.move', String(position))
				focuser.position.value = position
				return ok(undefined)
			},
		},
		rotator: {
			moveTo: (_scope: unknown, rotator: Rotator, angle: number) => {
				push('rotator.move', String(angle))
				rotator.angle.value = angle
				return ok(undefined)
			},
		},
		flatPanel: {
			enable: (_scope: unknown, panel: FlatPanel, brightness?: number) => {
				push('panel.on', brightness === undefined ? undefined : String(brightness))
				panel.enabled = true
				if (brightness !== undefined) panel.intensity.value = brightness
				return ok(undefined)
			},
			disable: (_scope: unknown, panel: FlatPanel) => {
				push('panel.off')
				panel.enabled = false
				return ok(undefined)
			},
		},
		thermal: {
			cooler: (_scope: unknown, camera: Camera, enabled: boolean) => {
				push(enabled ? 'cooler.on' : 'cooler.off')
				camera.cooler = enabled
				return ok(undefined)
			},
			temperature: (_scope: unknown, camera: Camera, value: number) => {
				push('cooler.set', String(value))

				if (sim?.options?.camera?.temperature === 'timeout') return Promise.resolve(failedOperationResult('timeout', 'the cooler never reached the setpoint'))

				camera.temperature = value
				return ok(undefined)
			},
		},
		camera: {
			capture: (scope: OperationScope, camera: Camera, request: { readonly outputPath?: string; readonly outputName?: string; readonly publishPath?: string }) => {
				const path = request.outputPath === undefined || request.outputName === undefined ? undefined : join(request.outputPath, request.outputName)
				const write = path === undefined ? Promise.resolve() : mkdir(dirname(path), { recursive: true }).then(() => writeFile(path, frameBytes))
				const science = holdFirstExposure !== undefined && !heldScienceExposure && request.publishPath !== undefined

				if (science) heldScienceExposure = true

				const work = science ? holdFirstExposure.then(() => write) : write
				const started = Promise.withResolvers<OperationResult<undefined>>()
				let startedSettled = false
				const settleStarted = (result: OperationResult<undefined>) => {
					if (startedSettled) return
					startedSettled = true
					started.resolve(result)
				}
				const handle = scope.start('cameraCapture', [{ key: resourceKey(camera), device: camera }], async () => {
					push('camera.expose')
					settleStarted(successfulOperationResult(undefined))
					await work
					// The write finished and the lease is about to drop. Stop-order cases use this to see the
					// exposure cleanup land before the terminal pipeline.
					push('camera.done')
					return successfulOperationResult({ paths: path === undefined ? [] : [path], frameCount: path === undefined ? 0 : 1 })
				})

				void handle.result.then((result) => {
					if (!result.ok) settleStarted(result)
				})

				return { id: handle.id, started: started.promise, result: handle.result, cancel: handle.cancel }
			},
		},
		solver: {
			start: (request: { readonly rightAscension?: number | string; readonly declination?: number | string }) => {
				push('solve')
				const rightAscension = typeof request.rightAscension === 'number' ? request.rightAscension : 1.4
				const declination = typeof request.declination === 'number' ? request.declination : -0.09

				return { SIMPLE: true, BITPIX: -32, NAXIS: 2, NAXIS1: 8, NAXIS2: 8, rightAscension, declination }
			},
		},
		autofocus: {
			start: (scope: OperationScope, camera: Camera, focuser: Focuser) => {
				const focused = { outcome: 'focused' as const, position: focuser.position.value, message: 'best focus!', focusPoint: [focuser.position.value, 1] as const }
				const handle = scope.start(
					'autoFocus',
					[
						{ key: resourceKey(camera), device: camera },
						{ key: resourceKey(focuser), device: focuser },
					],
					() => {
						push('autofocus.run')
						clock.advance(30_000)
						return holdFirstAutofocus === undefined || log.filter((entry) => entry.name === 'autofocus.run').length > 1 ? successfulOperationResult(focused) : holdFirstAutofocus.then(() => successfulOperationResult(focused))
					},
				)

				return { handle, finish: () => undefined }
			},
		},
		guider: {
			running: () => devices.guiderRunning,
			looping: () => devices.guiderLooping,
			connect: () => {
				push('guider.connect')
				devices.guiderConnected = true
				return ok({ id: 'guider-1', mode: 'remote', key: 'logical:guider:remote:127.0.0.1:4400', target: '127.0.0.1:4400', state: 'idle', connected: true, looping: false, running: false })
			},
			disconnect: () => {
				push('guider.disconnect')
				devices.guiderConnected = false
				devices.guiderRunning = false
				devices.guiderLooping = false
				return ok(undefined)
			},
			loop: () => {
				push('guider.loop')
				devices.guiderLooping = true
				devices.guiderRunning = false
				return ok(undefined)
			},
			startGuiding: () => {
				push('guider.start')

				if (sim?.options?.guider?.start === 'fail') return Promise.resolve(failedOperationResult('commandFailed', 'the guider refused to start'))

				devices.guiderRunning = true
				devices.guiderLooping = true
				return ok(undefined)
			},
			stopGuiding: () => {
				push('guider.stop')
				devices.guiderRunning = false
				return ok(undefined)
			},
			calibrate: () => {
				push('guider.calibrate')
				devices.guiderRunning = true
				devices.guiderLooping = true
				return ok(undefined)
			},
			dither: () => {
				push('guider.dither')
				return ok(undefined)
			},
		},
	} as const
}

function mergeValue(base: unknown, patch: unknown): unknown {
	if (patch === undefined) return structuredClone(base)
	if (Array.isArray(patch) || patch === null || typeof patch !== 'object' || typeof base !== 'object' || base === null || Array.isArray(base)) return structuredClone(patch)

	const next: Record<string, unknown> = { ...(base as Record<string, unknown>) }

	// An explicit undefined removes the DEFAULT key, which is how a case omits an optional device or field.
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) delete next[key]
		else next[key] = mergeValue((base as Record<string, unknown>)[key], value)
	}

	return next
}

async function syntheticFits() {
	const width = 8
	const height = 8
	const raw = new Float32Array(width * height)
	const buffer = Buffer.alloc(64 * 1024)
	const sink = bufferSink(buffer)
	const image: Image = {
		header: { SIMPLE: true, BITPIX: -32, NAXIS: 2, NAXIS1: width, NAXIS2: height },
		raw,
		metadata: { width, height, channels: 1, stride: width, pixelCount: width * height, strideInBytes: width * 4, pixelSizeInBytes: 4, bitpix: -32, bayer: undefined },
	}

	await writeImageToFits(image, sink)
	return buffer.subarray(0, sink.position)
}

async function listFiles(root: string) {
	const files: string[] = []

	async function walk(directory: string) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name)
			if (entry.isDirectory()) await walk(path)
			else files.push(path)
		}
	}

	await walk(root)

	return files
}
