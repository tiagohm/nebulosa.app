import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { PHD2Command } from 'nebulosa/src/devices/guiding/phd2'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera, GuideOutput } from 'nebulosa/src/devices/indi/device'
import { CameraManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { guiderBus, GuiderCommander, localGuiderKey, remoteGuiderKey } from 'src/api/guider.session'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import { DEFAULT_GUIDER_DITHER } from '#/guider'
import type { GuiderConnect, GuiderDitherPhase, GuiderEvent, GuiderSessionInfo } from '#/guider'
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
let servers: FakePhd2Server[] = []
let server: FakePhd2Server
let port = 0

async function startServer() {
	const created = new FakePhd2Server()
	const createdPort = await created.start()
	servers.push(created)
	return [created, createdPort] as const
}

beforeEach(async () => {
	arbiter = new ResourceArbiter()
	coordinator = new OperationCoordinator(arbiter)
	commander = new GuiderCommander(coordinator, cameraManager, guideOutputManager, { commandTimeout: 1000, guidingTimeout: 1000, releaseTimeout: 1000 })
	servers = []
	;[server, port] = await startServer()
})

afterEach(async () => {
	await coordinator.cancelAll('aborted')
	for (const created of servers) created.stop()
})

afterAll(() => {
	for (const simulator of simulators) simulator.dispose()
})

function remote(remotePort = port): GuiderConnect {
	return { mode: 'remote', host: '127.0.0.1', port: remotePort, dither: structuredClone(DEFAULT_GUIDER_DITHER) }
}

async function connected(remotePort = port) {
	const result = await commander.connect(remote(remotePort))
	expect(result.ok).toBeTrue()
	if (!result.ok) throw new Error(result.error)
	return result.value.id
}

describe('remote session', () => {
	test('holds a logical resource named after the server it occupies', async () => {
		const id = await connected()

		expect(commander.list()).toHaveLength(1)
		expect(commander.info(id)?.mode).toBe('remote')
		expect(commander.info(id)?.key).toBe(remoteGuiderKey('127.0.0.1', port))
		expect(arbiter.availability(remoteGuiderKey('127.0.0.1', port))).toBe('leased')
	})

	test('refuses a second session on the same server', async () => {
		await connected()

		const second = await commander.connect(remote())

		expect(second.ok).toBeFalse()
		expect(second.ok || second.reason).toBe('busy')
		expect(commander.list()).toHaveLength(1)
	})

	test('keeps two sessions on different servers apart', async () => {
		const [other, otherPort] = await startServer()
		const first = await connected()
		const second = await connected(otherPort)

		expect(first).not.toBe(second)
		expect(commander.list()).toHaveLength(2)

		const events: GuiderEvent[] = []
		const unsubscribe = guiderBus.subscribe('update', (event) => events.push(structuredClone(event)))

		try {
			server.push({ Event: 'StartGuiding' })

			expect(await waitUntil(() => commander.running(first))).toBeTrue()
			expect(commander.running(second)).toBeFalse()
			expect(events.every((event) => event.id === first)).toBeTrue()

			other.push({ Event: 'LoopingExposures', Frame: 1, StarMass: 1, SNR: 1, HFD: 1 })

			expect(await waitUntil(() => commander.looping(second))).toBeTrue()
			expect(commander.running(first)).toBeTrue()
			expect(events.some((event) => event.id === second)).toBeTrue()
		} finally {
			unsubscribe()
		}
	})

	test('ends one session without disturbing the other', async () => {
		const [, otherPort] = await startServer()
		const first = await connected()
		const second = await connected(otherPort)

		expect((await commander.disconnect(first)).ok).toBeTrue()

		expect(commander.list()).toHaveLength(1)
		expect(commander.info(first)).toBeUndefined()
		expect(commander.info(second)).toBeDefined()
		expect(arbiter.availability(remoteGuiderKey('127.0.0.1', port))).toBe('available')
		expect(arbiter.availability(remoteGuiderKey('127.0.0.1', otherPort))).toBe('leased')
	})

	test('publishes add and remove for every session', async () => {
		const added: GuiderSessionInfo[] = []
		const removed: GuiderSessionInfo[] = []
		const unsubscribeAdd = guiderBus.subscribe('add', (event) => added.push(event))
		const unsubscribeRemove = guiderBus.subscribe('remove', (event) => removed.push(event))

		try {
			const id = await connected()

			expect(added.map((event) => event.id)).toEqual([id])
			expect(removed).toBeEmpty()

			await commander.disconnect(id)

			expect(removed.map((event) => event.id)).toEqual([id])
		} finally {
			unsubscribeAdd()
			unsubscribeRemove()
		}
	})

	test('closes every session on shutdown', async () => {
		const [, otherPort] = await startServer()

		await connected()
		await connected(otherPort)

		await coordinator.cancelAll('aborted')

		expect(commander.list()).toBeEmpty()
		expect(arbiter.availability(remoteGuiderKey('127.0.0.1', port))).toBe('available')
		expect(arbiter.availability(remoteGuiderKey('127.0.0.1', otherPort))).toBe('available')
	})

	test('fails to connect when no server accepts the connection', async () => {
		server.stop()

		const result = await commander.connect(remote())

		expect(result.ok).toBeFalse()
		expect(commander.list()).toBeEmpty()
		expect(arbiter.availability(remoteGuiderKey('127.0.0.1', port))).toBe('available')
	})

	test('releases the logical resource on disconnect', async () => {
		const id = await connected()

		const result = await commander.disconnect(id)

		expect(result.ok).toBeTrue()
		expect(commander.list()).toBeEmpty()
		expect(arbiter.availability(remoteGuiderKey('127.0.0.1', port))).toBe('available')
		expect(server.received('stop_capture')).toBeFalse()
	})

	test('reports an unknown session instead of guessing which one was meant', async () => {
		await connected()

		const result = await commander.loop('nope')

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('disconnected')
	})

	test('loops after the guider reports looping exposures', async () => {
		const id = await connected()

		const looped = commander.loop(id)

		expect(await waitUntil(() => server.received('loop'))).toBeTrue()
		server.push({ Event: 'LoopingExposures', Frame: 1, StarMass: 100, SNR: 20, HFD: 3 })

		expect((await looped).ok).toBeTrue()
		expect(commander.looping(id)).toBeTrue()
	})

	test('refuses a concurrent command instead of sharing the waiter of the running one', async () => {
		const id = await connected()

		const looped = commander.loop(id)
		const guided = await commander.startGuiding(id)

		expect(guided.ok).toBeFalse()
		expect(guided.ok || guided.reason).toBe('busy')

		server.push({ Event: 'LoopingExposures', Frame: 1, StarMass: 100, SNR: 20, HFD: 3 })

		expect((await looped).ok).toBeTrue()
	})

	test('starts guiding once the guider reports it is guiding', async () => {
		const id = await connected()

		const guided = commander.startGuiding(id)

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartGuiding' })

		expect((await guided).ok).toBeTrue()
		expect(commander.running(id)).toBeTrue()
	})

	test('fails to start guiding when the star is lost before guiding begins', async () => {
		const id = await connected()

		const guided = commander.startGuiding(id)

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StarLost', Frame: 1, Time: 1, StarMass: 0, SNR: 0, HFD: 0, AvgDist: 0, Status: 1 })

		const result = await guided

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('unexpectedState')
	})

	test('calibrates only when the run passed through calibrating', async () => {
		const id = await connected()

		const calibrated = commander.calibrate(id)

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartCalibration', Mount: 'Mount Simulator' })
		server.push({ Event: 'StartGuiding' })

		expect((await calibrated).ok).toBeTrue()
	})

	test('fails calibration when the guider reports it failed', async () => {
		const id = await connected()

		const calibrated = commander.calibrate(id)

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartCalibration', Mount: 'Mount Simulator' })
		server.push({ Event: 'CalibrationFailed', Reason: 'not enough movement' })

		const result = await calibrated

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('alert')
		expect(await waitUntil(() => server.received('stop_capture'))).toBeTrue()
	})

	test('stops after the guider reports it stopped', async () => {
		const id = await connected()

		const guided = commander.startGuiding(id)
		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartGuiding' })
		expect((await guided).ok).toBeTrue()

		const stopped = commander.stopGuiding(id)
		expect(await waitUntil(() => server.received('stop_capture'))).toBeTrue()
		server.push({ Event: 'GuidingStopped' })

		expect((await stopped).ok).toBeTrue()
		expect(commander.running(id)).toBeFalse()
	})

	test('finds a star and reports acceptance', async () => {
		const id = await connected()

		const result = await commander.findStar(id)

		expect(result.ok).toBeTrue()
		expect(result.ok && result.value.accepted).toBeTrue()
	})
})

describe('dither', () => {
	async function guiding() {
		const id = await connected()

		const guided = commander.startGuiding(id)
		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartGuiding' })
		expect((await guided).ok).toBeTrue()

		return id
	}

	test('refuses to dither on an unknown session', async () => {
		await guiding()

		const result = await commander.dither('nope')

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('disconnected')
	})

	test('refuses to dither when the guider is not guiding', async () => {
		const id = await connected()

		const result = await commander.dither(id)

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('unexpectedState')
	})

	test('settles after the guider reports a successful settle', async () => {
		const id = await guiding()

		const phases: string[] = []
		const unsubscribe = guiderBus.subscribe('dither', (event) => phases.push(event.phase))

		try {
			const dithered = commander.dither(id, { amount: 3 })

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

	test('reports the phases of a dither to the caller that asked for it, and no others', async () => {
		const id = await guiding()

		const phases: GuiderDitherPhase[] = []
		const dithered = commander.dither(id, undefined, { onPhase: (phase) => phases.push(phase) })

		expect(await waitUntil(() => server.received('dither'))).toBeTrue()
		server.push({ Event: 'SettleBegin' })
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })

		expect((await dithered).ok).toBeTrue()
		expect(phases).toEqual(['dithering', 'settling', 'settled'])

		// The session keeps settling after other commands, and the caller of a finished dither must not
		// keep receiving those phases.
		server.push({ Event: 'SettleBegin' })
		server.push({ Event: 'Settling', Distance: 1, Time: 1, SettleTime: 10, StarLocked: true })
		await Bun.sleep(50)

		expect(phases).toEqual(['dithering', 'settling', 'settled'])
	})

	test('fails when the guider reports a failed settle', async () => {
		const id = await guiding()

		const dithered = commander.dither(id)

		expect(await waitUntil(() => server.received('dither'))).toBeTrue()
		server.push({ Event: 'SettleBegin' })
		server.push({ Event: 'SettleDone', Status: 1, TotalFrames: 5, DroppedFrames: 5, Error: 'settle failed' })

		const result = await dithered

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('alert')
		expect(result.ok || result.error).toBe('settle failed')
	})

	test('settles when the terminal event arrives before the command reply', async () => {
		const id = await guiding()

		const settled = Promise.withResolvers<void>()
		const unsubscribe = guiderBus.subscribe('dither', (event) => {
			if (event.phase === 'dithering') {
				server.push({ Event: 'SettleBegin' })
				server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })
				settled.resolve()
			}
		})

		try {
			const dithered = commander.dither(id)
			await settled.promise
			expect((await dithered).ok).toBeTrue()
		} finally {
			unsubscribe()
		}
	})

	test('aborts when the caller that asked for it is canceled', async () => {
		const id = await guiding()

		const controller = new AbortController()
		const dithered = commander.dither(id, undefined, { signal: controller.signal })

		expect(await waitUntil(() => server.received('dither'))).toBeTrue()
		controller.abort('aborted')

		const result = await dithered

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('aborted')
		expect(commander.info(id)).toBeDefined()
	})

	test('survives the disconnect of another session', async () => {
		const [, otherPort] = await startServer()
		const guided = await guiding()
		const other = await connected(otherPort)

		const dithered = commander.dither(guided)

		expect(await waitUntil(() => server.received('dither'))).toBeTrue()
		expect((await commander.disconnect(other)).ok).toBeTrue()

		server.push({ Event: 'SettleBegin' })
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })

		expect((await dithered).ok).toBeTrue()
	})
})

describe('connection loss', () => {
	test('ends every command and the session when the transport drops', async () => {
		const id = await connected()

		const guided = commander.startGuiding(id)

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.drop()

		const result = await guided

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('disconnected')
		expect(await waitUntil(() => commander.info(id) === undefined)).toBeTrue()
		expect(arbiter.availability(remoteGuiderKey('127.0.0.1', port))).toBe('available')
	})

	test('ignores events published by a previous connection', async () => {
		const id = await connected()

		server.push({ Event: 'StartGuiding' })
		expect(await waitUntil(() => commander.running(id))).toBeTrue()

		await commander.disconnect(id)

		const events: GuiderEvent[] = []
		const unsubscribe = guiderBus.subscribe('update', (event) => events.push(event))

		try {
			server.push({ Event: 'GuideStep', Frame: 1, Time: 1, RADistanceRaw: 1, DECDistanceRaw: 1, RADuration: 1, RADirection: 'West', DECDuration: 1, DECDirection: 'North', StarMass: 1, SNR: 1, HFD: 1 })
			await Bun.sleep(50)

			expect(events).toBeEmpty()
			expect(commander.running(id)).toBeFalse()
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

		expect(result.ok).toBeTrue()
		expect(result.ok && result.value.mode).toBe('local')
		expect(arbiter.availability(localGuiderKey(camera, guideOutput))).toBe('leased')
		expect(arbiter.availability(resourceKey(camera))).toBe('available')
		expect(arbiter.availability(resourceKey(guideOutput))).toBe('available')
	})

	test('refuses a second session over the same devices even while the first is idle', async () => {
		const [camera, guideOutput] = await devices()

		expect((await commander.connect(local(camera, guideOutput))).ok).toBeTrue()

		const second = await commander.connect(local(camera, guideOutput))

		expect(second.ok).toBeFalse()
		expect(second.ok || second.reason).toBe('busy')
		expect(commander.list()).toHaveLength(1)
	})

	test('holds both devices while capturing and hands them back once the guider stops', async () => {
		const [camera, guideOutput] = await devices()
		const connect = await commander.connect(local(camera, guideOutput))

		expect(connect.ok).toBeTrue()
		if (!connect.ok) throw new Error(connect.error)

		const id = connect.value.id
		const looped = commander.loop(id, { timeout: 15000 })

		expect(await waitUntil(() => arbiter.availability(resourceKey(camera)) === 'leased')).toBeTrue()
		expect(arbiter.availability(resourceKey(guideOutput))).toBe('leased')
		expect((await looped).ok).toBeTrue()

		const stopped = await commander.stopGuiding(id)

		expect(stopped.ok).toBeTrue()
		expect(arbiter.availability(resourceKey(camera))).toBe('available')
		expect(arbiter.availability(resourceKey(guideOutput))).toBe('available')
		expect(arbiter.availability(localGuiderKey(camera, guideOutput))).toBe('leased')
	}, 20000)

	test('refuses to acquire the guide camera while another operation owns it', async () => {
		const [camera, guideOutput] = await devices()
		const connect = await commander.connect(local(camera, guideOutput))

		expect(connect.ok).toBeTrue()
		if (!connect.ok) throw new Error(connect.error)

		const held = Promise.withResolvers<void>()
		const owner = coordinator.start<void>('test', [{ key: resourceKey(camera), device: camera }], async () => {
			await held.promise
			return { ok: true, value: undefined }
		})

		const looped = await commander.loop(connect.value.id)

		expect(looped.ok).toBeFalse()
		expect(looped.ok || looped.reason).toBe('busy')

		held.resolve()
		await owner.result
	})
})
