import { describe, expect, test } from 'bun:test'
import type { Camera, Cover, FlatPanel, Focuser, Mount, Rotator, Wheel } from 'nebulosa/src/devices/indi/device'
import { deg } from 'nebulosa/src/math/units/angle'
import { runFramePreparation, sequencerFrameContext } from 'src/api/sequencer.prepare'
import type { SequencerFramePreparation, SequencerPreparationServices } from 'src/api/sequencer.prepare'
import type { SequencerActionContext } from 'src/api/sequencer.registry'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationFailureReason } from '#/orchestration'
import type { SequencerCooling, SequencerCover, SequencerFlatPanel, SequencerRotator, SequencerTargetTracking } from '#/sequencer'
import type { SequencerPlanFrameGroup } from '#/sequencer.plan'
import { camera as cameraSettings, retry } from './sequencer.fixture'

interface Command {
	readonly name: string
	readonly detail?: unknown
}

interface Failures {
	readonly setTracking?: OperationFailureReason
	readonly setTrackMode?: OperationFailureReason
	readonly park?: OperationFailureReason
	readonly unpark?: OperationFailureReason
	readonly wheelMoveTo?: OperationFailureReason
	readonly focuserMoveTo?: OperationFailureReason
	readonly rotatorMoveTo?: OperationFailureReason
	readonly intensity?: OperationFailureReason
	readonly enable?: OperationFailureReason
	readonly disable?: OperationFailureReason
}

function camera(temperature = -10, hasThermometer = true): Camera {
	return { type: 'camera', name: 'Camera Simulator', id: 'camera-1', connected: true, hasThermometer, temperature } as unknown as Camera
}

function wheel(names: readonly string[], position: number): Wheel {
	return { type: 'wheel', name: 'Wheel Simulator', id: 'wheel-1', connected: true, count: names.length, names, position, moving: false } as unknown as Wheel
}

function focuser(position: number): Focuser {
	return { type: 'focuser', name: 'Focuser Simulator', id: 'focuser-1', connected: true, position: { value: position, min: 0, max: 100000 } } as unknown as Focuser
}

function cover(parked: boolean): Cover {
	return { type: 'cover', name: 'Cover Simulator', id: 'cover-1', connected: true, canPark: true, parked, parking: false } as unknown as Cover
}

function flatPanel(enabled: boolean, intensity = 0): FlatPanel {
	return { type: 'flatPanel', name: 'Flat Panel Simulator', id: 'panel-1', connected: true, enabled, intensity: { value: intensity, min: 0, max: 255 } } as unknown as FlatPanel
}

function rotator(angle: number): Rotator {
	return { type: 'rotator', name: 'Rotator Simulator', id: 'rotator-1', connected: true, moving: false, angle: { value: angle, min: -360, max: 360 } } as unknown as Rotator
}

function mount(tracking: boolean, trackMode: Mount['trackMode'] = 'SIDEREAL'): Mount {
	return { type: 'mount', name: 'Mount Simulator', id: 'mount-1', connected: true, tracking, trackMode } as unknown as Mount
}

function coverPolicy(overrides?: Partial<Omit<SequencerCover, 'enabled'>>): Omit<SequencerCover, 'enabled'> {
	return { closeOnUnsafe: true, openBeforeCapture: true, closeForDarkFrames: true, timeout: 60, retry: retry(), ...overrides }
}

function panelPolicy(overrides?: Partial<Omit<SequencerFlatPanel, 'enabled'>>): Omit<SequencerFlatPanel, 'enabled'> {
	return { brightness: 80, brightnessByFilter: [], timeout: 30, retry: retry(), ...overrides }
}

function rotatorPolicy(overrides?: Partial<Omit<SequencerRotator, 'enabled'>>): Omit<SequencerRotator, 'enabled'> {
	return { angle: deg(30), tolerance: deg(1), settle: 0, moveBeforeCentering: false, restoreAfterMeridianFlip: false, restoreAfterRecovery: false, reverse: false, retry: retry(), ...overrides }
}

function coolingPolicy(overrides?: Partial<Omit<SequencerCooling, 'enabled'>>): Omit<SequencerCooling, 'enabled'> {
	return { temperature: -10, tolerance: 1, ramp: 0, waitForTarget: true, timeout: 60, maintainDuringPause: true, maintainDuringSuspension: true, warmTemperature: 15, warmRamp: 0, warmTimeout: 300, turnCoolerOffAfterWarm: false, ...overrides }
}

function trackingPolicy(overrides?: Partial<Omit<SequencerTargetTracking, 'enabled'>>): Omit<SequencerTargetTracking, 'enabled'> {
	return { mode: 'SIDEREAL', retry: retry(), ...overrides }
}

function group(overrides?: Partial<SequencerPlanFrameGroup>): SequencerPlanFrameGroup {
	return {
		id: 'lum',
		name: 'lum',
		nodeId: 'target:m42/frame:lum',
		frameType: 'LIGHT',
		exposureTime: 60,
		count: 3,
		integrationTime: 0,
		delay: 0,
		weight: 1,
		camera: cameraSettings(),
		retry: retry(),
		requiredSlots: 3,
		abandonmentBudget: 0,
		slotLimit: 3,
		projectedIntegration: 180,
		...overrides,
	}
}

function preparation(overrides?: Partial<SequencerFramePreparation>): SequencerFramePreparation {
	return { group: group(), filterOffsets: [], tracking: trackingPolicy(), ...overrides }
}

function actionContext(devices: Record<string, { readonly device: unknown }>, now: () => number = () => 1_000_000): SequencerActionContext {
	return {
		sessionId: 'session-1',
		nodeId: 'target:m42/frame:lum',
		attempt: 1,
		scope: {} as SequencerActionContext['scope'],
		signal: new AbortController().signal,
		now,
		request: (role) => devices[role] as never,
		progress: () => {},
		artifact: () => {},
		auxiliary: () => undefined,
		checkpoint: { containers: [], attempts: {}, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1_000_000), definitionRevision: 1, handlerVersions: {} },
	}
}

function prepareServices(commands: Command[], failures: Failures = {}): SequencerPreparationServices {
	function answer(name: keyof Failures, detail?: unknown) {
		commands.push({ name, detail })
		const reason = failures[name]
		return Promise.resolve(reason === undefined ? successfulOperationResult(undefined) : failedOperationResult(reason, 'boom'))
	}

	return {
		mountCommander: {
			setTracking: (_scope: unknown, device: Mount, enabled: boolean) => {
				device.tracking = enabled
				return answer('setTracking', enabled)
			},
			setTrackMode: (_scope: unknown, device: Mount, mode: string) => {
				device.trackMode = mode as Mount['trackMode']
				return answer('setTrackMode', mode)
			},
		} as unknown as SequencerPreparationServices['mountCommander'],
		coverCommander: {
			park: (_scope: unknown, device: Cover, options: unknown) => {
				device.parked = true
				return answer('park', options)
			},
			unpark: (_scope: unknown, device: Cover, options: unknown) => {
				device.parked = false
				return answer('unpark', options)
			},
		} as unknown as SequencerPreparationServices['coverCommander'],
		wheelCommander: {
			moveTo: (_scope: unknown, device: Wheel, slot: number) => {
				device.position = slot
				return answer('wheelMoveTo', slot)
			},
		} as unknown as SequencerPreparationServices['wheelCommander'],
		focuserCommander: {
			moveTo: (_scope: unknown, device: Focuser, position: number) => {
				device.position.value = position
				return answer('focuserMoveTo', position)
			},
		} as unknown as SequencerPreparationServices['focuserCommander'],
		rotatorCommander: {
			moveTo: (_scope: unknown, device: Rotator, angle: number) => {
				device.angle.value = angle
				return answer('rotatorMoveTo', angle)
			},
		} as unknown as SequencerPreparationServices['rotatorCommander'],
		flatPanelCommander: {
			enable: (_scope: unknown, device: FlatPanel) => {
				device.enabled = true
				return answer('enable')
			},
			disable: (_scope: unknown, device: FlatPanel) => {
				device.enabled = false
				return answer('disable')
			},
			intensity: (_scope: unknown, device: FlatPanel, value: number) => {
				device.intensity.value = value
				return answer('intensity', value)
			},
		} as unknown as SequencerPreparationServices['flatPanelCommander'],
	}
}

describe('frame context', () => {
	const present = { cover: true, flatPanel: true }

	test('derives the cover, the panel and the tracking from the frame type', () => {
		const light = sequencerFrameContext(preparation({ cover: coverPolicy(), flatPanel: panelPolicy() }), present)
		const dark = sequencerFrameContext(preparation({ group: group({ frameType: 'DARK' }), cover: coverPolicy(), flatPanel: panelPolicy() }), present)
		const bias = sequencerFrameContext(preparation({ group: group({ frameType: 'BIAS' }), cover: coverPolicy(), flatPanel: panelPolicy() }), present)
		const flat = sequencerFrameContext(preparation({ group: group({ frameType: 'FLAT' }), cover: coverPolicy(), flatPanel: panelPolicy() }), present)

		expect(light).toMatchObject({ cover: 'open', panel: { lit: false, brightness: 0 }, tracking: true })
		expect(dark).toMatchObject({ cover: 'closed', panel: { lit: false, brightness: 0 }, tracking: undefined })
		expect(bias).toMatchObject({ cover: 'closed', panel: { lit: false, brightness: 0 }, tracking: undefined })
		expect(flat).toMatchObject({ cover: 'closed', panel: { lit: true, brightness: 80 }, tracking: undefined })
	})

	test('requires nothing of a dimension whose policy is disabled', () => {
		const context = sequencerFrameContext(preparation({ cover: coverPolicy({ openBeforeCapture: false }), flatPanel: panelPolicy() }), present)
		const dark = sequencerFrameContext(preparation({ group: group({ frameType: 'DARK' }), cover: coverPolicy({ closeForDarkFrames: false }) }), present)

		expect(context.cover).toBeUndefined()
		expect(dark.cover).toBeUndefined()
	})

	test('requires nothing of a role the session does not carry', () => {
		const context = sequencerFrameContext(preparation({ cover: coverPolicy(), flatPanel: panelPolicy(), rotator: rotatorPolicy(), cooling: coolingPolicy() }), { cover: false, flatPanel: false })

		expect(context.cover).toBeUndefined()
		expect(context.panel).toBeUndefined()
		expect(context.angle).toBeCloseTo(deg(30), 12)
		expect(context.temperature).toBe(-10)
	})

	test('takes a flat as a sky flat when no panel lights it', () => {
		const context = sequencerFrameContext(preparation({ group: group({ frameType: 'FLAT' }), cover: coverPolicy(), flatPanel: panelPolicy() }), { cover: true, flatPanel: false })

		expect(context.cover).toBe('open')
		expect(context.panel).toBeUndefined()
	})

	test('opens the cover a preceding dark closed before a sky flat', async () => {
		const commands: Command[] = []
		const shutter = cover(true)
		const request = preparation({ group: group({ frameType: 'FLAT' }), cover: coverPolicy(), flatPanel: panelPolicy() })
		const result = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera() }, cover: { device: shutter }, mount: { device: mount(true) } }), request)

		expect(result).toMatchObject({ type: 'completed', value: { commanded: ['cover'] } })
		expect(commands).toEqual([{ name: 'unpark', detail: { timeout: 60000 } }])
		expect(shutter.parked).toBe(false)
	})

	test('leaves the cover alone for a sky flat the policy never opens it for', () => {
		const context = sequencerFrameContext(preparation({ group: group({ frameType: 'FLAT' }), cover: coverPolicy({ openBeforeCapture: false }), flatPanel: panelPolicy() }), { cover: true, flatPanel: false })

		expect(context.cover).toBeUndefined()
	})

	test('lights a panel flat at the brightness declared for its own filter', () => {
		const carousel = wheel(['L', 'Ha'], 0)
		const panel = panelPolicy({ brightnessByFilter: [{ filter: { type: 'name', name: 'Ha' }, brightness: 210 }] })
		const broadband = sequencerFrameContext(preparation({ group: group({ frameType: 'FLAT', filter: { type: 'name', name: 'L' } }), flatPanel: panel }), { wheel: carousel, cover: false, flatPanel: true })
		const narrowband = sequencerFrameContext(preparation({ group: group({ frameType: 'FLAT', filter: { type: 'name', name: 'Ha' } }), flatPanel: panel }), { wheel: carousel, cover: false, flatPanel: true })

		expect(broadband.panel).toEqual({ lit: true, brightness: 80 })
		expect(narrowband.panel).toEqual({ lit: true, brightness: 210 })
	})

	test('requires no temperature when the thermal wait is not asked for', () => {
		expect(sequencerFrameContext(preparation({ cooling: coolingPolicy({ waitForTarget: false }) }), present).temperature).toBeUndefined()
	})
})

describe('frame preparation', () => {
	test('commands nothing when the devices already report the context of the frame', async () => {
		const commands: Command[] = []
		const devices = { camera: { device: camera(-10.4) }, wheel: { device: wheel(['L', 'Ha'], 0) }, cover: { device: cover(false) }, flatPanel: { device: flatPanel(false) }, rotator: { device: rotator(30) }, mount: { device: mount(true) } }
		const request = preparation({ group: group({ filter: { type: 'name', name: 'L' } }), cover: coverPolicy(), flatPanel: panelPolicy(), rotator: rotatorPolicy(), cooling: coolingPolicy() })
		const result = await runFramePreparation(prepareServices(commands), actionContext(devices), request)

		expect(result).toMatchObject({ type: 'completed', value: { commanded: [], slot: 0, focusShift: undefined, temperature: undefined } })
		expect(commands).toBeEmpty()
	})

	test('turns the panel off before the cover travels and lights it only at the end', async () => {
		const commands: Command[] = []
		const panel = flatPanel(true, 80)
		const devices = { camera: { device: camera() }, cover: { device: cover(false) }, flatPanel: { device: panel }, mount: { device: mount(true) } }
		const light = await runFramePreparation(prepareServices(commands), actionContext({ ...devices, cover: { device: cover(true) } }), preparation({ cover: coverPolicy(), flatPanel: panelPolicy() }))

		expect(light).toMatchObject({ type: 'completed', value: { commanded: ['panelOff', 'cover'] } })
		expect(commands.map((command) => command.name)).toEqual(['disable', 'unpark'])

		const flat: Command[] = []
		const closed = flatPanel(false)
		const result = await runFramePreparation(prepareServices(flat), actionContext({ ...devices, flatPanel: { device: closed } }), preparation({ group: group({ frameType: 'FLAT' }), cover: coverPolicy(), flatPanel: panelPolicy() }))

		expect(result).toMatchObject({ type: 'completed', value: { commanded: ['cover', 'panelOn'] } })
		expect(flat.map((command) => command.name)).toEqual(['park', 'intensity', 'enable'])
		expect(flat[1].detail).toBe(80)
	})

	test('resumes tracking for a light frame and leaves it alone for a calibration one', async () => {
		const commands: Command[] = []
		const stopped = mount(false)
		const light = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera() }, mount: { device: stopped } }), preparation())

		expect(light).toMatchObject({ type: 'completed', value: { commanded: ['tracking'] } })
		expect(stopped.tracking).toBeTrue()

		const dark: Command[] = []
		const parked = mount(false)
		const result = await runFramePreparation(prepareServices(dark), actionContext({ camera: { device: camera() }, mount: { device: parked } }), preparation({ group: group({ frameType: 'DARK' }) }))

		expect(result).toMatchObject({ type: 'completed', value: { commanded: [] } })
		expect(parked.tracking).toBeFalse()
	})

	test('selects the declared track mode before the tracking it belongs to', async () => {
		const commands: Command[] = []
		const stopped = mount(false, 'SOLAR')
		const result = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera() }, mount: { device: stopped } }), preparation())

		expect(result).toMatchObject({ type: 'completed', value: { commanded: ['tracking'] } })
		expect(commands.map((command) => command.name)).toEqual(['setTrackMode', 'setTracking'])
		expect(commands[0].detail).toBe('SIDEREAL')
		expect(stopped.trackMode).toBe('SIDEREAL')
		expect(stopped.tracking).toBeTrue()
	})

	test('reports a mount that refuses the declared track mode instead of following the wrong rate', async () => {
		const commands: Command[] = []
		const stopped = mount(false, 'SOLAR')
		const result = await runFramePreparation(prepareServices(commands, { setTrackMode: 'commandFailed' }), actionContext({ camera: { device: camera() }, mount: { device: stopped } }), preparation())

		expect(result).toMatchObject({ type: 'retryableFailure', reason: 'commandFailed' })
		expect(commands.map((command) => command.name)).toEqual(['setTrackMode'])
		expect(stopped.tracking).toBeFalse()
	})

	test('leaves the mount alone for a light frame of a target that declares no tracking', async () => {
		const commands: Command[] = []
		const stopped = mount(false)
		const result = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera() }, mount: { device: stopped } }), preparation({ tracking: undefined }))

		expect(result).toMatchObject({ type: 'completed', value: { commanded: [] } })
		expect(stopped.tracking).toBeFalse()
		expect(sequencerFrameContext(preparation({ tracking: undefined }), { cover: true, flatPanel: true }).tracking).toBeUndefined()
	})

	test('carries the focus across a filter change by the difference of the declared offsets', async () => {
		const commands: Command[] = []
		const carousel = wheel(['L', 'Ha'], 0)
		const optics = focuser(12000)
		const offsets = [
			{ filter: { type: 'name' as const, name: 'L' }, offset: 100 },
			{ filter: { type: 'name' as const, name: 'Ha' }, offset: 350 },
		]
		const request = preparation({ group: group({ filter: { type: 'name', name: 'Ha' } }), filterOffsets: offsets })
		const result = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera() }, wheel: { device: carousel }, focuser: { device: optics }, mount: { device: mount(true) } }), request)

		expect(result).toMatchObject({ type: 'completed', value: { commanded: ['filter', 'focusOffset'], slot: 1, focusShift: 250 } })
		expect(commands).toEqual([
			{ name: 'wheelMoveTo', detail: 1 },
			{ name: 'focuserMoveTo', detail: 12250 },
		])
	})

	test('puts the wheel and the focuser back when the focus offset of the new filter fails', async () => {
		const commands: Command[] = []
		const carousel = wheel(['L', 'Ha'], 0)
		const optics = focuser(12000)
		const offsets = [
			{ filter: { type: 'name' as const, name: 'L' }, offset: 100 },
			{ filter: { type: 'name' as const, name: 'Ha' }, offset: 350 },
		]
		const request = preparation({ group: group({ filter: { type: 'name', name: 'Ha' } }), filterOffsets: offsets })
		const services = prepareServices(commands, { focuserMoveTo: 'timeout' })
		const context = actionContext({ camera: { device: camera() }, wheel: { device: carousel }, focuser: { device: optics }, mount: { device: mount(true) } })
		const result = await runFramePreparation(services, context, request)

		expect(result).toMatchObject({ type: 'retryableFailure', reason: 'timeout' })
		expect(carousel.position).toBe(0)
		expect(optics.position.value).toBe(12000)
		expect(commands).toEqual([
			{ name: 'wheelMoveTo', detail: 1 },
			{ name: 'focuserMoveTo', detail: 12250 },
			{ name: 'wheelMoveTo', detail: 0 },
			{ name: 'focuserMoveTo', detail: 12000 },
		])

		const retried = await runFramePreparation(prepareServices(commands), context, request)

		expect(retried).toMatchObject({ type: 'completed', value: { commanded: ['filter', 'focusOffset'], focusShift: 250 } })
		expect(optics.position.value).toBe(12250)
	})

	test('ends the preparation when the focuser stays between the two filters', async () => {
		const commands: Command[] = []
		const carousel = wheel(['L', 'Ha'], 0)
		const optics = focuser(12000)
		const offsets = [
			{ filter: { type: 'name' as const, name: 'L' }, offset: 100 },
			{ filter: { type: 'name' as const, name: 'Ha' }, offset: 350 },
		]
		const request = preparation({ group: group({ filter: { type: 'name', name: 'Ha' } }), filterOffsets: offsets })
		const services: SequencerPreparationServices = {
			...prepareServices(commands),
			focuserCommander: {
				moveTo: (_scope: unknown, device: Focuser, position: number) => {
					commands.push({ name: 'focuserMoveTo', detail: position })
					device.position.value = 12100
					return Promise.resolve(failedOperationResult('alert', 'the focuser jammed'))
				},
			} as unknown as SequencerPreparationServices['focuserCommander'],
		}
		const result = await runFramePreparation(services, actionContext({ camera: { device: camera() }, wheel: { device: carousel }, focuser: { device: optics }, mount: { device: mount(true) } }), request)

		expect(result).toEqual({ type: 'fatalFailure', reason: 'alert', detail: 'the focuser did not take the offset of the new filter and did not return to the focus of the previous one: the focuser jammed' })
		expect(carousel.position).toBe(0)
		expect(optics.position.value).toBe(12100)
	})

	test('ends the preparation when the wheel does not come back from a failed focus offset', async () => {
		const commands: Command[] = []
		const carousel = wheel(['L', 'Ha'], 0)
		const optics = focuser(12000)
		const offsets = [
			{ filter: { type: 'name' as const, name: 'L' }, offset: 100 },
			{ filter: { type: 'name' as const, name: 'Ha' }, offset: 350 },
		]
		const request = preparation({ group: group({ filter: { type: 'name', name: 'Ha' } }), filterOffsets: offsets })
		let moves = 0
		const services: SequencerPreparationServices = {
			...prepareServices(commands, { focuserMoveTo: 'timeout' }),
			wheelCommander: {
				moveTo: (_scope: unknown, device: Wheel, slot: number) => {
					commands.push({ name: 'wheelMoveTo', detail: slot })
					if (++moves > 1) return Promise.resolve(failedOperationResult('alert', 'boom'))
					device.position = slot
					return Promise.resolve(successfulOperationResult(undefined))
				},
			} as unknown as SequencerPreparationServices['wheelCommander'],
		}
		const result = await runFramePreparation(services, actionContext({ camera: { device: camera() }, wheel: { device: carousel }, focuser: { device: optics }, mount: { device: mount(true) } }), request)

		expect(result).toMatchObject({ type: 'fatalFailure', reason: 'timeout' })
		expect(carousel.position).toBe(1)
		expect(commands).toEqual([
			{ name: 'wheelMoveTo', detail: 1 },
			{ name: 'focuserMoveTo', detail: 12250 },
			{ name: 'wheelMoveTo', detail: 0 },
		])
	})

	test('moves the wheel without touching the focus when the two filters share the same path', async () => {
		const commands: Command[] = []
		const carousel = wheel(['L', 'R'], 0)
		const request = preparation({
			group: group({ filter: { type: 'name', name: 'R' } }),
			filterOffsets: [
				{ filter: { type: 'name', name: 'L' }, offset: 100 },
				{ filter: { type: 'name', name: 'R' }, offset: 100 },
			],
		})
		const result = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera() }, wheel: { device: carousel }, focuser: { device: focuser(12000) }, mount: { device: mount(true) } }), request)

		expect(result).toMatchObject({ type: 'completed', value: { commanded: ['filter'], slot: 1, focusShift: undefined } })
		expect(commands.map((command) => command.name)).toEqual(['wheelMoveTo'])
	})

	test('refuses a frame whose filter the wheel does not carry', async () => {
		const commands: Command[] = []
		const request = preparation({ group: group({ filter: { type: 'name', name: 'SII' } }) })
		const result = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera() }, wheel: { device: wheel(['L', 'Ha'], 0) }, mount: { device: mount(true) } }), request)

		expect(result).toEqual({ type: 'fatalFailure', reason: 'unexpectedState', detail: 'the wheel does not carry the filter the frame requires' })
		expect(commands).toBeEmpty()
	})

	test('rotates only when the field sits outside the declared tolerance', async () => {
		const commands: Command[] = []
		const inside = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera() }, rotator: { device: rotator(30.5) }, mount: { device: mount(true) } }), preparation({ rotator: rotatorPolicy() }))

		expect(inside).toMatchObject({ type: 'completed', value: { commanded: [] } })
		expect(commands).toBeEmpty()

		const outside: Command[] = []
		const field = rotator(45)
		const result = await runFramePreparation(prepareServices(outside), actionContext({ camera: { device: camera() }, rotator: { device: field }, mount: { device: mount(true) } }), preparation({ rotator: rotatorPolicy() }))

		expect(result).toMatchObject({ type: 'completed', value: { commanded: ['rotator'] } })
		expect(outside).toHaveLength(1)
		expect(outside[0].name).toBe('rotatorMoveTo')
		expect(outside[0].detail).toBeCloseTo(30, 9)
		expect(field.angle.value).toBeCloseTo(30, 12)
	})

	test('measures the field angle by the shortest arc across the origin', async () => {
		const commands: Command[] = []
		const inside = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera() }, rotator: { device: rotator(359.5) }, mount: { device: mount(true) } }), preparation({ rotator: rotatorPolicy({ angle: deg(0.5) }) }))

		expect(inside).toMatchObject({ type: 'completed', value: { commanded: [] } })
		expect(commands).toBeEmpty()

		const outside: Command[] = []
		const result = await runFramePreparation(prepareServices(outside), actionContext({ camera: { device: camera() }, rotator: { device: rotator(359.5) }, mount: { device: mount(true) } }), preparation({ rotator: rotatorPolicy({ angle: deg(3) }) }))

		expect(result).toMatchObject({ type: 'completed', value: { commanded: ['rotator'] } })
		expect(outside).toHaveLength(1)
	})

	test('waits for the sensor to enter the tolerance and reports the temperature it reached', async () => {
		const commands: Command[] = []
		const sensor = camera(-4)

		setTimeout(() => (sensor.temperature = -9.6), 5)

		const result = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: sensor }, mount: { device: mount(true) } }), preparation({ cooling: coolingPolicy() }))

		expect(result).toMatchObject({ type: 'completed', value: { commanded: ['cooling'], temperature: -9.6 } })
	})

	test('gives up on a sensor that converges only after a timeout shorter than one sample', async () => {
		const commands: Command[] = []
		const sensor = camera(-4)

		setTimeout(() => (sensor.temperature = -9.6), 700)

		const result = await runFramePreparation(
			prepareServices(commands),
			actionContext({ camera: { device: sensor }, mount: { device: mount(true) } }, () => Date.now()),
			preparation({ cooling: coolingPolicy({ timeout: 0.5 }) }),
		)

		expect(result).toMatchObject({ type: 'retryableFailure', reason: 'timeout' })
		expect(result).toHaveProperty('detail', 'the sensor did not reach the temperature the frame requires: the sensor stayed at -4.0 °C')
	})

	test('gives up on a sensor that does not converge before the declared timeout', async () => {
		const commands: Command[] = []
		const request = preparation({ cooling: coolingPolicy({ timeout: 0 }) })
		const result = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera(-4) }, mount: { device: mount(true) } }), request)

		expect(result).toMatchObject({ type: 'retryableFailure', reason: 'timeout' })
		expect(result).toHaveProperty('detail', 'the sensor did not reach the temperature the frame requires: the sensor stayed at -4.0 °C')
	})

	test('makes no thermal wait on a camera that publishes no temperature', async () => {
		const commands: Command[] = []
		const request = preparation({ cooling: coolingPolicy({ timeout: 0 }) })
		const result = await runFramePreparation(prepareServices(commands), actionContext({ camera: { device: camera(0, false) }, mount: { device: mount(true) } }), request)

		expect(result).toMatchObject({ type: 'completed', value: { commanded: [], temperature: undefined } })
	})

	test('reports a device that refused the reconciliation as a failure of the frame', async () => {
		const commands: Command[] = []
		const devices = { camera: { device: camera() }, cover: { device: cover(true) }, mount: { device: mount(true) } }
		const result = await runFramePreparation(prepareServices(commands, { unpark: 'timeout' }), actionContext(devices), preparation({ cover: coverPolicy() }))

		expect(result).toEqual({ type: 'retryableFailure', reason: 'timeout', detail: 'the cover did not open: boom' })
		expect(commands).toEqual([{ name: 'unpark', detail: { timeout: 60000 } }])
	})

	test('stops at the first refusal instead of commanding the steps that follow it', async () => {
		const commands: Command[] = []
		const devices = { camera: { device: camera() }, wheel: { device: wheel(['L', 'Ha'], 0) }, cover: { device: cover(true) }, rotator: { device: rotator(45) }, mount: { device: mount(true) } }
		const request = preparation({ group: group({ filter: { type: 'name', name: 'Ha' } }), cover: coverPolicy(), rotator: rotatorPolicy() })
		const result = await runFramePreparation(prepareServices(commands, { wheelMoveTo: 'alert' }), actionContext(devices), request)

		expect(result).toMatchObject({ type: 'retryableFailure', reason: 'alert' })
		expect(commands.map((command) => command.name)).toEqual(['unpark', 'wheelMoveTo'])
	})
})
