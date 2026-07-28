import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { PHD2Client } from 'nebulosa/src/devices/guiding/phd2'
import type { PHD2Command } from 'nebulosa/src/devices/guiding/phd2'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera, GuideOutput } from 'nebulosa/src/devices/indi/device'
import { CameraManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { GuiderClient } from 'nebulosa/src/observation/guiding/client'
import { guiderBus, GuiderCommander, localGuiderCameraKey, localGuiderKey, localGuiderOutputKey, remoteGuiderKey } from 'src/api/guider.session'
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
	readonly unanswered = new Set<string>()
	readonly refused = new Set<string>()
	readonly results = new Map<string, unknown>()

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
						if (this.unanswered.has(command.method)) continue
						if (this.refused.has(command.method)) socket.write(`${JSON.stringify({ jsonrpc: '2.0', error: { code: 1, message: 'refused' }, id: command.id })}\r\n`)
						else socket.write(`${JSON.stringify({ jsonrpc: '2.0', result: this.results.get(command.method) ?? 0, id: command.id })}\r\n`)
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

	test('leaves a remote run alone when the session is disconnected mid-command', async () => {
		const id = await connected()

		const calibrated = commander.calibrate(id)

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartCalibration', Mount: 'Mount Simulator' })

		const transport: { stopCapture: () => unknown } = PHD2Client.prototype
		const stopCapture = transport.stopCapture
		let stops = 0

		transport.stopCapture = () => {
			stops++
			return Promise.resolve(0)
		}

		try {
			expect((await commander.disconnect(id)).ok).toBeTrue()
			expect((await calibrated).ok).toBeFalse()
			expect(stops).toBe(0)
		} finally {
			transport.stopCapture = stopCapture
		}
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

	test('gives up on the handshake when the server accepts the socket but never answers', async () => {
		const [silent, silentPort] = await startServer()
		silent.unanswered.add('get_pixel_scale')

		const result = await commander.connect(remote(silentPort))

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('timeout')
		expect(commander.list()).toBeEmpty()
		expect(arbiter.availability(remoteGuiderKey('127.0.0.1', silentPort))).toBe('available')
	})

	test('settles a request still in flight when the session goes away', async () => {
		const id = await connected()
		server.unanswered.add('find_star')

		const found = commander.findStar(id)

		expect(await waitUntil(() => server.received('find_star'))).toBeTrue()
		expect((await commander.disconnect(id)).ok).toBeTrue()

		const result = await found

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('disconnected')
	})

	test('gives up when the connection attempt itself never completes', async () => {
		const transport: { connect: (hostname: string, port?: number) => Promise<boolean> } = PHD2Client.prototype
		const connect = transport.connect
		transport.connect = () => new Promise<boolean>(() => {})

		try {
			const result = await commander.connect(remote())

			expect(result.ok).toBeFalse()
			expect(result.ok || result.reason).toBe('timeout')
			expect(commander.list()).toBeEmpty()
			expect(arbiter.availability(remoteGuiderKey('127.0.0.1', port))).toBe('available')
		} finally {
			transport.connect = connect
		}
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

	test('refuses a command issued after the session began ending', async () => {
		const id = await connected()

		const disconnected = commander.disconnect(id)
		const looped = await commander.loop(id)

		expect(looped.ok).toBeFalse()
		expect(looped.ok || looped.reason).toBe('disconnected')
		expect((await disconnected).ok).toBeTrue()
		expect(server.received('loop')).toBeFalse()
	})

	test('answers a status query even when the server never replies to it', async () => {
		const id = await connected()
		server.unanswered.add('get_profile')

		const status = await commander.status(id)

		expect(status.connected).toBeTrue()
		expect(status.profile).toBeUndefined()
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

	test('fails a refused command instead of waiting for a state the guider will never reach', async () => {
		const id = await connected()
		server.refused.add('loop')

		const result = await commander.loop(id)

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('commandFailed')
		expect(commander.looping(id)).toBeFalse()
	})

	test('lets a guide exposure longer than the command timeout produce its first frame', async () => {
		server.results.set('get_exposure', 2000)

		const id = await connected()
		const looped = commander.loop(id)

		expect(await waitUntil(() => server.received('loop'))).toBeTrue()

		await Bun.sleep(1500)
		server.push({ Event: 'LoopingExposures', Frame: 1, StarMass: 100, SNR: 20, HFD: 3 })

		expect((await looped).ok).toBeTrue()
		expect(commander.looping(id)).toBeTrue()
	})

	test('leaves a running guider alone when a new command is refused', async () => {
		const id = await connected()

		const guided = commander.startGuiding(id)
		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartGuiding' })
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })
		expect((await guided).ok).toBeTrue()

		server.refused.add('loop')

		const looped = await commander.loop(id)

		expect(looped.ok).toBeFalse()
		expect(looped.ok || looped.reason).toBe('commandFailed')
		expect(server.received('stop_capture')).toBeFalse()
		expect(commander.running(id)).toBeTrue()
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
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })

		expect((await guided).ok).toBeTrue()
		expect(commander.running(id)).toBeTrue()
	})

	test('lets the settle judge a star lost after guiding was announced', async () => {
		const id = await connected()

		const guided = commander.startGuiding(id, { timeout: 5000 })

		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartGuiding' })
		server.push({ Event: 'StarLost', Frame: 1, Time: 1, StarMass: 0, SNR: 0, HFD: 0, AvgDist: 0, Status: 1 })
		server.push({ Event: 'GuideStep', Frame: 2, Time: 1, RADistanceRaw: 1, DECDistanceRaw: 1, RADuration: 1, RADirection: 'West', DECDuration: 1, DECDirection: 'North', StarMass: 1, SNR: 1, HFD: 1 })
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 1 })

		expect((await guided).ok).toBeTrue()
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
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })

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
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })
		expect((await guided).ok).toBeTrue()

		const stopped = commander.stopGuiding(id)
		expect(await waitUntil(() => server.received('stop_capture'))).toBeTrue()
		server.push({ Event: 'GuidingStopped' })

		expect((await stopped).ok).toBeTrue()
		expect(commander.running(id)).toBeFalse()
	})

	test('fails the stop when the server refuses it instead of waiting for a state it will never reach', async () => {
		const id = await connected()

		const guided = commander.startGuiding(id)
		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartGuiding' })
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })
		expect((await guided).ok).toBeTrue()

		server.refused.add('stop_capture')

		const stopped = await commander.stopGuiding(id)

		expect(stopped.ok).toBeFalse()
		expect(stopped.ok || stopped.reason).toBe('commandFailed')
		expect(stopped.ok || stopped.error).toContain('refused the command')
	})

	test('fails the stop when the transport rejects it instead of waiting for a state it will never reach', async () => {
		const id = await connected()

		const guided = commander.startGuiding(id)
		expect(await waitUntil(() => server.received('guide'))).toBeTrue()
		server.push({ Event: 'StartGuiding' })
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })
		expect((await guided).ok).toBeTrue()

		const transport: { stopCapture: () => unknown } = PHD2Client.prototype
		const stopCapture = transport.stopCapture
		transport.stopCapture = () => Promise.reject(new Error('stop refused'))

		try {
			const stopped = await commander.stopGuiding(id)

			expect(stopped.ok).toBeFalse()
			expect(stopped.ok || stopped.reason).toBe('commandFailed')
			expect(stopped.ok || stopped.error).toContain('stop refused')
		} finally {
			transport.stopCapture = stopCapture
		}
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
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })
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

	test('refuses a new dither while the guider still moves for an abandoned one', async () => {
		const id = await guiding()

		const controller = new AbortController()
		const abandoned = commander.dither(id, undefined, { signal: controller.signal })

		expect(await waitUntil(() => server.received('dither'))).toBeTrue()
		controller.abort('aborted')
		expect((await abandoned).ok).toBeFalse()

		const refused = await commander.dither(id)

		expect(refused.ok).toBeFalse()
		expect(refused.ok || refused.reason).toBe('busy')

		server.push({ Event: 'SettleBegin' })

		expect(await waitUntil(() => commander.info(id)?.state === 'settling')).toBeTrue()

		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })
		server.push({ Event: 'GuideStep', Frame: 2, Time: 1, RADistanceRaw: 1, DECDistanceRaw: 1, RADuration: 1, RADirection: 'West', DECDuration: 1, DECDirection: 'North', StarMass: 1, SNR: 1, HFD: 1 })

		expect(await waitUntil(() => commander.running(id))).toBeTrue()

		const dithered = commander.dither(id)

		expect(await waitUntil(() => server.commands.filter((command) => command.method === 'dither').length === 2)).toBeTrue()
		server.push({ Event: 'SettleBegin' })
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })

		expect((await dithered).ok).toBeTrue()
	})

	test('releases the session when the server refuses a dither outright', async () => {
		const id = await guiding()

		server.refused.add('dither')

		const dithered = await commander.dither(id)

		expect(dithered.ok).toBeFalse()
		expect(dithered.ok || dithered.reason).toBe('commandFailed')

		// The server decided against the move, so there is no movement to wait out.
		const again = await commander.dither(id)

		expect(again.ok).toBeFalse()
		expect(again.ok || again.reason).toBe('commandFailed')
	})

	test('retains the movement when the reply to a dither is lost', async () => {
		const id = await guiding()

		type Send = (method: string, params?: Record<string, unknown> | unknown[], timeout?: number) => Promise<unknown>
		const transport = PHD2Client.prototype as unknown as { send: Send }
		const send = transport.send

		// The command reached the guider; only its answer did not, so the mount may well be moving.
		transport.send = function (method, params, timeout) {
			if (method === 'dither') return Promise.resolve({ success: false, error: 'timeout' })
			return send.call(this, method, params, timeout)
		}

		try {
			const dithered = await commander.dither(id)

			expect(dithered.ok).toBeFalse()
			expect(dithered.ok || dithered.reason).toBe('commandFailed')
		} finally {
			transport.send = send
		}

		const refused = await commander.dither(id)

		expect(refused.ok).toBeFalse()
		expect(refused.ok || refused.reason).toBe('busy')
	})

	test('bounds the wait by the timeout its caller asked for', async () => {
		const id = await guiding()

		const started = performance.now()
		const dithered = await commander.dither(id, undefined, { timeout: 200 })
		const elapsed = performance.now() - started

		expect(dithered.ok).toBeFalse()
		expect(dithered.ok || dithered.reason).toBe('timeout')
		expect(elapsed).toBeLessThan(2000)
	})

	test('settles even when the phase callback of its caller throws', async () => {
		const id = await guiding()

		const dithered = commander.dither(id, undefined, {
			onPhase: () => {
				throw new Error('callback failed')
			},
		})

		expect(await waitUntil(() => server.received('dither'))).toBeTrue()
		server.push({ Event: 'SettleBegin' })
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })

		expect((await dithered).ok).toBeTrue()

		server.push({ Event: 'GuideStep', Frame: 2, Time: 1, RADistanceRaw: 1, DECDistanceRaw: 1, RADuration: 1, RADirection: 'West', DECDuration: 1, DECDirection: 'North', StarMass: 1, SNR: 1, HFD: 1 })
		expect(await waitUntil(() => commander.running(id))).toBeTrue()

		// The session is left usable, rather than stuck on a command that never terminalized.
		const again = commander.dither(id)

		expect(await waitUntil(() => server.commands.filter((command) => command.method === 'dither').length === 2)).toBeTrue()
		server.push({ Event: 'SettleBegin' })
		server.push({ Event: 'SettleDone', Status: 0, TotalFrames: 5, DroppedFrames: 0 })

		expect((await again).ok).toBeTrue()
	})

	test('spends the caller timeout across both of its waits, not once each', async () => {
		const id = await guiding()

		const started = performance.now()
		const dithered = commander.dither(id, undefined, { timeout: 400 })

		expect(await waitUntil(() => server.received('dither'))).toBeTrue()

		// Settling begins late, leaving only the rest of the timeout for the settle itself.
		await Bun.sleep(300)
		server.push({ Event: 'SettleBegin' })

		const result = await dithered
		const elapsed = performance.now() - started

		expect(result.ok).toBeFalse()
		expect(result.ok || result.reason).toBe('timeout')
		expect(elapsed).toBeLessThan(700)
	})

	test('extends the retention of a movement that only begins settling later', async () => {
		const id = await guiding()

		const controller = new AbortController()
		const settle = { ...DEFAULT_GUIDER_DITHER.settle, timeout: 1 }
		const abandoned = commander.dither(id, { settle }, { signal: controller.signal })

		expect(await waitUntil(() => server.received('dither'))).toBeTrue()
		controller.abort('aborted')
		expect((await abandoned).ok).toBeFalse()

		// Settling begins just before the original retention would lapse, so the movement runs on from there
		// and the guider reports itself guiding again while it is still under way.
		await Bun.sleep(900)
		server.push({ Event: 'SettleBegin' })
		server.push({ Event: 'GuideStep', Frame: 2, Time: 1, RADistanceRaw: 1, DECDistanceRaw: 1, RADuration: 1, RADirection: 'West', DECDuration: 1, DECDirection: 'North', StarMass: 1, SNR: 1, HFD: 1 })

		expect(await waitUntil(() => commander.running(id))).toBeTrue()

		await Bun.sleep(250)

		const refused = await commander.dither(id)

		expect(refused.ok).toBeFalse()
		expect(refused.ok || refused.reason).toBe('busy')
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
	function local(camera: Camera, guideOutput: GuideOutput, exposureTime = 10): GuiderConnect {
		return {
			mode: 'local',
			focalLength: 500,
			camera: camera.id,
			guideOutput: guideOutput.id,
			capture: { ...structuredClone(DEFAULT_CAMERA_CAPTURE_START), exposureTime, exposureTimeUnit: 'millisecond' },
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
		expect(result.ok && result.value.key).toBe(localGuiderKey(camera, guideOutput))
		expect(arbiter.availability(localGuiderCameraKey(camera))).toBe('leased')
		expect(arbiter.availability(localGuiderOutputKey(guideOutput))).toBe('leased')
		expect(arbiter.availability(resourceKey(camera))).toBe('available')
		expect(arbiter.availability(resourceKey(guideOutput))).toBe('available')
		expect(arbiter.ownersOfDevice(resourceKey(camera))).not.toBeEmpty()
		expect(arbiter.ownersOfDevice(resourceKey(guideOutput))).not.toBeEmpty()
	})

	test('refuses a second session over the same devices even while the first is idle', async () => {
		const [camera, guideOutput] = await devices()

		expect((await commander.connect(local(camera, guideOutput))).ok).toBeTrue()

		const second = await commander.connect(local(camera, guideOutput))

		expect(second.ok).toBeFalse()
		expect(second.ok || second.reason).toBe('busy')
		expect(commander.list()).toHaveLength(1)
	})

	test('lets a guide exposure longer than the command timeout produce its first frame', async () => {
		const [camera, guideOutput] = await devices()
		const connect = await commander.connect(local(camera, guideOutput, 2000))

		expect(connect.ok).toBeTrue()
		if (!connect.ok) throw new Error(connect.error)

		const looped = await commander.loop(connect.value.id)

		expect(looped.ok).toBeTrue()
		expect(commander.looping(connect.value.id)).toBeTrue()
	}, 20000)

	test('refuses a second session that shares only the guide camera of the first', async () => {
		const [camera, guideOutput] = await devices()
		const shared = guideOutputManager.get(client, 'Camera Simulator')!

		expect(shared).toBeDefined()
		expect(shared.id).not.toBe(guideOutput.id)
		expect((await commander.connect(local(camera, guideOutput))).ok).toBeTrue()

		const second = await commander.connect(local(camera, shared))

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
		expect(arbiter.availability(localGuiderCameraKey(camera))).toBe('leased')
		expect(arbiter.availability(localGuiderOutputKey(guideOutput))).toBe('leased')
	}, 20000)

	test('fails the disconnect when the activity could not stop the guider', async () => {
		const [camera, guideOutput] = await devices()
		const connect = await commander.connect(local(camera, guideOutput))

		expect(connect.ok).toBeTrue()
		if (!connect.ok) throw new Error(connect.error)

		const id = connect.value.id

		expect((await commander.loop(id, { timeout: 15000 })).ok).toBeTrue()

		const stopExposure = cameraManager.stopExposure.bind(cameraManager)

		cameraManager.stopExposure = () => {
			throw new Error('stop refused')
		}

		try {
			const disconnected = await commander.disconnect(id)

			expect(disconnected.ok).toBeFalse()
			expect(disconnected.ok || disconnected.error).toContain('the guider did not stop')
		} finally {
			cameraManager.stopExposure = stopExposure
		}

		expect(commander.list()).toBeEmpty()
		expect(arbiter.availability(resourceKey(camera))).toBe('available')
		expect(arbiter.availability(localGuiderCameraKey(camera))).toBe('available')
		expect(arbiter.availability(localGuiderOutputKey(guideOutput))).toBe('available')
	}, 20000)

	test('detaches the local guider when its configuration fails', async () => {
		const [camera, guideOutput] = await devices()

		const gain = cameraManager.gain.bind(cameraManager)
		const disableBlob = cameraManager.disableBlob.bind(cameraManager)
		const disabled: string[] = []

		cameraManager.gain = () => {
			throw new Error('gain failed')
		}

		cameraManager.disableBlob = (device) => {
			disabled.push(device.id)
			disableBlob(device)
		}

		try {
			const result = await commander.connect(local(camera, guideOutput))

			expect(result.ok).toBeFalse()
			expect(result.ok || result.error).toContain('gain failed')
			expect(disabled).toEqual([camera.id])
			expect(commander.list()).toBeEmpty()
			expect(arbiter.availability(localGuiderCameraKey(camera))).toBe('available')
			expect(arbiter.availability(localGuiderOutputKey(guideOutput))).toBe('available')
			expect(arbiter.availability(resourceKey(camera))).toBe('available')
		} finally {
			cameraManager.gain = gain
			cameraManager.disableBlob = disableBlob
		}
	})

	test('restores the frame delivery its next activity depends on', async () => {
		const [camera, guideOutput] = await devices()
		const connect = await commander.connect(local(camera, guideOutput))

		expect(connect.ok).toBeTrue()
		if (!connect.ok) throw new Error(connect.error)

		cameraManager.disableBlob(camera)

		const looped = await commander.loop(connect.value.id, { timeout: 15000 })

		expect(looped.ok).toBeTrue()
		expect(commander.looping(connect.value.id)).toBeTrue()
	}, 20000)

	test('reconfigures the guide camera after another operation had it', async () => {
		const [camera, guideOutput] = await devices()
		const connect = await commander.connect(local(camera, guideOutput))

		expect(connect.ok).toBeTrue()
		if (!connect.ok) throw new Error(connect.error)

		const held = Promise.withResolvers<void>()
		const owner = coordinator.start<void>('test', [{ key: resourceKey(camera), device: camera }], async () => {
			cameraManager.bin(camera, 2, 2)
			cameraManager.gain(camera, 42)
			cameraManager.disableBlob(camera)
			await held.promise
			return { ok: true, value: undefined }
		})

		held.resolve()
		expect((await owner.result).ok).toBeTrue()
		expect(await waitUntil(() => camera.bin.x.value === 2)).toBeTrue()

		const looped = await commander.loop(connect.value.id, { timeout: 15000 })

		expect(looped.ok).toBeTrue()
		expect(camera.bin.x.value).toBe(1)
		expect(camera.gain.value).toBe(0)
	}, 20000)

	test('leaves the guide camera alone when disconnecting while another operation owns it', async () => {
		const [camera, guideOutput] = await devices()

		const addHandler = cameraManager.addHandler.bind(cameraManager)
		const removeHandler = cameraManager.removeHandler.bind(cameraManager)
		const stopExposure = cameraManager.stopExposure.bind(cameraManager)
		const handlers = new Set<unknown>()
		let stopped = 0

		cameraManager.addHandler = (handler) => {
			handlers.add(handler)
			addHandler(handler)
		}

		cameraManager.removeHandler = (handler) => {
			handlers.delete(handler)
			removeHandler(handler)
		}

		try {
			const connect = await commander.connect(local(camera, guideOutput))

			expect(connect.ok).toBeTrue()
			if (!connect.ok) throw new Error(connect.error)
			expect(handlers.size).toBe(1)

			const held = Promise.withResolvers<void>()
			const owner = coordinator.start<void>('capture', [{ key: resourceKey(camera), device: camera }], async () => {
				await held.promise
				return { ok: true, value: undefined }
			})

			cameraManager.stopExposure = () => {
				stopped++
			}

			try {
				await commander.disconnect(connect.value.id)

				expect(stopped).toBe(0)
				expect(handlers).toBeEmpty()
				expect(commander.list()).toBeEmpty()
				expect(arbiter.availability(localGuiderCameraKey(camera))).toBe('available')
			} finally {
				held.resolve()
				await owner.result
			}
		} finally {
			cameraManager.addHandler = addHandler
			cameraManager.removeHandler = removeHandler
			cameraManager.stopExposure = stopExposure
		}
	})

	test('closes normally when another operation owns only the guide output', async () => {
		const [camera, guideOutput] = await devices()
		const connect = await commander.connect(local(camera, guideOutput))

		expect(connect.ok).toBeTrue()
		if (!connect.ok) throw new Error(connect.error)

		const held = Promise.withResolvers<void>()
		const owner = coordinator.start<void>('slew', [{ key: resourceKey(guideOutput), device: guideOutput }], async () => {
			await held.promise
			return { ok: true, value: undefined }
		})

		try {
			expect((await commander.disconnect(connect.value.id)).ok).toBeTrue()
			expect(commander.list()).toBeEmpty()
		} finally {
			held.resolve()
			await owner.result
		}
	})

	test('keeps a looping run alive when a later command is refused', async () => {
		const [camera, guideOutput] = await devices()
		const connect = await commander.connect(local(camera, guideOutput))

		expect(connect.ok).toBeTrue()
		if (!connect.ok) throw new Error(connect.error)

		const id = connect.value.id

		expect((await commander.loop(id, { timeout: 15000 })).ok).toBeTrue()
		expect(arbiter.availability(resourceKey(camera))).toBe('leased')

		const transport: { guide: () => unknown } = GuiderClient.prototype
		const guide = transport.guide
		transport.guide = () => false

		try {
			const refused = await commander.startGuiding(id, { timeout: 1000 })

			expect(refused.ok).toBeFalse()
			expect(refused.ok || refused.reason).toBe('commandFailed')
			expect(arbiter.availability(resourceKey(camera))).toBe('leased')
			expect(commander.looping(id)).toBeTrue()
		} finally {
			transport.guide = guide
		}
	}, 20000)

	test('waits for the settle of the guide command before reporting a local guider as guiding', async () => {
		const [camera, guideOutput] = await devices()
		const connect = await commander.connect(local(camera, guideOutput))

		expect(connect.ok).toBeTrue()
		if (!connect.ok) throw new Error(connect.error)

		const id = connect.value.id
		const transport = GuiderClient.prototype as unknown as { guide: () => unknown; emitEvent: (event: string, data?: Record<string, unknown>) => void }
		const guide = transport.guide
		const clients: { emitEvent: (event: string, data?: Record<string, unknown>) => void }[] = []

		// The local client announces guiding as soon as it is commanded, before its loop has processed a
		// frame, and only settles once frames start arriving.
		transport.guide = function (this: (typeof clients)[number]) {
			clients.push(this)
			this.emitEvent('SettleBegin')
			this.emitEvent('StartGuiding')
			return true
		}

		try {
			const announced = await commander.startGuiding(id, { timeout: 500 })

			expect(announced.ok).toBeFalse()
			expect(announced.ok || announced.reason).toBe('timeout')

			const guided = commander.startGuiding(id, { timeout: 5000 })

			expect(await waitUntil(() => clients.length === 2)).toBeTrue()
			clients[1].emitEvent('SettleDone', { Status: 0, TotalFrames: 5, DroppedFrames: 0 })

			expect((await guided).ok).toBeTrue()
			expect(commander.running(id)).toBeTrue()
		} finally {
			transport.guide = guide
		}
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
