import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { PHD2Command } from 'nebulosa/src/devices/guiding/phd2'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera, GuideOutput } from 'nebulosa/src/devices/indi/device'
import { CameraManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { guiderBus, GUIDER_RESOURCE, GuiderCommander } from 'src/api/guider.session'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import { DEFAULT_GUIDER_DITHER } from '#/guider'
import type { GuiderConnect, GuiderEvent } from '#/guider'
import { waitUntil } from './util'

guiderBus.forceSync = true

const cameraManager = new CameraManager()
const mountManager = new MountManager()
const wheelManager = new WheelManager()
const focuserManager = new FocuserManager()
const rotatorManager = new RotatorManager()
const guideOutputManager = new GuideOutputManager({ get: (client, name) => cameraManager.get(client, name) ?? mountManager.get(client, name) })

const handler = new IndiClientHandlerSet([cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, guideOutputManager])
const client = new ClientSimulator('Client Simulator', handler)

const simulators = [new CameraSimulator('Camera Simulator', client, { mountManager, focuserManager, rotatorManager, wheelManager }), new MountSimulator('Mount Simulator', client)] as const

class FakePhd2Server {
	readonly commands: PHD2Command[] = []

	private listener?: Bun.TCPSocketListener
	private socket?: Bun.Socket<unknown>
	private buffer = ''

	async start() {
		this.listener = Bun.listen({
			hostname: '127.0.0.1',
			port: 0,
			socket: {
				open: (socket) => {
					this.socket = socket
				},
				data: (socket, data) => {
					this.buffer += data.toString('utf-8')

					for (;;) {
						const index = this.buffer.indexOf('\n')
						if (index < 0) break
						const line = this.buffer.slice(0, index).trim()
						this.buffer = this.buffer.slice(index + 1)
						if (line.length === 0) continue
						const command = JSON.parse(line) as PHD2Command
						this.commands.push(command)
						socket.write(`${JSON.stringify({ jsonrpc: '2.0', result: 0, id: command.id })}\r\n`)
					}
				},
				close: () => {
					this.socket = undefined
				},
			},
		})

		await waitUntil(() => this.listener !== undefined)

		return this.listener.port
	}

	push(event: Record<string, unknown> & { readonly Event: string }) {
		this.socket?.write(`${JSON.stringify({ Timestamp: Date.now() / 1000, Host: 'fake', Inst: 1, ...event })}\r\n`)
	}

	drop() {
		this.socket?.end()
	}

	received(method: string) {
		return this.commands.some((command) => command.method === method)
	}

	stop() {
		this.socket?.end()
		this.listener?.stop(true)
		this.listener = undefined
	}
}

let arbiter: ResourceArbiter
let coordinator: OperationCoordinator
let commander: GuiderCommander
let server: FakePhd2Server
let port = 0

beforeEach(async () => {
	arbiter = new ResourceArbiter()
	coordinator = new OperationCoordinator(arbiter)
	commander = new GuiderCommander(coordinator, cameraManager, guideOutputManager, { commandTimeout: 1000, guidingTimeout: 1000, releaseTimeout: 1000 })
	server = new FakePhd2Server()
	port = await server.start()
})

afterEach(async () => {
	await commander.disconnect()
	server.stop()
})

afterAll(() => {
	for (const simulator of simulators) simulator.dispose()
})

function remote(): GuiderConnect {
	return { mode: 'remote', host: '127.0.0.1', port, dither: structuredClone(DEFAULT_GUIDER_DITHER) }
}

async function connected() {
	const result = await commander.connect(remote())
	expect(result.ok).toBeTrue()
	return result
}

describe('remote session', () => {
	test('holds the logical resource while connected and refuses a second session', async () => {
		await connected()

		expect(commander.connected).toBeTrue()
		expect(arbiter.availability(GUIDER_RESOURCE.key)).toBe('leased')

		const second = await commander.connect(remote())

		expect(second.ok).toBeFalse()
		expect(second.ok || second.reason).toBe('busy')
	})

	test('fails to connect when no server accepts the connection', async () => {
		server.stop()

		const result = await commander.connect(remote())

		expect(result.ok).toBeFalse()
		expect(commander.connected).toBeFalse()
		expect(arbiter.availability(GUIDER_RESOURCE.key)).toBe('available')
	})

	test('releases the logical resource on disconnect', async () => {
		await connected()

		const result = await commander.disconnect()

		expect(result.ok).toBeTrue()
		expect(commander.connected).toBeFalse()
		expect(arbiter.availability(GUIDER_RESOURCE.key)).toBe('available')
		expect(server.received('stop_capture')).toBeFalse()
	})

	test('loops after the guider reports looping exposures', async () => {
		await connected()

		const looped = commander.loop()

		expect(await waitUntil(() => server.received('loop'))).toBeTrue()
		server.push({ Event: 'LoopingExposures', Frame: 1, StarMass: 100, SNR: 20, HFD: 3 })

		expect((await looped).ok).toBeTrue()
		expect(commander.looping).toBeTrue()
	})

	test('refuses a concurrent command instead of sharing the waiter of the running one', async () => {
		await connected()

		const looped = commander.loop()
		const guided = await commander.startGuiding()

		expect(guided.ok).toBeFalse()
		expect(guided.ok || guided.reason).toBe('busy')

		server.push({ Event: 'LoopingExposures', Frame: 1, StarMass: 100, SNR: 20, HFD: 3 })

		expect((await looped).ok).toBeTrue()
	})

	test('starts guiding once the guider reports it is guiding', async () => {
		await connected()

		const guided = commander.startGuiding()

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartGuiding' })

		expect((await guided).ok).toBeTrue()
		expect(commander.running).toBeTrue()
	})

	test('fails to start guiding when the star is lost before guiding begins', async () => {
		await connected()

		const guided = commander.startGuiding()

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StarLost', Frame: 1, Time: 1, StarMass: 0, SNR: 0, HFD: 0, AvgDist: 0, Status: 1 })

		const result = await guided

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('unexpectedState')
	})

	test('calibrates only when the run passed through calibrating', async () => {
		await connected()

		const calibrated = commander.calibrate()

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartCalibration', Mount: 'Mount Simulator' })
		server.push({ Event: 'StartGuiding' })

		expect((await calibrated).ok).toBeTrue()
	})

	test('fails calibration when the guider reports it failed', async () => {
		await connected()

		const calibrated = commander.calibrate()

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartCalibration', Mount: 'Mount Simulator' })
		server.push({ Event: 'CalibrationFailed', Reason: 'not enough movement' })

		const result = await calibrated

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('alert')
		expect(await waitUntil(() => server.received('stop_capture'))).toBeTrue()
	})

	test('stops after the guider reports it stopped', async () => {
		await connected()

		const guided = commander.startGuiding()
		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartGuiding' })
		expect((await guided).ok).toBeTrue()

		const stopped = commander.stopGuiding()
		expect(await waitUntil(() => server.received('stop_capture'))).toBeTrue()
		server.push({ Event: 'GuidingStopped' })

		expect((await stopped).ok).toBeTrue()
		expect(commander.running).toBeFalse()
	})

	test('finds a star and reports acceptance', async () => {
		await connected()

		const result = await commander.findStar()

		expect(result.ok).toBeTrue()
		expect(result.ok && result.value.accepted).toBeTrue()
	})
})

describe('dither', () => {
	async function guiding() {
		await connected()

		const guided = commander.startGuiding()
		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartGuiding' })
		expect((await guided).ok).toBeTrue()
	}

	test('refuses to dither when the guider is not guiding', async () => {
		await connected()

		const result = await commander.dither()

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('unexpectedState')
	})

	test('settles after the guider reports a successful settle', async () => {
		await guiding()

		const phases: string[] = []
		const unsubscribe = guiderBus.subscribe('dither', (event) => phases.push(event.phase))

		try {
			const dithered = commander.dither({ amount: 3 })

			expect(await waitUntil(() => server.received('dither'))).toBeTrue()
			server.push({ Event: 'SettleBegin' })
			server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })

			expect((await dithered).ok).toBeTrue()
			expect(phases).toContain('dithering')
			expect(phases).toContain('settled')
		} finally {
			unsubscribe()
		}
	})

	test('fails when the guider reports a failed settle', async () => {
		await guiding()

		const dithered = commander.dither()

		expect(await waitUntil(() => server.received('dither'))).toBeTrue()
		server.push({ Event: 'SettleBegin' })
		server.push({ Event: 'SettleDone', Status: 1, TotalFrames: 5, DroppedFrames: 5, Error: 'settle failed' })

		const result = await dithered

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('alert')
		expect(result.ok || result.error).toBe('settle failed')
	})

	test('settles when the terminal event arrives before the command reply', async () => {
		await guiding()

		const settled = Promise.withResolvers<void>()
		const unsubscribe = guiderBus.subscribe('dither', (event) => {
			if (event.phase === 'dithering') {
				server.push({ Event: 'SettleBegin' })
				server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })
				settled.resolve()
			}
		})

		try {
			const dithered = commander.dither()
			await settled.promise
			expect((await dithered).ok).toBeTrue()
		} finally {
			unsubscribe()
		}
	})

	test('aborts when the caller that asked for it is canceled', async () => {
		await guiding()

		const controller = new AbortController()
		const dithered = commander.dither(undefined, { signal: controller.signal })

		expect(await waitUntil(() => server.received('dither'))).toBeTrue()
		controller.abort('aborted')

		const result = await dithered

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('aborted')
		expect(commander.connected).toBeTrue()
	})
})

describe('connection loss', () => {
	test('ends every command and the session when the transport drops', async () => {
		await connected()

		const guided = commander.startGuiding()

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.drop()

		const result = await guided

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('disconnected')
		expect(await waitUntil(() => !commander.connected)).toBeTrue()
		expect(arbiter.availability(GUIDER_RESOURCE.key)).toBe('available')
	})

	test('ignores events published by a previous connection', async () => {
		await connected()

		const stale = server
		stale.push({ Event: 'StartGuiding' })
		expect(await waitUntil(() => commander.running)).toBeTrue()

		await commander.disconnect()

		const events: GuiderEvent[] = []
		const unsubscribe = guiderBus.subscribe('update', (event) => events.push(event))

		try {
			stale.push({ Event: 'GuideStep', Frame: 1, Time: 1, RADistanceRaw: 1, DECDistanceRaw: 1, RADuration: 1, RADirection: 'West', DECDuration: 1, DECDirection: 'North', StarMass: 1, SNR: 1, HFD: 1 })
			await Bun.sleep(50)

			expect(events).toBeEmpty()
			expect(commander.running).toBeFalse()
		} finally {
			unsubscribe()
		}
	})
})

describe('local session', () => {
	function local(camera: Camera, guideOutput: GuideOutput): GuiderConnect {
		return {
			mode: 'local',
			focalLength: 500,
			camera: camera.id,
			guideOutput: guideOutput.id,
			capture: { ...structuredClone(DEFAULT_CAMERA_CAPTURE_START), exposureTime: 10, exposureTimeUnit: 'millisecond' },
			dither: structuredClone(DEFAULT_GUIDER_DITHER),
		}
	}

	async function devices() {
		const camera = cameraManager.get(client, 'Camera Simulator')!
		const mount = mountManager.get(client, 'Mount Simulator')!
		expect(camera).toBeDefined()
		expect(mount).toBeDefined()
		cameraManager.connect(camera)
		mountManager.connect(mount)

		expect(await waitUntil(() => camera.connected && mount.connected && guideOutputManager.get(client, 'Mount Simulator') !== undefined)).toBeTrue()

		const guideOutput = guideOutputManager.get(client, 'Mount Simulator')!
		expect(await waitUntil(() => guideOutput.connected)).toBeTrue()
		return [camera, guideOutput] as const
	}

	afterEach(() => {
		const camera = cameraManager.get(client, 'Camera Simulator')
		const mount = mountManager.get(client, 'Mount Simulator')
		if (camera) cameraManager.disconnect(camera)
		if (mount) mountManager.disconnect(mount)
	})

	test('leaves the guide camera and guide output acquirable while the session is idle', async () => {
		const [camera, guideOutput] = await devices()

		const result = await commander.connect(local(camera, guideOutput))

		expect(result).toEqual({ ok: true, value: undefined })
		expect(arbiter.availability(GUIDER_RESOURCE.key)).toBe('leased')
		expect(arbiter.availability(resourceKey(camera))).toBe('available')
		expect(arbiter.availability(resourceKey(guideOutput))).toBe('available')
	})

	test('holds both devices while capturing and hands them back once the guider stops', async () => {
		const [camera, guideOutput] = await devices()

		expect((await commander.connect(local(camera, guideOutput))).ok).toBeTrue()

		const looped = commander.loop({ timeout: 15000 })

		expect(await waitUntil(() => arbiter.availability(resourceKey(camera)) === 'leased')).toBeTrue()
		expect(arbiter.availability(resourceKey(guideOutput))).toBe('leased')
		expect((await looped).ok).toBeTrue()

		const stopped = await commander.stopGuiding()

		expect(stopped.ok).toBeTrue()
		expect(arbiter.availability(resourceKey(camera))).toBe('available')
		expect(arbiter.availability(resourceKey(guideOutput))).toBe('available')
		expect(arbiter.availability(GUIDER_RESOURCE.key)).toBe('leased')
	}, 20000)

	test('refuses to acquire the guide camera while another operation owns it', async () => {
		const [camera, guideOutput] = await devices()

		expect((await commander.connect(local(camera, guideOutput))).ok).toBeTrue()

		const held = Promise.withResolvers<void>()
		const owner = coordinator.start<void>('test', [{ key: resourceKey(camera), device: camera }], async () => {
			await held.promise
			return { ok: true, value: undefined }
		})

		const looped = await commander.loop()

		expect(looped.ok).toBeFalse()
		expect(looped.ok || looped.reason).toBe('busy')

		held.resolve()
		await owner.result
	})
})
