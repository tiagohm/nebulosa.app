import { describe, expect, test } from 'bun:test'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { Camera, Mount, Wheel } from 'nebulosa/src/devices/indi/device'
import type { SequencerCenter, SequencerSlew } from 'src/api/sequencer.compiler'
import { sequencerCenterHandler, sequencerSlewHandler } from 'src/api/sequencer.pointing'
import type { SequencerCenteringServices } from 'src/api/sequencer.pointing'
import type { SequencerActionContext, SequencerAuxiliaryTarget } from 'src/api/sequencer.registry'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationFailureReason } from '#/orchestration'
import type { SequencerDevices } from '#/sequencer'

const TARGET = { type: 'J2000' as const, J2000: { x: 1.4, y: -0.09 } }

interface Command {
	readonly name: string
	readonly detail?: unknown
}

function mount(): Mount {
	return { type: 'mount', name: 'Mount Simulator', id: 'mount-1', connected: true, tracking: false, pierSide: 'WEST', equatorialCoordinate: { rightAscension: 1.4, declination: -0.09 }, geographicCoordinate: { longitude: 0 } } as unknown as Mount
}

function camera(): Camera {
	return { type: 'camera', name: 'Camera Simulator', id: 'camera-1', connected: true } as unknown as Camera
}

function wheel(names: readonly string[], position: number): Wheel {
	return { type: 'wheel', name: 'Wheel Simulator', id: 'wheel-1', connected: true, count: names.length, names, position, moving: false } as unknown as Wheel
}

function slewConfiguration(overrides?: Partial<SequencerSlew>): SequencerSlew {
	return { coordinates: TARGET, skipWhenAlreadyAtTarget: true, tolerance: 0.001, arrivalTolerance: 0.01, timeout: 300, settle: 0, retry: { maxAttempts: 1, delay: 0, backoff: 1, maximumDelay: 0, retryOn: [], onExhausted: 'fail' }, ...overrides }
}

function centerConfiguration(overrides?: Partial<SequencerCenter>): SequencerCenter {
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
		...overrides,
	}
}

function actionContext(devices: Record<string, { readonly device: unknown }>, auxiliary?: (ordinal: number, extension: string) => SequencerAuxiliaryTarget | undefined): SequencerActionContext {
	let ordinal = 0

	return {
		sessionId: 'session-1',
		nodeId: 'target[m42].center',
		attempt: 1,
		scope: {} as SequencerActionContext['scope'],
		signal: new AbortController().signal,
		now: () => 1_000_000,
		request: (role) => devices[role] as never,
		progress: () => {},
		artifact: () => {},
		auxiliary: (_kind, extension) => (auxiliary ?? defaultAuxiliary)(++ordinal, extension),
		checkpoint: { containers: [], attempts: {}, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1_000_000), definitionRevision: 1, handlerVersions: {} },
	}
}

function defaultAuxiliary(ordinal: number, extension = 'fits'): SequencerAuxiliaryTarget {
	return { directory: '/data/session-1/.auxiliary/centering', fileName: `centering-${ordinal}.${extension}`, path: `/data/session-1/.auxiliary/centering/centering-${ordinal}.${extension}` }
}

function solution(rightAscension: number, declination: number): PlateSolution {
	return { rightAscension, declination } as unknown as PlateSolution
}

// Records every command the handlers issue, so the tests assert the order and not only the final state.
function centeringServices(commands: Command[], solutions: readonly (PlateSolution | undefined)[], slewFailure?: OperationFailureReason): SequencerCenteringServices {
	let solved = 0

	return {
		cameraHandler: {
			capture: (_scope: unknown, _camera: Camera, request: { outputName: string }) => {
				commands.push({ name: 'capture', detail: request.outputName })
				return { started: Promise.resolve(successfulOperationResult(undefined)), result: Promise.resolve(successfulOperationResult({ paths: [`/frames/${request.outputName}`] })) }
			},
		} as unknown as SequencerCenteringServices['cameraHandler'],
		mountCommander: {
			goTo: (_scope: unknown, _mount: Mount) => {
				commands.push({ name: 'goTo' })
				return Promise.resolve(slewFailure === undefined ? successfulOperationResult({ rightAscension: 1.4, declination: -0.09, pierSide: 'WEST' }) : failedOperationResult(slewFailure))
			},
			sync: (_scope: unknown, _mount: Mount, target: unknown) => {
				commands.push({ name: 'sync', detail: target })
				return Promise.resolve(successfulOperationResult(undefined))
			},
		} as unknown as SequencerCenteringServices['mountCommander'],
		wheelCommander: {
			moveTo: (_scope: unknown, _wheel: Wheel, slot: number) => {
				commands.push({ name: 'wheelMoveTo', detail: slot })
				return Promise.resolve(successfulOperationResult(undefined))
			},
		} as unknown as SequencerCenteringServices['wheelCommander'],
		plateSolver: {
			start: (request: { path: string }) => {
				commands.push({ name: 'solve', detail: request.path })
				return Promise.resolve(solutions[Math.min(solved++, solutions.length - 1)])
			},
		} as unknown as SequencerCenteringServices['plateSolver'],
	}
}

describe('slew block', () => {
	const devices = { mount: 'Mount Simulator' } as SequencerDevices

	test('refuses a definition without the mount it commands', () => {
		const handler = sequencerSlewHandler({} as never)

		expect(handler.resources(slewConfiguration())).toEqual([{ role: 'mount' }])
		expect(handler.validate(slewConfiguration(), { nodeId: 'target[m42].slew', devices: {} as SequencerDevices })).toEqual({ ok: false, issues: [{ path: 'devices.mount', message: 'the mount is required to point the telescope' }] })
		expect(handler.validate(slewConfiguration(), { nodeId: 'target[m42].slew', devices }).ok).toBe(true)
	})

	test('slews with the declared tolerances and establishes the tracking of the target', async () => {
		const commands: Command[] = []
		const device = mount()
		const commander = {
			goTo: (_scope: unknown, _mount: Mount, target: unknown, options: unknown) => {
				commands.push({ name: 'goTo', detail: options })
				expect(target).toBe(TARGET)
				return Promise.resolve(successfulOperationResult({ rightAscension: 1.4, declination: -0.09, pierSide: 'WEST' }))
			},
			setTrackMode: (_scope: unknown, _mount: Mount, mode: string) => {
				commands.push({ name: 'setTrackMode', detail: mode })
				return Promise.resolve(successfulOperationResult(undefined))
			},
			setTracking: (_scope: unknown, target: Mount, enabled: boolean) => {
				commands.push({ name: 'setTracking', detail: enabled })
				target.tracking = enabled
				return Promise.resolve(successfulOperationResult(undefined))
			},
		}

		const handler = sequencerSlewHandler(commander as never)
		const configuration = slewConfiguration({ tracking: { mode: 'SIDEREAL', retry: slewConfiguration().retry } })
		const result = await handler.execute(actionContext({ mount: { device } }), configuration)

		expect(result).toEqual({ type: 'completed', value: { rightAscension: 1.4, declination: -0.09, pierSide: 'WEST', tracking: true } })
		expect(commands).toEqual([
			{ name: 'goTo', detail: { timeout: 300000, tolerance: 0.001, arrivalTolerance: 0.01 } },
			{ name: 'setTrackMode', detail: 'SIDEREAL' },
			{ name: 'setTracking', detail: true },
		])
	})

	test('commands the movement unconditionally when the skip is turned off', async () => {
		const commands: Command[] = []
		const commander = {
			goTo: (_scope: unknown, _mount: Mount, _target: unknown, options: { tolerance: number }) => {
				commands.push({ name: 'goTo', detail: options.tolerance })
				return Promise.resolve(successfulOperationResult({ rightAscension: 1.4, declination: -0.09, pierSide: 'WEST' }))
			},
		}

		const handler = sequencerSlewHandler(commander as never)
		await handler.execute(actionContext({ mount: { device: mount() } }), slewConfiguration({ skipWhenAlreadyAtTarget: false }))

		expect(commands).toEqual([{ name: 'goTo', detail: 0 }])
	})

	test('maps a failed slew to a retry and a stopped session to a terminal failure', async () => {
		const failing = (reason: OperationFailureReason) => sequencerSlewHandler({ goTo: () => Promise.resolve(failedOperationResult(reason, 'boom')) } as never)

		expect(await failing('timeout').execute(actionContext({ mount: { device: mount() } }), slewConfiguration())).toEqual({ type: 'retryableFailure', reason: 'timeout', detail: 'the mount did not reach the target: boom' })
		expect(await failing('aborted').execute(actionContext({ mount: { device: mount() } }), slewConfiguration())).toEqual({ type: 'fatalFailure', reason: 'aborted', detail: 'the mount did not reach the target: boom' })
	})
})

describe('centering block', () => {
	const devices = { mount: 'Mount Simulator', camera: 'Camera Simulator' } as SequencerDevices

	test('refuses a definition without the camera it exposes with', () => {
		const handler = sequencerCenterHandler({} as never)

		expect(handler.resources(centerConfiguration())).toEqual([{ role: 'mount' }, { role: 'camera' }])
		expect(handler.resources(centerConfiguration({ capture: { ...centerConfiguration().capture, filter: { type: 'name', name: 'Luminance' } } }))).toEqual([{ role: 'mount' }, { role: 'camera' }, { role: 'wheel', optional: true }])
		expect(handler.validate(centerConfiguration(), { nodeId: 'target[m42].center', devices: { mount: 'Mount Simulator' } as SequencerDevices })).toEqual({ ok: false, issues: [{ path: 'devices.camera', message: 'the camera is required to point the telescope' }] })
		expect(handler.validate(centerConfiguration(), { nodeId: 'target[m42].center', devices }).ok).toBe(true)
	})

	test('ends on the first solve when the field is already within tolerance and commands nothing', async () => {
		const commands: Command[] = []
		const handler = sequencerCenterHandler(centeringServices(commands, [solution(1.4, -0.09)]))
		const result = await handler.execute(actionContext({ mount: { device: mount() }, camera: { device: camera() } }), centerConfiguration())

		expect(result).toEqual({ type: 'completed', value: { attempts: 1, separation: 0, rightAscension: 1.4, declination: -0.09, verified: true, synced: false } })
		expect(commands.map((command) => command.name)).toEqual(['capture', 'solve'])
	})

	test('syncs the model, corrects, and verifies the corrected field', async () => {
		const commands: Command[] = []
		const handler = sequencerCenterHandler(centeringServices(commands, [solution(1.41, -0.09), solution(1.4, -0.09)]))
		const result = await handler.execute(actionContext({ mount: { device: mount() }, camera: { device: camera() } }), centerConfiguration())

		expect(result).toEqual({ type: 'completed', value: { attempts: 2, separation: 0, rightAscension: 1.4, declination: -0.09, verified: true, synced: true } })
		expect(commands.map((command) => command.name)).toEqual(['capture', 'solve', 'sync', 'goTo', 'capture', 'solve'])
		expect(commands[2].detail).toEqual({ type: 'J2000', J2000: { x: 1.41, y: -0.09 } })
		// Each exposure lands on its own reserved destination, so a loop never overwrites the frame that decided
		// the previous correction.
		expect(commands.filter((command) => command.name === 'capture').map((command) => command.detail)).toEqual(['centering-1.fits', 'centering-2.fits'])
	})

	test('names every centering frame after the container its recipe transfers', async () => {
		const commands: Command[] = []
		const handler = sequencerCenterHandler(centeringServices(commands, [solution(1.4, -0.09)]))
		const configuration = centerConfiguration()
		const result = await handler.execute(actionContext({ mount: { device: mount() }, camera: { device: camera() } }), { ...configuration, capture: { ...configuration.capture, transferFormat: 'XISF' } })

		expect(result).toMatchObject({ type: 'completed' })
		expect(commands.filter((command) => command.name === 'capture').map((command) => command.detail)).toEqual(['centering-1.xisf'])
	})

	test('stops right after the correction when no final solve was asked for', async () => {
		const commands: Command[] = []
		const handler = sequencerCenterHandler(centeringServices(commands, [solution(1.41, -0.09)]))
		const result = await handler.execute(actionContext({ mount: { device: mount() }, camera: { device: camera() } }), centerConfiguration({ finalSolve: false }))

		expect(result).toMatchObject({ type: 'completed', value: { attempts: 1, verified: false, synced: true } })
		expect(commands.map((command) => command.name)).toEqual(['capture', 'solve', 'sync', 'goTo'])
	})

	test('corrects on a single attempt when no final solve was asked for', async () => {
		const commands: Command[] = []
		const handler = sequencerCenterHandler(centeringServices(commands, [solution(1.41, -0.09)]))
		const result = await handler.execute(actionContext({ mount: { device: mount() }, camera: { device: camera() } }), centerConfiguration({ finalSolve: false, maximumAttempts: 1 }))

		expect(result).toMatchObject({ type: 'completed', value: { attempts: 1, verified: false, synced: true } })
		expect(commands.map((command) => command.name)).toEqual(['capture', 'solve', 'sync', 'goTo'])
	})

	test('reports the observed miss when the attempts run out instead of correcting blindly', async () => {
		const commands: Command[] = []
		const handler = sequencerCenterHandler(centeringServices(commands, [solution(1.5, -0.09)]))
		const result = await handler.execute(actionContext({ mount: { device: mount() }, camera: { device: camera() } }), centerConfiguration({ maximumAttempts: 2 }))

		expect(result).toMatchObject({ type: 'retryableFailure', reason: 'unexpectedState' })
		expect(commands.map((command) => command.name)).toEqual(['capture', 'solve', 'sync', 'goTo', 'capture', 'solve'])
	})

	test('moves the wheel to the filter of its own recipe before exposing and puts it back after', async () => {
		const commands: Command[] = []
		const handler = sequencerCenterHandler(centeringServices(commands, [solution(1.4, -0.09)]))
		const configuration = centerConfiguration({ capture: { ...centerConfiguration().capture, filter: { type: 'name', name: 'L' } } })
		const context = actionContext({ mount: { device: mount() }, camera: { device: camera() }, wheel: { device: wheel(['R', 'G', 'B', 'L'], 0) } })

		await handler.execute(context, configuration)

		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo', 'capture', 'solve', 'wheelMoveTo'])
		expect(commands.filter((command) => command.name === 'wheelMoveTo').map((command) => command.detail)).toEqual([3, 0])
	})

	test('puts the wheel back even when the centering itself failed', async () => {
		const commands: Command[] = []
		const handler = sequencerCenterHandler(centeringServices(commands, [solution(1.5, -0.09)]))
		const configuration = centerConfiguration({ maximumAttempts: 1, capture: { ...centerConfiguration().capture, filter: { type: 'name', name: 'L' } } })
		const context = actionContext({ mount: { device: mount() }, camera: { device: camera() }, wheel: { device: wheel(['R', 'G', 'B', 'L'], 0) } })
		const result = await handler.execute(context, configuration)

		expect(result).toMatchObject({ type: 'retryableFailure' })
		expect(commands.filter((command) => command.name === 'wheelMoveTo').map((command) => command.detail)).toEqual([3, 0])
	})

	test('does not expose a frame it has nowhere proven to write', async () => {
		const commands: Command[] = []
		const handler = sequencerCenterHandler(centeringServices(commands, [solution(1.4, -0.09)]))
		const result = await handler.execute(
			actionContext({ mount: { device: mount() }, camera: { device: camera() } }, () => undefined),
			centerConfiguration(),
		)

		expect(result).toMatchObject({ type: 'fatalFailure', reason: 'unexpectedState' })
		expect(commands).toEqual([])
	})

	test('reports an unsolvable frame as retryable', async () => {
		const commands: Command[] = []
		const handler = sequencerCenterHandler(centeringServices(commands, [undefined]))
		const result = await handler.execute(actionContext({ mount: { device: mount() }, camera: { device: camera() } }), centerConfiguration())

		expect(result).toEqual({ type: 'retryableFailure', reason: 'commandFailed', detail: 'the centering frame could not be solved' })
	})
})
