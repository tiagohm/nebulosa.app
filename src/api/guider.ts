import { type PHD2AppState, PHD2Client, type PHD2Command, type PHD2Events } from 'nebulosa/src/devices/guiding/phd2'
import type { CameraManager, GuideOutputManager } from 'nebulosa/src/devices/indi/manager'
import { GuiderClient } from 'nebulosa/src/observation/guiding/client'
import { DEFAULT_GUIDER_DITHER, DEFAULT_GUIDER_EVENT, type GuiderConnect, type GuiderDither, type GuiderEvent, type GuiderState, type GuiderStatus } from 'src/shared/types'
import { exposureTimeInSeconds } from 'src/shared/util'
import { type Endpoints, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'

export type GuiderDitherFailureReason = 'not-guiding' | 'aborted' | 'busy' | 'command-failed' | 'settle-timeout' | 'settle-failed'

export type GuiderDitherResult = { readonly ok: true } | { readonly ok: false; readonly reason: GuiderDitherFailureReason; readonly error?: string }

export type GuiderDitherEvent =
	| { readonly phase: 'dithering'; readonly guider: GuiderEvent }
	| { readonly phase: 'dithered'; readonly guider: GuiderEvent; readonly dx: number; readonly dy: number }
	| { readonly phase: 'settling'; readonly guider: GuiderEvent }
	| { readonly phase: 'settled'; readonly guider: GuiderEvent; readonly ok: boolean; readonly reason?: GuiderDitherFailureReason; readonly error?: string }

export interface GuiderDitherOptions {
	readonly signal?: AbortSignal
	readonly onEvent?: (event: GuiderDitherEvent) => void
}

interface GuiderDitherOperation {
	readonly result: PromiseWithResolvers<GuiderDitherResult>
	readonly settleStarted: PromiseWithResolvers<boolean>
	readonly onEvent?: (event: GuiderDitherEvent) => void
	readonly signal?: AbortSignal
	readonly timeout: number
	onAbort?: VoidFunction
	settleStartedAt?: number
	startTimer?: ReturnType<typeof setTimeout>
	settleTimer?: ReturnType<typeof setTimeout>
	finished: boolean
}

export class GuiderHandler {
	private client?: PHD2Client | GuiderClient
	private state: PHD2AppState = 'Stopped'
	private pixelScale = 1
	private connecting = false
	private settleTimer?: ReturnType<typeof setTimeout>
	private ditherOperation?: GuiderDitherOperation
	private readonly settings = structuredClone(DEFAULT_GUIDER_DITHER)
	private readonly rms = new RMS()

	readonly event = structuredClone(DEFAULT_GUIDER_EVENT)

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
							this.handleGuiderEvent('calibrating')
							break
						case 'Guiding':
							this.handleGuiderEvent('guiding')
							break
						case 'Looping':
							this.handleGuiderEvent('looping')
							break
						case 'LostLock':
							this.handleGuiderEvent('starLost')
							break
						default:
							this.handleGuiderEvent('idle')
							break
					}

					break
				case 'StartCalibration':
					this.state = 'Calibrating'
					this.handleGuiderEvent('calibrating')
					break
				case 'LoopingExposures':
					this.state = 'Looping'
					this.event.starMass = event.StarMass
					this.event.snr = event.SNR
					this.event.hfd = event.HFD
					this.handleGuiderEvent('looping')
					break
				case 'SettleBegin':
					this.handleGuiderEvent('settling')
					this.beginDitherSettle()
					break
				case 'SettleDone':
					this.finishDitherOperation(event.Status === 0 ? { ok: true } : { ok: false, reason: 'settle-failed', error: event.Error })
					break
				case 'Settling':
					this.handleGuiderEvent('settling')
					this.emitDitherOperationEvent({ phase: 'settling', guider: structuredClone(this.event) })
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
					this.handleGuiderEvent('guiding')
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
					this.handleGuiderEvent('guiding')
					this.emitDitherOperationEvent({ phase: 'dithered', guider: structuredClone(this.event), dx: event.dx, dy: event.dy })
					break
				}
				case 'StarLost':
					this.state = 'LostLock'
					this.handleGuiderEvent('starLost')
					break
				case 'Paused':
					this.state = 'Paused'
					this.handleGuiderEvent('paused')
					break
				case 'StartGuiding':
					this.state = 'Guiding'
					this.handleGuiderEvent('guiding')
					break
				case 'GuidingStopped':
				case 'LoopingExposuresStopped':
					this.state = 'Stopped'
					this.handleGuiderEvent('idle')
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
			this.wsm.send('guider:close', undefined)
		},
	} as const

	get connected() {
		return !!this.client
	}

	get running() {
		return this.event.state === 'guiding'
	}

	get looping() {
		return this.event.state === 'looping'
	}

	sendEvent(event: GuiderEvent) {
		this.wsm.send('guider', event)
	}

	private handleGuiderEvent(state?: GuiderState) {
		if (state !== undefined) this.event.state = state
		this.sendEvent(this.event)
	}

	async connect(req: GuiderConnect, cameraManager: CameraManager, guideOutputManager: GuideOutputManager) {
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

				const client = new GuiderClient(cameraManager, guideOutputManager, { handler: this.handler })

				if (client.connect(camera, guideOutput, req)) {
					this.client = client

					const { capture } = req

					if (capture.width > 0 && capture.height > 0 && capture.subframe) cameraManager.frame(camera, capture.x, capture.y, capture.width, capture.height)
					else if (camera.frame.width.max > 0 && camera.frame.height.max > 0) cameraManager.frame(camera, 0, 0, camera.frame.width.max, camera.frame.height.max)
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

	async dither(req?: Partial<GuiderDither>, options: GuiderDitherOptions = {}): Promise<GuiderDitherResult> {
		const client = this.client

		if (!client || options.signal?.aborted || !this.running) return { ok: false, reason: options.signal?.aborted ? 'aborted' : 'not-guiding' }
		if (this.ditherOperation) return { ok: false, reason: 'busy' }

		if (this.state === 'Guiding' || this.event.state === 'guiding') {
			const settle = req?.settle ?? this.settings.settle
			const operation = this.startDitherOperation(settle.timeout, options)

			this.emitDitherOperationEvent({ phase: 'dithering', guider: structuredClone(this.event) })

			const command = (async () => {
				const amount = req?.amount ?? this.settings.amount
				const raOnly = req?.raOnly ?? this.settings.raOnly
				const timeout = Math.max(15000, (Math.max(0, settle.time) + Math.max(1, settle.timeout)) * 1000 + 5000)
				const dithered = client instanceof PHD2Client ? await client.send<number>('dither', { amount, raOnly, settle }, timeout) : client.dither(amount, raOnly, settle)

				if (dithered === undefined || dithered === false) {
					this.finishDitherOperation({ ok: false, reason: 'command-failed' })
				} else if (operation.finished) {
					// The settle event may arrive before a remote JSON-RPC command resolves.
				} else if (await operation.settleStarted.promise) {
					// Wait for the matching SettleDone or timeout.
				}
			})().catch((error) => {
				this.finishDitherOperation({ ok: false, reason: options.signal?.aborted ? 'aborted' : 'command-failed', error: error instanceof Error ? error.message : String(error) })
			})

			await Promise.race([command, operation.result.promise])
			return await operation.result.promise
		}

		return { ok: false, reason: 'not-guiding' }
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
		this.wsm.send('guider:close', undefined)
	}

	async status() {
		const profile = this.client instanceof GuiderClient ? undefined : (await this.client?.getProfile())?.name
		return { connected: this.connected, looping: this.looping, running: this.running, profile } satisfies GuiderStatus
	}

	clear() {
		this.rms.clear()
	}

	private startDitherOperation(timeout: number, options: GuiderDitherOptions) {
		const operation: GuiderDitherOperation = {
			result: Promise.withResolvers(),
			settleStarted: Promise.withResolvers(),
			onEvent: options.onEvent,
			signal: options.signal,
			timeout,
			finished: false,
		}

		if (options.signal) {
			const onAbort = () => this.finishDitherOperation({ ok: false, reason: 'aborted' })
			operation.onAbort = onAbort
			options.signal.addEventListener('abort', onAbort, { once: true })
		}

		operation.startTimer = setTimeout(
			() => {
				if (operation.settleStartedAt === undefined) {
					operation.settleStarted.resolve(false)
					this.finishDitherOperation({ ok: false, reason: 'settle-timeout' })
				}
			},
			Math.max(1, timeout) * 1000,
		)

		this.ditherOperation = operation
		return operation
	}

	private beginDitherSettle() {
		const operation = this.ditherOperation

		if (!operation || operation.finished || operation.settleStartedAt) return

		operation.settleStartedAt = performance.now()
		if (operation.startTimer) {
			clearTimeout(operation.startTimer)
			operation.startTimer = undefined
		}

		operation.settleStarted.resolve(true)
		this.emitDitherOperationEvent({ phase: 'settling', guider: structuredClone(this.event) })

		operation.settleTimer = setTimeout(
			() => {
				this.finishDitherOperation({ ok: false, reason: 'settle-timeout' })
			},
			Math.max(1, operation.timeout) * 1000,
		)
	}

	private emitDitherOperationEvent(event: GuiderDitherEvent) {
		this.ditherOperation?.onEvent?.(event)
	}

	private finishDitherOperation(result: GuiderDitherResult) {
		const operation = this.ditherOperation

		if (!operation || operation.finished) return

		operation.finished = true

		if (operation.startTimer) clearTimeout(operation.startTimer)
		if (operation.settleTimer) clearTimeout(operation.settleTimer)
		if (operation.signal && operation.onAbort) operation.signal.removeEventListener('abort', operation.onAbort)

		operation.settleStarted.resolve(operation.settleStartedAt !== undefined)

		if (result.ok) this.emitDitherOperationEvent({ phase: 'settled', guider: structuredClone(this.event), ok: true })
		else this.emitDitherOperationEvent({ phase: 'settled', guider: structuredClone(this.event), ok: false, reason: result.reason, error: result.error })

		operation.result.resolve(result)
		this.ditherOperation = undefined
	}

	private reset() {
		this.state = 'Stopped'
		this.pixelScale = 1
		this.finishDitherOperation({ ok: false, reason: 'aborted' })
		this.clear()
		Object.assign(this.event, structuredClone(DEFAULT_GUIDER_EVENT))
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

export function guider(guiderHandler: GuiderHandler, cameraManager: CameraManager, guideOutputManager: GuideOutputManager) {
	return {
		'/guider/connect': { POST: async (req) => response(await guiderHandler.connect(await req.json(), cameraManager, guideOutputManager)) },
		'/guider/dither': { POST: async (req) => response((await guiderHandler.dither(await req.json())).ok) },
		'/guider/disconnect': { POST: () => response(guiderHandler.disconnect()) },
		'/guider/status': { GET: async () => response(await guiderHandler.status()) },
		'/guider/event': { GET: () => response(guiderHandler.event) },
		'/guider/clear': { POST: () => response(guiderHandler.clear()) },
		'/guider/start': { POST: () => response(guiderHandler.start()) },
		'/guider/stop': { POST: () => response(guiderHandler.stop()) },
		'/guider/loop': { POST: () => response(guiderHandler.loop()) },
		'/guider/findstar': { POST: () => response(guiderHandler.findStar()) },
		'/guider/calibrate': { POST: () => response(guiderHandler.calibrate()) },
	} as const satisfies Endpoints
}
