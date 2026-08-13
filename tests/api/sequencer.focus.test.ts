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

function actionContext(devices: Record<string, { readonly device: unknown }>, auxiliary?: (ordinal: number, extension: string) => SequencerAuxiliaryTarget | undefined): SequencerActionContext {
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
		auxiliary: (_kind, extension) => (auxiliary ?? defaultAuxiliary)(++ordinal, extension),
		checkpoint: { containers: [], attempts: {}, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1_000_000), definitionRevision: 1, handlerVersions: {} },
	}
}

function defaultAuxiliary(ordinal: number, extension = 'fits'): SequencerAuxiliaryTarget {
	return { directory: '/data/session-1/.auxiliary/autofocus', fileName: `autofocus-${ordinal}.${extension}`, path: `/data/session-1/.auxiliary/autofocus/autofocus-${ordinal}.${extension}` }
}

function focusServices(commands: Command[], outcome: OperationResult<AutoFocusRunOutcome>, target?: Focuser): SequencerAutofocusServices {
	return {
		runner: {
			start: (_scope: unknown, _camera: Camera, _focuser: Focuser, request: unknown) => {
				commands.push({ name: 'autofocus', detail: request })
				if (target !== undefined && outcome.ok) target.position.value = outcome.value.position
				return { handle: { id: 'run-1', result: Promise.resolve(outcome) }, finish: () => {} }
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
		expect(handler.resources(autofocusConfiguration({ capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'Luminance' } } }))).toEqual([{ role: 'camera' }, { role: 'focuser' }, { role: 'wheel', optional: true }])
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

		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo', 'focuserMoveTo', 'autofocus', 'wheelMoveTo', 'focuserMoveTo'])
		expect(commands.map((command) => command.detail)).toMatchObject([0, 11920, {}, 3, 12580])
		expect(result).toEqual({ type: 'completed', value: { position: 12580, measured: 12500, focusPoint: { x: 12500, y: 2.5 }, filter: 'B', measuredFilter: 'L' } })
	})

	test('takes the offset of the autofocus filter before searching through it', async () => {
		const commands: Command[] = []
		const device = focuser(12000)
		let searchedFrom = 0
		const services: SequencerAutofocusServices = {
			...focusServices(commands, focused(11150), device),
			runner: {
				start: (_scope: unknown, _camera: Camera, _focuser: Focuser, request: unknown) => {
					searchedFrom = device.position.value
					commands.push({ name: 'autofocus', detail: request })
					device.position.value = 11150
					return { handle: { id: 'run-1', result: Promise.resolve(focused(11150)) }, finish: () => {} }
				},
			} as unknown as SequencerAutofocusServices['runner'],
		}
		const handler = sequencerAutofocusHandler(services)
		const configuration = autofocusConfiguration({
			capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'L' } },
			filterOffsets: [
				{ filter: { type: 'name', name: 'L' }, offset: 0 },
				{ filter: { type: 'name', name: 'B' }, offset: 900 },
			],
		})
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device }, wheel: { device: wheel(['L', 'R', 'G', 'B'], 3) } }), configuration)

		expect(searchedFrom).toBe(11100)
		expect(Math.abs(searchedFrom - 11150)).toBeLessThanOrEqual(configuration.algorithm.initialOffsetSteps * configuration.algorithm.stepSize)
		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo', 'focuserMoveTo', 'autofocus', 'wheelMoveTo', 'focuserMoveTo'])
		expect(commands.map((command) => command.detail)).toMatchObject([0, 11100, {}, 3, 12050])
		expect(result).toMatchObject({ type: 'completed', value: { position: 12050, measured: 11150, filter: 'B', measuredFilter: 'L' } })
	})

	test('puts both halves of the path back when the offset of the autofocus filter is refused', async () => {
		const commands: Command[] = []
		const device = focuser(12000)
		const optics = wheel(['L', 'R', 'G', 'B'], 3)
		let moves = 0
		const services: SequencerAutofocusServices = {
			...focusServices(commands, focused(11150), device),
			focuserCommander: {
				moveTo: (_scope: unknown, _focuser: Focuser, position: number) => {
					commands.push({ name: 'focuserMoveTo', detail: position })

					if (++moves === 1) {
						device.position.value = 11400
						return Promise.resolve(failedOperationResult('timeout', 'the focuser stalled'))
					}

					device.position.value = position
					return Promise.resolve(successfulOperationResult(undefined))
				},
			} as unknown as SequencerAutofocusServices['focuserCommander'],
		}
		const handler = sequencerAutofocusHandler(services)
		const configuration = autofocusConfiguration({
			capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'L' } },
			filterOffsets: [
				{ filter: { type: 'name', name: 'L' }, offset: 0 },
				{ filter: { type: 'name', name: 'B' }, offset: 900 },
			],
		})
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device }, wheel: { device: optics } }), configuration)

		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo', 'focuserMoveTo', 'wheelMoveTo', 'focuserMoveTo'])
		expect(commands.map((command) => command.detail)).toMatchObject([0, 11100, 3, 12000])
		expect(optics.position).toBe(3)
		expect(device.position.value).toBe(12000)
		expect(result).toEqual({ type: 'retryableFailure', reason: 'timeout', detail: 'the focuser did not take the offset of the autofocus filter: the focuser stalled' })
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

	test('names every sampled frame after the container its recipe transfers', async () => {
		const destinations: (SequencerAuxiliaryTarget | undefined)[] = []
		const services = focusServices([], focused(12500))
		const handler = sequencerAutofocusHandler({
			...services,
			runner: {
				start: (_scope: unknown, _camera: Camera, _focuser: Focuser, _request: unknown, destination: () => SequencerAuxiliaryTarget | undefined) => {
					destinations.push(destination())
					return { handle: { result: Promise.resolve(focused(12500)) }, finish: () => {} }
				},
			} as unknown as SequencerAutofocusServices['runner'],
		})
		const configuration = autofocusConfiguration({ capture: { ...autofocusConfiguration().capture, transferFormat: 'XISF' } })

		await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) } }), configuration)

		expect(destinations.map((destination) => destination?.fileName)).toEqual(['autofocus-1.xisf'])
	})

	test('keeps a search that found no focus as a run still owed instead of a completed one', async () => {
		const commands: Command[] = []
		const noStars = successfulOperationResult<AutoFocusRunOutcome>({ outcome: 'noStars', position: 12000, message: 'no stars were detected' })
		const handler = sequencerAutofocusHandler(focusServices(commands, noStars))
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) } }), autofocusConfiguration())

		expect(result).toEqual({ type: 'retryableFailure', reason: 'unexpectedState', detail: 'the autofocus found no focus: no stars were detected' })
	})

	test('ends the run of the shared feed whatever the search reported', async () => {
		const finished: string[] = []
		const runnerOf = (outcome: OperationResult<AutoFocusRunOutcome>) =>
			({
				start: () => ({ handle: { id: 'run-1', result: Promise.resolve(outcome) }, finish: (id: string, message: string) => finished.push(`${id}: ${message}`) }),
			}) as unknown as SequencerAutofocusServices['runner']
		const services = focusServices([], focused(12500))
		const context = () => actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) } })

		await sequencerAutofocusHandler({ ...services, runner: runnerOf(focused(12500)) }).execute(context(), autofocusConfiguration())
		await sequencerAutofocusHandler({ ...services, runner: runnerOf(successfulOperationResult<AutoFocusRunOutcome>({ outcome: 'noStars', position: 12000, message: 'no stars were detected' })) }).execute(context(), autofocusConfiguration())
		await sequencerAutofocusHandler({ ...services, runner: runnerOf(failedOperationResult('timeout', 'boom')) }).execute(context(), autofocusConfiguration())

		expect(finished).toEqual(['run-1: focused', 'run-1: no stars were detected', 'run-1: boom'])
	})

	test('puts the wheel back on the frame filter when the search found no focus', async () => {
		const commands: Command[] = []
		const noStars = successfulOperationResult<AutoFocusRunOutcome>({ outcome: 'noStars', position: 12000, message: 'no stars were detected' })
		const handler = sequencerAutofocusHandler(focusServices(commands, noStars))
		const device = wheel(['L', 'R', 'G', 'B'], 3)
		const configuration = autofocusConfiguration({ capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'L' } } })
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) }, wheel: { device } }), configuration)

		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo', 'autofocus', 'wheelMoveTo'])
		expect(commands.map((command) => command.detail)).toMatchObject([0, {}, 3])
		expect(device.position).toBe(3)
		expect(result).toMatchObject({ type: 'retryableFailure', reason: 'unexpectedState' })
	})

	test('puts the wheel back on the frame filter when the search itself failed', async () => {
		const commands: Command[] = []
		const handler = sequencerAutofocusHandler(focusServices(commands, failedOperationResult('timeout', 'boom')))
		const device = wheel(['L', 'R', 'G', 'B'], 3)
		const configuration = autofocusConfiguration({ capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'L' } } })
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) }, wheel: { device } }), configuration)

		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo', 'autofocus', 'wheelMoveTo'])
		expect(device.position).toBe(3)
		expect(result).toMatchObject({ type: 'retryableFailure', reason: 'timeout' })
	})

	test('puts the focus of the frame filter back when the offset move is refused', async () => {
		const commands: Command[] = []
		const device = focuser(12000)
		const services: SequencerAutofocusServices = {
			...focusServices(commands, focused(12500), device),
			focuserCommander: {
				moveTo: (_scope: unknown, _focuser: Focuser, position: number) => {
					commands.push({ name: 'focuserMoveTo', detail: position })
					if (position === 12580) return Promise.resolve(failedOperationResult('timeout', 'the focuser stalled'))
					device.position.value = position
					return Promise.resolve(successfulOperationResult(undefined))
				},
			} as unknown as SequencerAutofocusServices['focuserCommander'],
		}
		const handler = sequencerAutofocusHandler(services)
		const configuration = autofocusConfiguration({
			capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'L' } },
			filterOffsets: [
				{ filter: { type: 'name', name: 'L' }, offset: 0 },
				{ filter: { type: 'name', name: 'B' }, offset: 80 },
			],
		})
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device }, wheel: { device: wheel(['L', 'R', 'G', 'B'], 3) } }), configuration)

		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo', 'focuserMoveTo', 'autofocus', 'wheelMoveTo', 'focuserMoveTo', 'focuserMoveTo'])
		expect(commands.map((command) => command.detail)).toMatchObject([0, 11920, {}, 3, 12580, 12000])
		expect(device.position.value).toBe(12000)
		expect(result).toEqual({ type: 'retryableFailure', reason: 'timeout', detail: 'the focuser did not accept the filter offset: the focuser stalled' })
	})

	test('ends the session when the focus of the frame filter cannot be put back', async () => {
		const commands: Command[] = []
		const device = focuser(12000)
		const services: SequencerAutofocusServices = {
			...focusServices(commands, focused(12500), device),
			focuserCommander: {
				moveTo: (_scope: unknown, _focuser: Focuser, position: number) => {
					commands.push({ name: 'focuserMoveTo', detail: position })

					if (position === 11920) {
						device.position.value = position
						return Promise.resolve(successfulOperationResult(undefined))
					}

					device.position.value = 12580
					return Promise.resolve(failedOperationResult('alert', 'the focuser jammed'))
				},
			} as unknown as SequencerAutofocusServices['focuserCommander'],
		}
		const handler = sequencerAutofocusHandler(services)
		const configuration = autofocusConfiguration({
			capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'L' } },
			filterOffsets: [
				{ filter: { type: 'name', name: 'L' }, offset: 0 },
				{ filter: { type: 'name', name: 'B' }, offset: 80 },
			],
		})
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device }, wheel: { device: wheel(['L', 'R', 'G', 'B'], 3) } }), configuration)

		expect(result).toEqual({ type: 'fatalFailure', reason: 'alert', detail: 'the focuser did not return to the focus of the frame filter: the focuser jammed' })
	})

	test('ends the session when the wheel does not come back from a failed search', async () => {
		const commands: Command[] = []
		let moves = 0
		const services: SequencerAutofocusServices = {
			...focusServices(commands, failedOperationResult('timeout', 'boom')),
			wheelCommander: {
				moveTo: (_scope: unknown, device: Wheel, slot: number) => {
					commands.push({ name: 'wheelMoveTo', detail: slot })
					if (++moves > 1) return Promise.resolve(failedOperationResult('alert', 'the wheel jammed'))
					device.position = slot
					return Promise.resolve(successfulOperationResult(undefined))
				},
			} as unknown as SequencerAutofocusServices['wheelCommander'],
		}
		const handler = sequencerAutofocusHandler(services)
		const device = wheel(['L', 'R', 'G', 'B'], 3)
		const configuration = autofocusConfiguration({ capture: { ...autofocusConfiguration().capture, filter: { type: 'name', name: 'L' } } })
		const result = await handler.execute(actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) }, wheel: { device } }), configuration)

		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo', 'autofocus', 'wheelMoveTo'])
		expect(device.position).toBe(0)
		expect(result).toEqual({ type: 'fatalFailure', reason: 'alert', detail: 'the wheel did not return to the frame filter: the wheel jammed' })
	})

	test('maps a failed search to a retry and a stopped session to a terminal failure', async () => {
		const failing = (reason: 'timeout' | 'aborted') => sequencerAutofocusHandler(focusServices([], failedOperationResult(reason, 'boom')))
		const context = () => actionContext({ camera: { device: camera() }, focuser: { device: focuser(12000) } })

		expect(await failing('timeout').execute(context(), autofocusConfiguration())).toEqual({ type: 'retryableFailure', reason: 'timeout', detail: 'the autofocus search failed: boom' })
		expect(await failing('aborted').execute(context(), autofocusConfiguration())).toEqual({ type: 'fatalFailure', reason: 'aborted', detail: 'the autofocus search failed: boom' })
	})
})
