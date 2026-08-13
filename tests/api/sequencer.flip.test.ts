import { describe, expect, test } from 'bun:test'
import type { Mount, PierSide } from 'nebulosa/src/devices/indi/device'
import type { SequencerMeridianFlipTrigger } from 'src/api/sequencer.compiler'
import { sequencerMeridianFlipHandler } from 'src/api/sequencer.flip'
import type { SequencerMeridianFlipServices } from 'src/api/sequencer.flip'
import type { SequencerActionContext } from 'src/api/sequencer.registry'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationFailureReason } from '#/orchestration'
import type { SequencerDevices } from '#/sequencer'

const TARGET = { type: 'J2000' as const, J2000: { x: 1.4, y: -0.09 } }

interface Command {
	readonly name: string
	readonly detail?: unknown
}

function mount(pierSide: PierSide = 'EAST'): Mount {
	return { type: 'mount', name: 'Mount Simulator', id: 'mount-1', connected: true, canFlip: true, hasPierSide: true, pierSide, equatorialCoordinate: { rightAscension: 1.41, declination: -0.1 }, geographicCoordinate: { longitude: 0 } } as unknown as Mount
}

function centering(): SequencerMeridianFlipTrigger['centering'] {
	return {
		coordinates: TARGET,
		solver: { type: 'astap', timeout: 60, blind: false, searchRadius: 0.05, downsample: 2, maximumStars: 500, minimumSNR: 10 },
		tolerance: 0.0001,
		maximumAttempts: 3,
		settle: 0,
		syncMount: true,
		finalSolve: true,
		recenterAfterDrift: false,
		driftTolerance: 0,
		checkEveryFrames: 0,
		checkEveryTime: 0,
		capture: { exposureTime: 5, frameType: 'LIGHT', binX: 2, binY: 2, gain: 100, offset: 10, subframe: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, transferFormat: 'FITS', compressed: false },
		retry: { maxAttempts: 1, delay: 0, backoff: 1, maximumDelay: 0, retryOn: [], onExhausted: 'fail' },
	}
}

function focusing(): SequencerMeridianFlipTrigger['focusing'] {
	return {
		triggers: { onStart: true, onFilterChange: false, afterMeridianFlip: true, afterRecovery: false, everyFrames: 0, everyTime: 0, temperatureChange: 0, starSizeChange: 0, minimumTimeBetweenRuns: 0 },
		algorithm: { initialOffsetSteps: 4, stepSize: 100, fittingMode: 'HYPERBOLIC', rmsdThreshold: 0.5, reversed: false, maximumPosition: 50000, backlash: { enabled: false, mode: 'overshoot', steps: 0 } },
		capture: { exposureTime: 3, frameType: 'LIGHT', binX: 2, binY: 2, gain: 120, offset: 15, subframe: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, transferFormat: 'FITS', compressed: false },
		starDetection: { type: 'astap', timeout: 30, minimumSNR: 8, maximumStars: 400 },
		filterOffsets: [],
		settle: 0,
		retry: { maxAttempts: 1, delay: 0, backoff: 1, maximumDelay: 0, retryOn: [], onExhausted: 'fail' },
		onFailure: 'fail',
	}
}

function flipConfiguration(overrides?: Partial<SequencerMeridianFlipTrigger>): SequencerMeridianFlipTrigger {
	return {
		minimumHourAngle: 0.01,
		maximumHourAngle: 0.05,
		safetyMargin: 60,
		waitForCurrentExposure: true,
		stopGuiding: true,
		pauseDomeSlaving: false,
		settle: 0,
		verifyPierSide: true,
		recenter: false,
		autofocus: false,
		restoreGuiding: true,
		restoreRotator: false,
		maximumAttempts: 2,
		timeout: 600,
		retry: { maxAttempts: 1, delay: 0, backoff: 1, maximumDelay: 0, retryOn: [], onExhausted: 'fail' },
		onFailure: 'pause',
		...overrides,
	}
}

function actionContext(devices: Record<string, { readonly device: unknown }>): SequencerActionContext {
	let ordinal = 0

	return {
		sessionId: 'session-1',
		nodeId: 'target[m42].trigger.meridianFlip',
		attempt: 1,
		scope: {} as SequencerActionContext['scope'],
		signal: new AbortController().signal,
		now: () => 1_000_000,
		request: (role) => devices[role] as never,
		progress: () => {},
		artifact: () => {},
		auxiliary: () => {
			++ordinal
			return { directory: '/data/session-1/.auxiliary/centering', fileName: `centering-${ordinal}.fits`, path: `/data/session-1/.auxiliary/centering/centering-${ordinal}.fits` }
		},
		checkpoint: { containers: [], attempts: {}, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1_000_000), definitionRevision: 1, handlerVersions: {} },
	}
}

function flipServices(commands: Command[], overrides?: Partial<{ pierSideVerified: boolean; failure: OperationFailureReason }>): SequencerMeridianFlipServices {
	return {
		mountCommander: {
			flip: (_scope: unknown, device: Mount, target: unknown, options: unknown) => {
				commands.push({ name: 'flip', detail: { target, options } })

				if (overrides?.failure !== undefined) return Promise.resolve(failedOperationResult(overrides.failure, 'boom'))

				const verified = overrides?.pierSideVerified !== false

				return Promise.resolve(successfulOperationResult({ rightAscension: 1.41, declination: -0.1, pierSide: verified ? 'WEST' : device.pierSide, initialPierSide: device.pierSide, pierSideVerified: verified }))
			},
			goTo: () => {
				commands.push({ name: 'goTo' })
				return Promise.resolve(successfulOperationResult({ rightAscension: 1.4, declination: -0.09, pierSide: 'WEST' }))
			},
			sync: () => {
				commands.push({ name: 'sync' })
				return Promise.resolve(successfulOperationResult(undefined))
			},
		} as unknown as SequencerMeridianFlipServices['mountCommander'],
		cameraHandler: {
			capture: (_scope: unknown, _camera: unknown, request: { outputName: string }) => {
				commands.push({ name: 'capture', detail: request.outputName })
				return { started: Promise.resolve(successfulOperationResult(undefined)), result: Promise.resolve(successfulOperationResult({ paths: [`/frames/${request.outputName}`] })) }
			},
		} as unknown as SequencerMeridianFlipServices['cameraHandler'],
		plateSolver: {
			start: () => {
				commands.push({ name: 'solve' })
				return Promise.resolve({ rightAscension: 1.4, declination: -0.09 })
			},
		} as unknown as SequencerMeridianFlipServices['plateSolver'],
		wheelCommander: {} as unknown as SequencerMeridianFlipServices['wheelCommander'],
		runner: {
			start: () => {
				commands.push({ name: 'autofocus' })
				return { handle: { result: Promise.resolve(successfulOperationResult({ outcome: 'focused', position: 12500, focusPoint: { x: 12500, y: 2.5 }, message: 'best focus!' })) }, finish: () => {} }
			},
		} as unknown as SequencerMeridianFlipServices['runner'],
		focuserCommander: {} as unknown as SequencerMeridianFlipServices['focuserCommander'],
	}
}

describe('meridian flip block', () => {
	const devices = { mount: 'Mount Simulator', camera: 'Camera Simulator', focuser: 'Focuser Simulator' } as SequencerDevices

	test('declares only the roles the recovery it was configured with commands', () => {
		const handler = sequencerMeridianFlipHandler({} as never)

		expect(handler.resources(flipConfiguration())).toEqual([{ role: 'mount' }])
		expect(handler.resources(flipConfiguration({ centering: centering() }))).toEqual([{ role: 'mount' }, { role: 'camera' }])
		expect(handler.resources(flipConfiguration({ centering: centering(), focusing: focusing() }))).toEqual([{ role: 'mount' }, { role: 'camera' }, { role: 'focuser' }])
	})

	test('declares the wheel the recovery reaches its declared filter through', () => {
		const handler = sequencerMeridianFlipHandler({} as never)
		const centeringFilter = { ...centering()!, capture: { ...centering()!.capture, filter: { type: 'name' as const, name: 'Luminance' } } }
		const focusingFilter = { ...focusing()!, capture: { ...focusing()!.capture, filter: { type: 'name' as const, name: 'Luminance' } } }

		expect(handler.resources(flipConfiguration({ centering: centeringFilter }))).toEqual([{ role: 'mount' }, { role: 'camera' }, { role: 'wheel', optional: true }])
		expect(handler.resources(flipConfiguration({ centering: centering(), focusing: focusingFilter }))).toEqual([{ role: 'mount' }, { role: 'camera' }, { role: 'focuser' }, { role: 'wheel', optional: true }])
	})

	test('refuses a definition without a device the recovery needs', () => {
		const handler = sequencerMeridianFlipHandler({} as never)

		expect(handler.validate(flipConfiguration(), { nodeId: 'target[m42].trigger.meridianFlip', devices: {} as SequencerDevices })).toEqual({ ok: false, issues: [{ path: 'devices.mount', message: 'the mount is required to flip across the meridian' }] })
		expect(handler.validate(flipConfiguration({ focusing: focusing() }), { nodeId: 'target[m42].trigger.meridianFlip', devices: { mount: 'Mount Simulator' } as SequencerDevices })).toMatchObject({ ok: false, issues: [{ path: 'devices.camera' }, { path: 'devices.focuser' }] })
		expect(handler.validate(flipConfiguration({ focusing: focusing() }), { nodeId: 'target[m42].trigger.meridianFlip', devices }).ok).toBe(true)
	})

	test('accepts a definition whose recovery names a filter but carries no wheel', () => {
		const handler = sequencerMeridianFlipHandler({} as never)
		const focusingFilter = { ...focusing()!, capture: { ...focusing()!.capture, filter: { type: 'name' as const, name: 'Luminance' } } }

		expect(handler.validate(flipConfiguration({ focusing: focusingFilter }), { nodeId: 'target[m42].trigger.meridianFlip', devices: { mount: 'Mount Simulator', camera: 'Camera Simulator', focuser: 'Focuser Simulator' } }).ok).toBe(true)
	})

	test('crosses towards where the mount is pointing rather than where the night started', async () => {
		const commands: Command[] = []
		const handler = sequencerMeridianFlipHandler(flipServices(commands))
		const result = await handler.execute(actionContext({ mount: { device: mount() } }), flipConfiguration())

		expect(result).toEqual({ type: 'completed', value: { pierSide: 'WEST', initialPierSide: 'EAST', verified: true, rightAscension: 1.41, declination: -0.1 } })
		expect(commands).toEqual([{ name: 'flip', detail: { target: { type: 'JNOW', JNOW: { x: 1.41, y: -0.1 } }, options: { timeout: 600000 } } }])
	})

	test('refuses a crossing it was told to verify and could not', async () => {
		const commands: Command[] = []
		const handler = sequencerMeridianFlipHandler(flipServices(commands, { pierSideVerified: false }))
		const result = await handler.execute(actionContext({ mount: { device: mount() } }), flipConfiguration())

		expect(result).toEqual({ type: 'retryableFailure', reason: 'unexpectedState', detail: 'the mount did not confirm a pier side change, reporting EAST' })
	})

	test('accepts an unverified crossing when the definition does not demand the evidence', async () => {
		const commands: Command[] = []
		const handler = sequencerMeridianFlipHandler(flipServices(commands, { pierSideVerified: false }))
		const result = await handler.execute(actionContext({ mount: { device: mount() } }), flipConfiguration({ verifyPierSide: false }))

		expect(result).toMatchObject({ type: 'completed', value: { verified: false, pierSide: 'EAST' } })
	})

	test('re-establishes the pointing before the focus, both under the same node', async () => {
		const commands: Command[] = []
		const handler = sequencerMeridianFlipHandler(flipServices(commands))
		const result = await handler.execute(
			actionContext({ mount: { device: mount() }, camera: { device: { type: 'camera', name: 'Camera Simulator', connected: true } }, focuser: { device: { type: 'focuser', name: 'Focuser Simulator', connected: true, position: { value: 12500, min: 0, max: 50000 } } } }),
			flipConfiguration({ centering: centering(), focusing: focusing() }),
		)

		expect(commands.map((command) => command.name)).toEqual(['flip', 'capture', 'solve', 'autofocus'])
		expect(result).toMatchObject({ type: 'completed', value: { verified: true, centering: { attempts: 1, verified: true }, focusing: { position: 12500, measured: 12500 } } })
	})

	test('reports a recovery that did not finish instead of a flip that completed', async () => {
		const commands: Command[] = []
		const services = flipServices(commands)
		const handler = sequencerMeridianFlipHandler({
			...services,
			plateSolver: {
				start: () => {
					commands.push({ name: 'solve' })
					return Promise.resolve(undefined)
				},
			} as unknown as SequencerMeridianFlipServices['plateSolver'],
		})
		const result = await handler.execute(actionContext({ mount: { device: mount() }, camera: { device: { type: 'camera', name: 'Camera Simulator', connected: true } } }), flipConfiguration({ centering: centering() }))

		expect(result).toMatchObject({ type: 'fatalFailure', reason: 'commandFailed' })
		expect(commands.map((command) => command.name)).toEqual(['flip', 'capture', 'solve'])
	})

	test('never sends a mount that already crossed back across the meridian', async () => {
		const commands: Command[] = []
		const services = flipServices(commands)
		const handler = sequencerMeridianFlipHandler({
			...services,
			runner: {
				start: () => {
					commands.push({ name: 'autofocus' })
					return { handle: { result: Promise.resolve(failedOperationResult('timeout', 'the sweep did not finish')) }, finish: () => {} }
				},
			} as unknown as SequencerMeridianFlipServices['runner'],
		})
		const context = actionContext({ mount: { device: mount() }, camera: { device: { type: 'camera', name: 'Camera Simulator', connected: true } }, focuser: { device: { type: 'focuser', name: 'Focuser Simulator', connected: true, position: { value: 12500, min: 0, max: 50000 } } } })
		const result = await handler.execute(context, flipConfiguration({ focusing: focusing() }))

		expect(result).toMatchObject({ type: 'fatalFailure', reason: 'timeout' })
		expect(commands.filter((command) => command.name === 'flip')).toHaveLength(1)
	})

	test('maps a failed crossing to a retry and a stopped session to a terminal failure', async () => {
		const failing = (reason: OperationFailureReason) => sequencerMeridianFlipHandler(flipServices([], { failure: reason }))

		expect(await failing('timeout').execute(actionContext({ mount: { device: mount() } }), flipConfiguration())).toEqual({ type: 'retryableFailure', reason: 'timeout', detail: 'the mount did not cross the meridian: boom' })
		expect(await failing('aborted').execute(actionContext({ mount: { device: mount() } }), flipConfiguration())).toEqual({ type: 'fatalFailure', reason: 'aborted', detail: 'the mount did not cross the meridian: boom' })
	})

	test('reports the role a session does not have instead of commanding a mount it lacks', async () => {
		const handler = sequencerMeridianFlipHandler({} as never)

		expect(await handler.execute(actionContext({}), flipConfiguration())).toEqual({ type: 'fatalFailure', reason: 'unexpectedState', detail: 'the mount role is not available to this session' })
	})
})
