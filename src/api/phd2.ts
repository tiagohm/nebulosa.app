import { PHD2Client, type PHD2ClientHandler, type PHD2Command, type PHD2Error, type PHD2Events, type PHD2JsonRpcEvent } from 'nebulosa/src/phd2'
import type { PHD2Connect, PHD2Dither, PHD2Start } from 'src/shared/types'
import { type Endpoints, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'

export class PHD2Handler implements PHD2ClientHandler {
	private client?: PHD2Client

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notificationHandler: NotificationHandler,
	) {}

	event(client: PHD2Client, event: Exclude<PHD2Events, PHD2JsonRpcEvent>) {
		console.info(event)
	}

	command(client: PHD2Client, command: PHD2Command, success: boolean, result: PHD2Error | unknown) {
		console.info(command, success, result)
	}

	async connect(req: PHD2Connect) {
		if (this.client) return false

		try {
			this.client = new PHD2Client({ handler: this })

			if (await this.client.connect(req.host, req.port)) {
				return true
			} else {
				this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to PHD2 server', color: 'danger' })
			}
		} catch (e) {
			this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to PHD2 server', color: 'danger' })
		}

		return false
	}

	start(req: PHD2Start) {
		this.client?.guide(false, undefined, req.settle)
	}

	stop() {
		this.client?.stopCapture()
	}

	dither(req: PHD2Dither) {
		this.client?.dither(req.amount, req.raOnly, req.settle)
	}

	disconnect() {
		if (this.client) {
			this.client.close()
			this.client = undefined
		}
	}
}

export function phd2(phd2Handler: PHD2Handler): Endpoints {
	return {
		// '/phd2/info': {},
		'/phd2/connect': { POST: async (req) => response(await phd2Handler.connect(await req.json())) },
		'/phd2/disconnect': { POST: () => response(phd2Handler.disconnect()) },
		'/phd2/start': { POST: async (req) => response(phd2Handler.start(await req.json())) },
		'/phd2/stop': { POST: () => response(phd2Handler.stop()) },
	}
}
