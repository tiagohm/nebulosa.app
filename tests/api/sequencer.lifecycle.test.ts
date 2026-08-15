import { describe, expect, test } from 'bun:test'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import type { SequencerLifecycle } from 'src/api/sequencer.compiler'
import { sequencerLifecycleHandlers } from 'src/api/sequencer.lifecycle'
import type { SequencerLifecycleServices } from 'src/api/sequencer.lifecycle'
import type { SequencerActionContext, SequencerActionHandler } from 'src/api/sequencer.registry'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'
import { successfulOperationResult } from '#/orchestration'
import type { SequencerCooling, SequencerLifecycleAction, SequencerTargetTracking } from '#/sequencer'
import { retry } from './sequencer.fixture'

function mount(overrides?: Partial<Mount>): Mount {
	return { type: 'mount', name: 'Mount Simulator', id: 'mount-1', connected: true, parked: false, tracking: false, trackMode: 'KING', ...overrides } as unknown as Mount
}

function camera(overrides?: Partial<Camera>): Camera {
	return { type: 'camera', name: 'Camera Simulator', id: 'camera-1', connected: true, hasCooler: true, hasCoolerControl: true, cooler: true, hasThermometer: true, temperature: -10, ...overrides } as unknown as Camera
}

function coolingPolicy(overrides?: Partial<SequencerCooling>): SequencerCooling {
	return { enabled: true, temperature: -10, tolerance: 1, ramp: 0, waitForTarget: true, timeout: 60, warmTemperature: 15, warmRamp: 0, turnCoolerOffAfterWarm: false, ...overrides }
}

function trackingPolicy(): Omit<SequencerTargetTracking, 'enabled'> {
	return { mode: 'SIDEREAL', retry: retry() }
}

function configuration(type: SequencerLifecycleAction['type'], overrides?: Partial<SequencerLifecycle>): SequencerLifecycle {
	const action = { id: type, type, enabled: true, timeout: 30, retry: retry() } as SequencerLifecycleAction

	return { action, required: false, timeout: 0, retry: retry(), ...overrides }
}

function actionContext(devices: Record<string, unknown>, signal: AbortSignal): SequencerActionContext {
	return {
		sessionId: 'session-1',
		nodeId: 'finalize.action[a]',
		attempt: 1,
		scope: {} as SequencerActionContext['scope'],
		signal,
		now: () => 1_000_000,
		request: (role) => (devices[role] === undefined ? undefined : ({ device: devices[role] } as never)),
		progress: () => {},
		artifact: () => {},
		auxiliary: () => undefined,
		checkpoint: { containers: [], attempts: {}, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1_000_000), definitionRevision: 1, handlerVersions: {} },
	}
}

function lifecycleServices(commands: string[], onCommand?: (name: string) => void): SequencerLifecycleServices {
	function answer(name: string) {
		commands.push(name)
		onCommand?.(name)
		return Promise.resolve(successfulOperationResult(undefined))
	}

	return {
		mountCommander: {
			park: () => answer('park'),
			unpark: () => answer('unpark'),
			setTracking: (_scope: unknown, _device: Mount, enabled: boolean) => answer(`setTracking:${enabled}`),
			setTrackMode: (_scope: unknown, _device: Mount, mode: string) => answer(`setTrackMode:${mode}`),
		},
		coverCommander: {
			park: () => answer('closeCover'),
			unpark: () => answer('openCover'),
		},
		cameraCommander: {
			cooler: (_scope: unknown, _device: Camera, enabled: boolean) => answer(`cooler:${enabled}`),
			temperature: (_scope: unknown, _device: Camera, value: number) => answer(`temperature:${value}`),
		},
		guiderCommander: {},
	} as unknown as SequencerLifecycleServices
}

function handlerOf(services: SequencerLifecycleServices, type: SequencerLifecycleAction['type']): SequencerActionHandler<SequencerLifecycle, unknown> {
	return sequencerLifecycleHandlers(services).find((handler) => handler.type === `lifecycle.${type}`) as SequencerActionHandler<SequencerLifecycle, unknown>
}

describe('cancellation', () => {
	test('an action entered under a cancellation commands nothing', async () => {
		const commands: string[] = []
		const services = lifecycleServices(commands)
		const controller = new AbortController()

		controller.abort()

		const result = await handlerOf(services, 'unparkMount').execute(actionContext({ mount: mount({ parked: true }) }, controller.signal), configuration('unparkMount'))

		expect(commands).toBeEmpty()
		expect(result).toMatchObject({ type: 'fatalFailure', reason: 'aborted' })
	})

	test('the cover is not opened by an action cancelled before it started', async () => {
		const commands: string[] = []
		const services = lifecycleServices(commands)
		const controller = new AbortController()

		controller.abort()

		const cover = { type: 'cover', name: 'Cover Simulator', id: 'cover-1', connected: true, parked: true }
		const result = await handlerOf(services, 'openCover').execute(actionContext({ cover }, controller.signal), configuration('openCover'))

		expect(commands).toBeEmpty()
		expect(result).toMatchObject({ type: 'fatalFailure', reason: 'aborted' })
	})

	test('a cancellation between two commands of the same action stops before the second', async () => {
		const commands: string[] = []
		const controller = new AbortController()
		const services = lifecycleServices(commands, (name) => {
			if (name.startsWith('setTrackMode')) controller.abort()
		})

		const result = await handlerOf(services, 'startTracking').execute(actionContext({ mount: mount() }, controller.signal), configuration('startTracking', { tracking: trackingPolicy() }))

		expect(commands).toEqual(['setTrackMode:SIDEREAL'])
		expect(result).toMatchObject({ type: 'fatalFailure', reason: 'aborted' })
	})

	test('a cancellation during the warm ramp leaves the cooler on', async () => {
		const commands: string[] = []
		const controller = new AbortController()
		const services = lifecycleServices(commands, (name) => {
			if (name.startsWith('temperature')) controller.abort()
		})
		const cooling = coolingPolicy({ turnCoolerOffAfterWarm: true })

		const result = await handlerOf(services, 'warmCamera').execute(actionContext({ camera: camera() }, controller.signal), configuration('warmCamera', { cooling }))

		expect(commands).toEqual(['temperature:15'])
		expect(result).toMatchObject({ type: 'fatalFailure', reason: 'aborted' })
	})

	test('an action that is not cancelled commands every step it declares', async () => {
		const commands: string[] = []
		const services = lifecycleServices(commands)

		const result = await handlerOf(services, 'startTracking').execute(actionContext({ mount: mount() }, new AbortController().signal), configuration('startTracking', { tracking: trackingPolicy() }))

		expect(commands).toEqual(['setTrackMode:SIDEREAL', 'setTracking:true'])
		expect(result).toMatchObject({ type: 'completed', value: { action: 'startTracking', commanded: true } })
	})
})
