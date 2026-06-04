import { GuiderClient } from 'nebulosa/src/guider.client'
import type { CameraManager, GuideOutputManager } from 'nebulosa/src/indi.manager'
import { type PHD2AppState, PHD2Client, type PHD2Command, type PHD2Events } from 'nebulosa/src/phd2'
import { DEFAULT_PHD2_DITHER, DEFAULT_PHD2_EVENT, type PHD2Connect, type PHD2Dither, type PHD2Event, type PHD2State, type PHD2Status } from 'src/shared/types'
import { exposureTimeInSeconds } from 'src/shared/util'
import { type Endpoints, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'
import { waitFor } from './util'

export class PHD2Handler {
	private client?: PHD2Client | GuiderClient
	private state: PHD2AppState = 'Stopped'
	private pixelScale = 1
	private connecting = false
	private settling?: PromiseWithResolvers<boolean>
	private settleTimer?: ReturnType<typeof setTimeout>
	private readonly settings = structuredClone(DEFAULT_PHD2_DITHER)
	private readonly rms = new RMS()

	readonly event = structuredClone(DEFAULT_PHD2_EVENT)

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notificationHandler: NotificationHandler,
	) {}

	private readonly handler = {
		event: (client: PHD2Client | GuiderClient, event: PHD2Events) => {
			if (client !== this.client) return

			switch (event.Event) {
				case 'AppState':
					this.state = event.State

					switch (this.state) {
						case 'Calibrating':
							this.handlePHD2Event('calibrating')
							break
						case 'Guiding':
							this.handlePHD2Event('guiding')
							break
						case 'Looping':
							this.handlePHD2Event('looping')
							break
						case 'LostLock':
							this.handlePHD2Event('starLost')
							break
						default:
							this.handlePHD2Event('idle')
							break
					}

					break
				case 'StartCalibration':
					this.state = 'Calibrating'
					this.handlePHD2Event('calibrating')
					break
				case 'LoopingExposures':
					this.state = 'Looping'
					this.event.starMass = event.StarMass
					this.event.snr = event.SNR
					this.event.hfd = event.HFD
					this.handlePHD2Event('looping')
					break
				case 'SettleBegin':
					this.settleDone(false)
					this.settling = Promise.withResolvers()
					this.handlePHD2Event('settling')
					break
				case 'SettleDone':
					this.settleDone(event.Status === 0)
					break
				case 'GuideStep': {
					this.state = 'Guiding'
					const { RADistanceRaw, DECDistanceRaw, RADuration, RADirection, DECDuration, DECDirection } = event
					const { rightAscension, declination } = this.rms.addDataPoint(RADistanceRaw, DECDistanceRaw)
					this.event.starMass = event.StarMass
					this.event.snr = event.SNR
					this.event.hfd = event.HFD
					this.event.rmsRA = rightAscension * this.pixelScale
					this.event.rmsDEC = declination * this.pixelScale
					this.event.step.ra = RADistanceRaw * this.pixelScale
					this.event.step.dec = DECDistanceRaw * this.pixelScale
					this.event.step.raCorrection = RADirection === 'West' ? RADuration : -RADuration
					this.event.step.decCorrection = DECDirection === 'North' ? DECDuration : -DECDuration
					this.event.step.dx = null
					this.event.step.dy = null
					this.handlePHD2Event('guiding')
					break
				}
				case 'GuidingDithered': {
					this.state = 'Guiding'
					this.event.step.ra = null
					this.event.step.dec = null
					this.event.step.raCorrection = null
					this.event.step.decCorrection = null
					this.event.step.dx = event.dx
					this.event.step.dy = event.dy
					this.handlePHD2Event('guiding')
					break
				}
				case 'StarLost':
					this.state = 'LostLock'
					this.handlePHD2Event('starLost')
					break
				case 'Paused':
					this.state = 'Paused'
					this.handlePHD2Event('paused')
					break
				case 'StartGuiding':
					this.state = 'Guiding'
					this.handlePHD2Event('guiding')
					break
				case 'GuidingStopped':
				case 'LoopingExposuresStopped':
					this.state = 'Stopped'
					this.handlePHD2Event('idle')
					break
			}

			// console.info('event: %j', event)
		},
		command: (client: PHD2Client, command: PHD2Command, success: boolean, result: unknown) => {
			if (client !== this.client) return
			console.info(command.method, 'received:', success, JSON.stringify(result))
		},
		close: (client: PHD2Client | GuiderClient) => {
			if (client !== this.client) return
			this.client = undefined
			this.reset()
			this.wsm.send('phd2:close', undefined)
		},
	} as const

	get isConnected() {
		return !!this.client
	}

	get isRunning() {
		return this.event.state === 'guiding'
	}

	get isLooping() {
		return this.event.state === 'looping'
	}

	sendEvent(event: PHD2Event) {
		this.wsm.send('phd2', event)
	}

	private handlePHD2Event(state?: PHD2State) {
		if (state !== undefined) this.event.state = state
		this.sendEvent(this.event)
	}

	async profiles() {
		if (this.client instanceof GuiderClient) return []
		return (await this.client?.getProfiles()) ?? []
	}

	async connect(req: PHD2Connect, cameraManager: CameraManager, guideOutputManager: GuideOutputManager) {
		if (this.client || this.connecting) return false

		this.connecting = true

		try {
			if (req.mode === 'remote') {
				const client = new PHD2Client({ handler: this.handler })

				if (await client.connect(req.host, req.port)) {
					this.client = client
					Object.assign(this.settings, req.dither)
					this.reset()
					this.pixelScale = (await client.getPixelScale()) || 1
					return true
				}
			} else {
				const camera = cameraManager.get(undefined, req.camera)
				const guideOutput = guideOutputManager.get(undefined, req.guideOutput)

				if (!camera?.connected || !guideOutput?.connected) return false

				const client = new GuiderClient(cameraManager, guideOutputManager, {
					handler: this.handler,
				})

				if (client.connect(camera, guideOutput, req)) {
					this.client = client

					const { capture } = req

					capture.width && capture.height && cameraManager.frame(camera, capture.x, capture.y, capture.width, capture.height)
					cameraManager.frameType(camera, capture.frameType)
					if (capture.frameFormat) cameraManager.frameFormat(camera, capture.frameFormat)
					cameraManager.bin(camera, capture.binX, capture.binY)
					cameraManager.gain(camera, capture.gain)
					cameraManager.offset(camera, capture.offset)
					cameraManager.transferFormat(camera, capture.transferFormat)
					cameraManager.compression(camera, capture.compressed)
					client.setExposure(exposureTimeInSeconds(capture.exposureTime, capture.exposureTimeUnit))

					Object.assign(this.settings, req.dither)
					this.reset()
					this.pixelScale = client.getPixelScale() || 1
					return true
				}
			}

			this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to PHD2 server', color: 'danger' })
		} catch (e) {
			console.error(e)
			this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to PHD2 server', color: 'danger' })
		} finally {
			this.connecting = false
		}

		return false
	}

	async dither(req?: Partial<PHD2Dither>, abort?: AbortSignal) {
		const client = this.client

		if (!client || abort?.aborted || !this.isRunning) return false

		if (this.state === 'Guiding' || this.event.state === 'guiding') {
			const settle = req?.settle ?? this.settings.settle

			if (!abort?.aborted && !(await this.waitForSettle(settle.timeout))) return false
			if (abort?.aborted) return false

			const amount = req?.amount ?? this.settings.amount
			const raOnly = req?.raOnly ?? this.settings.raOnly
			const dithered = client instanceof PHD2Client ? await client.send<number>('dither', { amount, raOnly, settle }) : client.dither(amount, raOnly, settle)

			if (dithered === undefined || dithered === false) return false
			if (!abort?.aborted && !(await waitFor(Math.max(0, settle.time) * 1000, () => !abort?.aborted))) return false
			if (!abort?.aborted) return await this.waitForSettle(settle.timeout)
		}

		return false
	}

	private async waitForSettle(timeout: number) {
		const settling = this.settling

		if (!settling) return true

		this.clearSettleTimer()
		this.settleTimer = setTimeout(
			() => {
				if (this.settling === settling) this.settleDone(false)
			},
			Math.max(1, timeout) * 1000,
		)

		return await settling.promise
	}

	loop() {
		void this.client?.loop()
	}

	findStar() {
		void this.client?.findStar()
	}

	start() {
		void this.client?.guide(false, this.settings.settle)
	}

	stop() {
		void this.client?.stopCapture()
	}

	calibrate() {
		void this.client?.guide(true, this.settings.settle)
	}

	disconnect() {
		const client = this.client

		if (!client) return

		this.client = undefined

		if (client instanceof PHD2Client) client.close()
		else client.disconnect()

		this.reset()
		this.wsm.send('phd2:close', undefined)
	}

	async status() {
		const profile = this.client instanceof GuiderClient ? undefined : (await this.client?.getProfile())?.name
		return { connected: this.isConnected, looping: this.isLooping, running: this.isRunning, profile } satisfies PHD2Status
	}

	clear() {
		this.rms.clear()
	}

	settleDone(status: boolean) {
		this.clearSettleTimer()
		this.settling?.resolve(status)
		this.settling = undefined
	}

	private reset() {
		this.state = 'Stopped'
		this.pixelScale = 1
		this.settleDone(false)
		this.clear()
		Object.assign(this.event, structuredClone(DEFAULT_PHD2_EVENT))
	}

	private clearSettleTimer() {
		if (this.settleTimer) {
			clearTimeout(this.settleTimer)
			this.settleTimer = undefined
		}
	}
}

class RMS {
	private size = 0
	private sumRA = 0
	private sumRASquared = 0
	private sumDEC = 0
	private sumDECSquared = 0

	addDataPoint(raDistance: number, decDistance: number) {
		this.size++

		this.sumRA += raDistance
		this.sumRASquared += raDistance * raDistance
		this.sumDEC += decDistance
		this.sumDECSquared += decDistance * decDistance

		// this.peakRA = Math.max(peakRA, Math.abs(raDistance))
		// this.peakDEC = Math.max(peakDEC, Math.abs(decDistance))

		return this.compute()
	}

	removeDataPoint(raDistance: number, decDistance: number) {
		this.size--

		this.sumRA -= raDistance
		this.sumRASquared -= raDistance * raDistance
		this.sumDEC -= decDistance
		this.sumDECSquared -= decDistance * decDistance

		return this.compute()
	}

	private compute() {
		const { size, sumRA, sumDEC } = this
		if (size <= 0) return { rightAscension: 0, declination: 0 } as const

		const rightAscension = Math.sqrt(Math.max(0, size * this.sumRASquared - sumRA * sumRA)) / size
		const declination = Math.sqrt(Math.max(0, size * this.sumDECSquared - sumDEC * sumDEC)) / size
		return { rightAscension, declination } as const
	}

	clear() {
		this.size = 0
		this.sumRA = 0
		this.sumRASquared = 0
		this.sumDEC = 0
		this.sumDECSquared = 0
	}
}

export function phd2(phd2Handler: PHD2Handler, cameraManager: CameraManager, guideOutputManager: GuideOutputManager) {
	return {
		'/phd2/profiles': { GET: async () => response(await phd2Handler.profiles()) },
		'/phd2/connect': { POST: async (req) => response(await phd2Handler.connect(await req.json(), cameraManager, guideOutputManager)) },
		'/phd2/dither': { POST: async (req) => response(await phd2Handler.dither(await req.json())) },
		'/phd2/disconnect': { POST: () => response(phd2Handler.disconnect()) },
		'/phd2/status': { GET: async () => response(await phd2Handler.status()) },
		'/phd2/event': { GET: () => response(phd2Handler.event) },
		'/phd2/clear': { POST: () => response(phd2Handler.clear()) },
		'/phd2/start': { POST: () => response(phd2Handler.start()) },
		'/phd2/stop': { POST: () => response(phd2Handler.stop()) },
		'/phd2/loop': { POST: () => response(phd2Handler.loop()) },
		'/phd2/findstar': { POST: () => response(phd2Handler.findStar()) },
		'/phd2/calibrate': { POST: () => response(phd2Handler.calibrate()) },
	} as const satisfies Endpoints
}
