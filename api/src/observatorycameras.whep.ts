import { errorResponse } from './http'
import { type MediaMtxGateway, cameraPathName } from './observatorycameras.gateway'

// Same-origin broker of the WHEP signaling between the browsers and the gateway. A browser posts its SDP offer to
// /api/observatory-cameras/:id/whep; the broker sends it to the WHEP endpoint of the camera's path on the loopback
// listener of the gateway (never a host or path the client names), and answers with the gateway's SDP and a session URL
// of its own: the gateway's session resource is kept only in the memory of the server, under a random token bound to the
// camera and to the process of the gateway that created it. Trickle ICE (PATCH) and the end of a session (DELETE) go
// through that token. Media never passes here: it flows between the browser and the gateway over WebRTC. Watching a
// camera is passive, so these sessions are not operations and hold no device.

// Time a WHEP request to the gateway may take, in milliseconds: the source may take 15 s to start on demand.
const WHEP_TIMEOUT = 20000

// Header the gateway answers with the id of the WebRTC session it created (as its control API names it).
const SESSION_ID_HEADER = 'id'

// Error codes of the WHEP routes, besides those of the camera sources (SourceCode):
// - sessionExpired: the session is unknown, ended, or belongs to a former gateway process.
// - unsupportedCodec: the stream has no codec WebRTC can carry, such as H.265 to a browser without it.
// - sourceUnavailable: the camera's stream could not be read, for a reason the gateway did not tell.
// - upstreamFailure: the gateway did not answer the request.
export type WhepErrorCode = 'sessionExpired' | 'unsupportedCodec' | 'sourceUnavailable' | 'upstreamFailure'

// Session of a browser, as the broker keeps it.
interface WhepSession {
	// Camera the session reads.
	readonly cameraId: string
	// Process of the gateway that created it.
	readonly epoch: string
	// Session resource of the gateway, an absolute loopback URL.
	readonly resource: string
	// Id of the session in the gateway's control API.
	readonly sessionId?: string
}

// Outcome of an offer the gateway refused: why, as one of the codes of the WHEP routes.
export interface WhepRefusal {
	// Code of the refusal.
	readonly code: WhepErrorCode
	// Message meant for people.
	readonly message: string
}

// Receiver of the sessions opened and closed, by camera.
export type WhepListener = (cameraId: string) => void

// Classifies the error the gateway answered an offer with.
export function refusalOf(status: number, error: string | undefined): WhepRefusal {
	if (error && /supported codec/i.test(error)) return { code: 'unsupportedCodec', message: 'The camera sends no video codec WebRTC can carry; set it to H.264.' }
	if (status === 400 || status === 404) return { code: 'sourceUnavailable', message: 'The stream of the camera could not be read.' }
	return { code: 'upstreamFailure', message: 'The media gateway did not answer.' }
}

// Broker of the WHEP sessions of the browsers.
export class WhepBroker {
	// Sessions by token.
	readonly #sessions = new Map<string, WhepSession>()

	// Creates the broker over gateway, telling listener the camera whose sessions changed.
	constructor(
		readonly gateway: MediaMtxGateway,
		readonly listener: WhepListener,
	) {}

	// Number of sessions of a camera.
	count(cameraId: string) {
		let count = 0
		for (const session of this.#sessions.values()) if (session.cameraId === cameraId) count++
		return count
	}

	// Whether any session is open.
	get active() {
		return this.#sessions.size > 0
	}

	// Sends the SDP offer of req to the gateway for the camera and answers with the gateway's SDP and a session URL of
	// this server. A refusal of the gateway is returned to the caller, which knows why the source failed.
	async offer(cameraId: string, req: Request): Promise<Response | WhepRefusal> {
		const base = this.gateway.webrtcUrl
		const epoch = this.gateway.epoch
		if (!base || !epoch) return { code: 'upstreamFailure', message: 'The media gateway is not ready.' }

		let response: Response

		try {
			response = await fetch(`${base}/${encodeURIComponent(cameraPathName(cameraId))}/whep`, {
				method: 'POST',
				headers: { 'content-type': 'application/sdp' },
				body: await req.text(),
				signal: AbortSignal.any([req.signal, AbortSignal.timeout(WHEP_TIMEOUT)]),
			})
		} catch {
			return { code: 'upstreamFailure', message: 'The media gateway did not answer.' }
		}

		const location = response.headers.get('location')

		if (response.status !== 201 || !location) {
			const body = (await response.json().catch(() => undefined)) as { readonly error?: string } | undefined
			return refusalOf(response.status, body?.error)
		}

		const token = Bun.randomUUIDv7()
		const sessionId = response.headers.get(SESSION_ID_HEADER) ?? undefined
		this.#sessions.set(token, { cameraId, epoch, resource: new URL(location, base).toString(), ...(sessionId && { sessionId }) })
		this.listener(cameraId)

		const headers = new Headers({ 'content-type': 'application/sdp', location: `/api/observatory-cameras/${encodeURIComponent(cameraId)}/whep/sessions/${token}` })
		for (const name of ['etag', 'accept-patch']) {
			const value = response.headers.get(name)
			if (value) headers.set(name, value)
		}

		return new Response(await response.text(), { status: 201, headers })
	}

	// Returns the live session of a token of the camera, or undefined.
	#session(cameraId: string, token: string) {
		const session = this.#sessions.get(token)
		return session?.cameraId === cameraId && session.epoch === this.gateway.epoch ? session : undefined
	}

	// Sends the trickle ICE candidates of req to the gateway session of the token.
	async patch(cameraId: string, token: string, req: Request): Promise<Response> {
		const session = this.#session(cameraId, token)
		if (!session) return errorResponse('The session ended', 404, 'sessionExpired' satisfies WhepErrorCode)

		try {
			const response = await fetch(session.resource, {
				method: 'PATCH',
				headers: { 'content-type': req.headers.get('content-type') ?? 'application/trickle-ice-sdpfrag', 'if-match': req.headers.get('if-match') ?? '*' },
				body: await req.text(),
				signal: AbortSignal.any([req.signal, AbortSignal.timeout(WHEP_TIMEOUT)]),
			})
			await response.body?.cancel()
			if (response.status === 404) this.#forget(token)
			return new Response(undefined, { status: response.status })
		} catch {
			return errorResponse('The media gateway did not answer', 502, 'upstreamFailure' satisfies WhepErrorCode)
		}
	}

	// Ends the session of a token: tells the gateway, then forgets it. Ending an unknown or ended session succeeds.
	async remove(cameraId: string, token: string): Promise<Response> {
		const session = this.#session(cameraId, token)
		this.#forget(token)
		if (session) await this.#close(session)
		return new Response(undefined, { status: 204 })
	}

	// Ends every session of a camera, as when its address changes or it is removed.
	async closeCamera(cameraId: string) {
		const sessions: WhepSession[] = []

		for (const [token, session] of this.#sessions) {
			if (session.cameraId !== cameraId) continue
			this.#sessions.delete(token)
			sessions.push(session)
		}

		if (sessions.length === 0) return
		this.listener(cameraId)
		await Promise.all(sessions.map((session) => this.#close(session)))
	}

	// Forgets every session at once, as when the gateway process ended.
	clear() {
		const cameras = new Set([...this.#sessions.values()].map((session) => session.cameraId))
		this.#sessions.clear()
		for (const cameraId of cameras) this.listener(cameraId)
	}

	// Forgets the sessions the gateway no longer has, such as those of a browser that closed without saying so.
	async sweep() {
		if (this.#sessions.size === 0) return
		const epoch = this.gateway.epoch

		let live: Set<string>

		try {
			live = await this.gateway.webrtcSessions()
		} catch {
			return
		}

		for (const [token, session] of this.#sessions) {
			if (session.epoch !== epoch || (session.sessionId !== undefined && !live.has(session.sessionId))) this.#forget(token)
		}
	}

	// Forgets the session of a token, telling the listener.
	#forget(token: string) {
		const session = this.#sessions.get(token)
		if (!session) return
		this.#sessions.delete(token)
		this.listener(session.cameraId)
	}

	// Asks the gateway to end a session; one already gone, or a gateway that does not answer, is not an error.
	async #close(session: WhepSession) {
		if (session.epoch !== this.gateway.epoch) return

		try {
			const response = await fetch(session.resource, { method: 'DELETE', signal: AbortSignal.timeout(WHEP_TIMEOUT) })
			await response.body?.cancel()
		} catch {
			if (session.sessionId) await this.gateway.kickSession(session.sessionId).catch(() => undefined)
		}
	}
}
