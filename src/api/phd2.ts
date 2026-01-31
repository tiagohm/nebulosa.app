import { type PHD2AppState, PHD2Client, type PHD2ClientHandler, type PHD2Command, type PHD2Error, type PHD2Events, type PHD2JsonRpcEvent } from 'nebulosa/src/phd2'
import { DEFAULT_PHD2_DITHER, DEFAULT_PHD2_EVENT, type PHD2Connect, type PHD2Dither, type PHD2Event, type PHD2State } from 'src/shared/types'
import { type Endpoints, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'

export class PHD2Handler {
	private client?: PHD2Client
	private state: PHD2AppState = 'Stopped'
	private settling?: PromiseWithResolvers<boolean>
	private readonly event = structuredClone(DEFAULT_PHD2_EVENT)
	private readonly settings = structuredClone(DEFAULT_PHD2_DITHER)

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
				case 'SettleBegin':
					this.settling?.resolve(false)
					this.settling = Promise.withResolvers()
					break
				case 'SettleDone':
					this.handleSettleDone(true)
					break
			}

			console.info('%j', event)
		},
		command: (client: PHD2Client, command: PHD2Command, success: boolean, result: PHD2Error | unknown) => {
			console.info(command.method, 'received:', success, JSON.stringify(result))
		},
	}

	sendEvent(event: PHD2Event) {
		this.wsm.send('phd2', event)
	}

	private handlePHD2Event(state: PHD2State) {
		this.event.state = state
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
			await this.waitForSettle()
			await this.client.dither(req?.amount ?? this.settings.amount, req?.raOnly ?? this.settings.raOnly, req?.settle ?? this.settings.settle)
		}
	}

	async waitForSettle() {
		if (!this.settling) return true
		setTimeout(this.handleSettleDone.bind(this, false), 15000)
		return await this.settling.promise
	}

	disconnect() {
		if (this.client) {
			this.client.close()
			this.client = undefined
		}
	}

	private handleSettleDone(status: boolean) {
		this.settling?.resolve(status)
		this.settling = undefined
	}
}

export function phd2(phd2Handler: PHD2Handler): Endpoints {
	return {
		'/phd2/profiles': { GET: async () => response(await phd2Handler.profiles()) },
		'/phd2/connect': { POST: async (req) => response(await phd2Handler.connect(await req.json())) },
		'/phd2/dither': { POST: async (req) => response(await phd2Handler.dither(await req.json())) },
		'/phd2/disconnect': { POST: () => response(phd2Handler.disconnect()) },
	}
}
