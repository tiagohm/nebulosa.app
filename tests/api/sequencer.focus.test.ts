import { describe, expect, test } from 'bun:test'
import type { Camera, Focuser, Wheel } from 'nebulosa/src/devices/indi/device'
import type { AutoFocusRunOutcome } from 'src/api/autofocus.runner'
import { sequencerAutofocusHandler } from 'src/api/sequencer.focus'
import type { SequencerAutofocusServices } from 'src/api/sequencer.focus'
import type { SequencerActionContext, SequencerAuxiliaryTarget } from 'src/api/sequencer.registry'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { SequencerAutofocus, SequencerDevices } from '#/sequencer'

type AutofocusConfiguration = Omit<SequencerAutofocus, 'enabled'>

interface Command {
	readonly name: string
	readonly detail?: unknown
}

function camera(): Camera {
	return { type: 'camera', name: 'Camera Simulator', id: 'camera-1', connected: true } as unknown as Camera
}

function focuser(position: number): Focuser {
	return { type: 'focuser', name: 'Focuser Simulator', id: 'focuser-1', connected: true, position: { value: position, min: 0, max: 100000 } } as unknown as Focuser
}

function wheel(names: readonly string[], position: number): Wheel {
	return { type: 'wheel', name: 'Wheel Simulator', id: 'wheel-1', connected: true, count: names.length, names, position, moving: false } as unknown as Wheel
}

function autofocusConfiguration(overrides?: Partial<AutofocusConfiguration>): AutofocusConfiguration {
	return {
		triggers: { onStart: true, onFilterChange: false, afterMeridianFlip: false, afterRecovery: false, everyFrames: 0, everyTime: 0, temperatureChange: 0, starSizeChange: 0, minimumTimeBetweenRuns: 0 },
		algorithm: { initialOffsetSteps: 4, stepSize: 100, fittingMode: 'HYPERBOLIC', rmsdThreshold: 0.5, reversed: false, maximumPosition: 50000, backlash: { enabled: false, mode: 'overshoot', steps: 0 } },
		capture: { exposureTime: 3, frameType: 'LIGHT', binX: 2, binY: 2, gain: 120, offset: 15, subframe: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, transferFormat: 'FITS', compressed: false },
		starDetection: { type: 'astap', timeout: 30, minimumSNR: 8, maximumStars: 400 },
		filterOffsets: [],
		settle: 0,
		retry: { maxAttempts: 1, delay: 0, backoff: 1, maximumDelay: 0, retryOn: [], onExhausted: 'fail' },
		onFailure: 'fail',
		...overrides,
	}
}

function actionContext(devices: Record<string, { readonly device: unknown }>, auxiliary?: (ordinal: number) => SequencerAuxiliaryTarget | undefined): SequencerActionContext {
	let ordinal = 0

	return {
		sessionId: 'session-1',
		nodeId: 'target[m42].autofocus',
		attempt: 1,
		scope: {} as SequencerActionContext['scope'],
		signal: new AbortController().signal,
		now: () => 1_000_000,
		request: (role) => devices[role] as never,
		progress: () => {},
		artifact: () => {},
		auxiliary: () => (auxiliary ?? defaultAuxiliary)(++ordinal),
		checkpoint: { containers: [], attempts: {}, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1_000_000), definitionRevision: 1, handlerVersions: {} },
	}
}

function defaultAuxiliary(ordinal: number): SequencerAuxiliaryTarget {
	return { directory: '/data/session-1/.auxiliary/autofocus', fileName: `autofocus-${ordinal}.fits`, path: `/data/session-1/.auxiliary/autofocus/autofocus-${ordinal}.fits` }
}

function focusServices(commands: Command[], outcome: OperationResult<AutoFocusRunOutcome>, target?: Focuser): SequencerAutofocusServices {
	return {
		runner: {
			start: (_scope: unknown, _camera: Camera, _focuser: Focuser, request: unknown) => {
				commands.push({ name: 'autofocus', detail: request })
				return { handle: { result: Promise.resolve(outcome) }, finish: () => {} }
			},
		} as unknown as SequencerAutofocusServices['runner'],
		focuserCommander: {
			moveTo: (_scope: unknown, _focuser: Focuser, position: number) => {
				commands.push({ name: 'focuserMoveTo', detail: position })
				if (target !== undefined) target.position.value = position
				return Promise.resolve(successfulOperationResult(undefined))
			},
		} as unknown as SequencerAutofocusServices['focuserCommander'],
		wheelCommander: {
			moveTo: (_scope: unknown, device: Wheel, slot: number) => {
				commands.push({ name: 'wheelMoveTo', detail: slot })
				device.position = slot
				return Promise.resolve(successfulOperationResult(undefined))
			},
		} as unknown as SequencerAutofocusServices['wheelCommander'],
	}
}

function focused(position: number): OperationResult<AutoFocusRunOutcome> {
	return successfulOperationResult({ outcome: 'focused', position, focusPoint: { x: position, y: 2.5 }, message: 'focused' })
}

describe('autofocus block', () => {
	const devices = { camera: 'Camera Simulator', focuser: 'Focuser Simulator' } as SequencerDevices

	test('refuses a definition without the focuser it commands', () => {
		const handler = sequencerAutofocusHandler({} as never)

		expect(handler.resources(autofocusConfiguration())).toEqual([{ role: 'camera' }, { role: 'focuser' }])
		expect(handler.validate(autofocusConfiguration(), { nodeId: 'target[m42].autofocus', devices: { camera: 'Camera Simulator' } })).toEqual({ ok: false, issues: [{ path: 'devices.focuser', message: 'the focuser is required to autofocus' }] })
		expect(handler.validate(autofocusConfiguration(), { nodeId: 'target[m42].autofocus', devices }).ok).toBe(true)
	})

	test('reports the role a session does not have instead of commanding a device it lacks', async () => {
		const handler = sequencerAutofocusHandler({} as never)

		expect(await handler.execute(actionContext({}), autofocusConfiguration())).toMatchObject({ type: 'fatalFailure', reason: 'unexpectedState' })
		expect(await handler.execute(actionContext({ camera: { device: camera() } }), autofocusConfiguration())).toEqual({ type: 'fatalFailure', reason: 'unexpectedState', detail: 'the focuser role is not available to this session' })
	})

	test('searches on the installed path and reports the position it converged on', async () => {
		const commands: Command[] = []
		const handler = sequencerAutofocusHandler(focusServices(commands, focused(12500)))
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) } }), autofocusConfiguration())

		expect(result).toEqual({ type: 'completed', value: { position: 12500, measured: 12500, focusPoint: { x: 12500, y: 2.5 }, filter: undefined, measuredFilter: undefined } })
		expect(commands.map((command) => command.name)).toEqual(['autofocus'])
		expect(commands[0].detail).toMatchObject({ initialOffsetSteps: 4, stepSize: 100, fittingMode: 'HYPERBOLIC', rmsdThreshold: 0.5, reversed: false, maxPosition: 50000 })
	})

	test('builds the capture and the star detection from its own recipe', async () => {
		const commands: Command[] = []
		const handler = sequencerAutofocusHandler(focusServices(commands, focused(12500)))

		await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) } }), autofocusConfiguration())

		expect(commands[0].detail).toMatchObject({
			capture: { exposureTime: 3, exposureTimeUnit: 'second', binX: 2, binY: 2, gain: 120, offset: 15, subframe: false, transferFormat: 'FITS', compressed: false },
			starDetection: { type: 'astap', timeout: 30000, minSNR: 8, maxStars: 400 },
		})
	})

	test('focuses through the declared filter, restores the frame filter, and carries the measurement across with the offsets', async () => {
		const commands: Command[] = []
		const device = focuser(12000)
		const handler = sequencerAutofocusHandler(focusServices(commands, focused(12500), device))
		const configuration = autofocusConfiguration({
			capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'L' } },
			filterOffsets: [
				{ filter: { type: 'name', name: 'L' }, offset: 0 },
				{ filter: { type: 'name', name: 'B' }, offset: 80 },
			],
		})
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device }, wheel: { device: wheel(['L', 'R', 'G', 'B'], 3) } }), configuration)

		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo', 'autofocus', 'wheelMoveTo', 'focuserMoveTo'])
		expect(commands.map((command) => command.detail)).toMatchObject([0, {}, 3, 12580])
		expect(result).toEqual({ type: 'completed', value: { position: 12580, measured: 12500, focusPoint: { x: 12500, y: 2.5 }, filter: 'B', measuredFilter: 'L' } })
	})

	test('leaves the focuser where the search left it when both paths share an offset', async () => {
		const commands: Command[] = []
		const handler = sequencerAutofocusHandler(focusServices(commands, focused(12500)))
		const configuration = autofocusConfiguration({
			capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'L' } },
			filterOffsets: [
				{ filter: { type: 'name', name: 'L' }, offset: 40 },
				{ filter: { type: 'name', name: 'B' }, offset: 40 },
			],
		})
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) }, wheel: { device: wheel(['L', 'R', 'G', 'B'], 3) } }), configuration)

		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo', 'autofocus', 'wheelMoveTo'])
		expect(result).toMatchObject({ type: 'completed', value: { position: 12500, measured: 12500 } })
	})

	test('searches on the installed path when the recipe names a filter this wheel does not carry', async () => {
		const commands: Command[] = []
		const handler = sequencerAutofocusHandler(focusServices(commands, focused(12500)))
		const configuration = autofocusConfiguration({ capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'Ha' } } })
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) }, wheel: { device: wheel(['L', 'R', 'G', 'B'], 1) } }), configuration)

		expect(commands.map((command) => command.name)).toEqual(['autofocus'])
		expect(result).toMatchObject({ type: 'completed', value: { filter: 'R', measuredFilter: 'R' } })
	})

	test('gives every sampled frame a destination of its own', async () => {
		const destinations: (SequencerAuxiliaryTarget | undefined)[] = []
		const services = focusServices([], focused(12500))
		const handler = sequencerAutofocusHandler({
			...services,
			runner: {
				start: (_scope: unknown, _camera: Camera, _focuser: Focuser, _request: unknown, destination: () => SequencerAuxiliaryTarget | undefined) => {
					destinations.push(destination(), destination())
					return { handle: { result: Promise.resolve(focused(12500)) }, finish: () => {} }
				},
			} as unknown as SequencerAutofocusServices['runner'],
		})

		await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) } }), autofocusConfiguration())

		expect(destinations.map((destination) => destination?.fileName)).toEqual(['autofocus-1.fits', 'autofocus-2.fits'])
	})

	test('keeps a search that found no focus as a run still owed instead of a completed one', async () => {
		const commands: Command[] = []
		const noStars = successfulOperationResult<AutoFocusRunOutcome>({ outcome: 'noStars', position: 12000, message: 'no stars were detected' })
		const handler = sequencerAutofocusHandler(focusServices(commands, noStars))
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) } }), autofocusConfiguration())

		expect(result).toEqual({ type: 'retryableFailure', reason: 'unexpectedState', detail: 'the autofocus found no focus: no stars were detected' })
	})

	test('maps a failed search to a retry and a stopped session to a terminal failure', async () => {
		const failing = (reason: 'timeout' | 'aborted') => sequencerAutofocusHandler(focusServices([], failedOperationResult(reason, 'boom')))
		const context = () => actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) } })

		expect(await failing('timeout').execute(context(), autofocusConfiguration())).toEqual({ type: 'retryableFailure', reason: 'timeout', detail: 'the autofocus search failed: boom' })
		expect(await failing('aborted').execute(context(), autofocusConfiguration())).toEqual({ type: 'fatalFailure', reason: 'aborted', detail: 'the autofocus search failed: boom' })
	})
})
