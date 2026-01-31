import { type PHD2AppState, PHD2Client, type PHD2ClientHandler, type PHD2Command, type PHD2Error, type PHD2Events, type PHD2JsonRpcEvent } from 'nebulosa/src/phd2'
import { DEFAULT_PHD2_DITHER, DEFAULT_PHD2_EVENT, type PHD2Connect, type PHD2Dither, type PHD2Event, type PHD2State, type PHD2Status } from 'src/shared/types'
import { type Endpoints, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'

export class PHD2Handler {
	private client?: PHD2Client
	private state: PHD2AppState = 'Stopped'
	private pixelScale = 1
	private settling?: PromiseWithResolvers<boolean>
	private readonly settings = structuredClone(DEFAULT_PHD2_DITHER)
	private readonly rms = new RMS()

	readonly event = structuredClone(DEFAULT_PHD2_EVENT)

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notificationHandler: NotificationHandler,
	) {}

	private readonly handler: PHD2ClientHandler = {
		event: (client: PHD2Client, event: Exclude<PHD2Events, PHD2JsonRpcEvent>) => {
			switch (event.Event) {
				case 'AppState':
					this.state = event.State

					switch (this.state) {
						case 'Calibrating':
							this.handlePHD2Event('CALIBRATING')
							break
						case 'Guiding':
							this.handlePHD2Event('GUIDING')
							break
						case 'Looping':
							this.handlePHD2Event('LOOPING')
							break
						case 'LostLock':
							this.handlePHD2Event('STAR_LOST')
							break
						default:
							this.handlePHD2Event('IDLE')
							break
					}

					break
				case 'StartCalibration':
					this.handlePHD2Event('CALIBRATING')
					break
				case 'LoopingExposures':
					this.event.starMass = event.StarMass
					this.event.snr = event.SNR
					this.event.hfd = event.HFD
					this.handlePHD2Event('LOOPING')
					break
				case 'SettleBegin':
					this.settling?.resolve(false)
					this.settling = Promise.withResolvers()
					this.handlePHD2Event('SETTLING')
					break
				case 'SettleDone':
					this.handleSettleDone(true)
					break
				case 'GuideStep': {
					const { RADistanceRaw, DECDistanceRaw, RADuration = 0, RADirection, DECDuration = 0, DECDirection } = event
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
					this.handlePHD2Event('GUIDING')
					break
				}
				case 'GuidingDithered': {
					this.event.step.ra = null
					this.event.step.dec = null
					this.event.step.raCorrection = null
					this.event.step.decCorrection = null
					this.event.step.dx = event.dx
					this.event.step.dy = event.dy
					this.handlePHD2Event('GUIDING')
					break
				}
				case 'StarLost':
					this.handlePHD2Event('STAR_LOST')
					break
				case 'Paused':
					this.handlePHD2Event('PAUSED')
					break
			}

			console.info('event: %j', event)
		},
		command: (client: PHD2Client, command: PHD2Command, success: boolean, result: PHD2Error | unknown) => {
			console.info(command.method, 'received:', success, JSON.stringify(result))
		},
		close: () => {
			this.wsm.send('phd2:close', undefined)
			this.client = undefined
			this.clear()
		},
	}

	get isConnected() {
		return !!this.client
	}

	get isRunning() {
		return this.event.state === 'GUIDING'
	}

	sendEvent(event: PHD2Event) {
		this.wsm.send('phd2', event)
	}

	private handlePHD2Event(state?: PHD2State) {
		if (state !== undefined) this.event.state = state
		this.sendEvent(this.event)
	}

	async profiles() {
		return (await this.client?.getProfiles()) ?? []
	}

	async connect(req: PHD2Connect) {
		if (this.client) return false

		try {
			this.client = new PHD2Client({ handler: this.handler })

			if (await this.client.connect(req.host, req.port)) {
				Object.assign(this.settings, req.dither)
				this.clear()
				this.pixelScale = (await this.client.getPixelScale()) || 1
				return true
			} else {
				this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to PHD2 server', color: 'danger' })
			}
		} catch (e) {
			this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to PHD2 server', color: 'danger' })
		}

		return false
	}

	async dither(req?: Partial<PHD2Dither>) {
		if (!this.client) return

		if (this.state === 'Guiding') {
			const settle = req?.settle ?? this.settings.settle

			await this.waitForSettle(settle.timeout)
			await this.client.dither(req?.amount ?? this.settings.amount, req?.raOnly ?? this.settings.raOnly, settle)
			await Bun.sleep(settle.time * 1000)
			await this.waitForSettle(settle.timeout)
		}
	}

	private async waitForSettle(timeout: number) {
		if (!this.settling) return true
		setTimeout(this.handleSettleDone.bind(this, false), timeout * 1000)
		return await this.settling.promise
	}

	disconnect() {
		if (this.client) {
			this.client.close()
			this.client = undefined
		}
	}

	async status() {
		const profile = (await this.client?.getProfile())?.name
		return { connected: this.isConnected, running: this.isRunning, profile } satisfies PHD2Status
	}

	clear() {
		this.rms.clear()
	}

	private handleSettleDone(status: boolean) {
		this.settling?.resolve(status)
		this.settling = undefined
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
		const rightAscension = Math.sqrt(size * this.sumRASquared - sumRA * sumRA) / size
		const declination = Math.sqrt(size * this.sumDECSquared - sumDEC * sumDEC) / size
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

export function phd2(phd2Handler: PHD2Handler): Endpoints {
	return {
		'/phd2/profiles': { GET: async () => response(await phd2Handler.profiles()) },
		'/phd2/connect': { POST: async (req) => response(await phd2Handler.connect(await req.json())) },
		'/phd2/dither': { POST: async (req) => response(await phd2Handler.dither(await req.json())) },
		'/phd2/disconnect': { POST: () => response(phd2Handler.disconnect()) },
		'/phd2/status': { GET: async () => response(await phd2Handler.status()) },
		'/phd2/event': { GET: () => response(phd2Handler.event) },
		'/phd2/clear': { POST: () => response(phd2Handler.clear()) },
	}
}
