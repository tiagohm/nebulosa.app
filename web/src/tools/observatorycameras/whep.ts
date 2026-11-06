// WHEP reader of one camera: a receive-only WebRTC peer connection whose signaling goes to the same-origin routes of the
// server (/api/observatory-cameras/:id/whep), which relays it to the media gateway; the browser never learns where the
// camera is. It sends its SDP offer, then its ICE candidates as they are gathered (trickle ICE, PATCH of the session
// URL), and ends the session (DELETE) when closed. Video only: audio is not requested. It never retries; its owner
// decides. Adapted from reader.js of MediaMTX v1.21.3 (internal/servers/webrtc/reader.js), MIT License, Copyright (c)
// 2019 aler9; this adaptation keeps its offer, trickle, and session handling and leaves out audio and retries.

// Stage a reader failed at: signaling (the offer was refused or not answered) or media (the WebRTC connection could not
// be made or was lost).
export type WhepFailureStage = 'signaling' | 'media'

// Failure of a reader.
export interface WhepFailure {
	// Stage it failed at.
	readonly stage: WhepFailureStage
	// Message meant for people.
	readonly message: string
	// Stable code of the server's error, when it gave one.
	readonly code?: string
	// Whether the WebRTC connection had been made before, so a retry may restore it.
	readonly connected: boolean
}

// Options of a reader.
export interface WhepReaderOptions {
	// Same-origin URL of the WHEP endpoint.
	readonly url: string
	// Receives the stream of the video track.
	readonly onTrack: (stream: MediaStream) => void
	// Receives the failure that ended the reader; called at most once.
	readonly onError: (failure: WhepFailure) => void
	// Fetch of the signaling requests; injectable for tests.
	readonly fetch?: typeof fetch
	// Creates the peer connection; injectable for tests.
	readonly peerConnection?: () => RTCPeerConnection
}

// ICE credentials and media lines of the local offer, needed to describe trickled candidates.
interface OfferData {
	// ICE user fragment of the offer.
	readonly iceUfrag: string
	// ICE password of the offer.
	readonly icePwd: string
	// Media lines (without "m=") of the offer, by index.
	readonly medias: readonly string[]
}

// Reads the ICE credentials and media lines of an SDP offer.
export function parseOffer(sdp: string): OfferData {
	let iceUfrag = ''
	let icePwd = ''
	const medias: string[] = []

	for (const line of sdp.split('\r\n')) {
		if (line.startsWith('m=')) medias.push(line.slice(2))
		else if (!iceUfrag && line.startsWith('a=ice-ufrag:')) iceUfrag = line.slice('a=ice-ufrag:'.length)
		else if (!icePwd && line.startsWith('a=ice-pwd:')) icePwd = line.slice('a=ice-pwd:'.length)
	}

	return { iceUfrag, icePwd, medias }
}

// Describes ICE candidates as a trickle-ice-sdpfrag body (RFC 8840), grouped by the media line they belong to.
export function sdpFragment(offer: OfferData, candidates: readonly RTCIceCandidate[]) {
	const byMedia = new Map<number, RTCIceCandidate[]>()

	for (const candidate of candidates) {
		const index = candidate.sdpMLineIndex ?? 0
		const list = byMedia.get(index) ?? []
		list.push(candidate)
		byMedia.set(index, list)
	}

	let fragment = `a=ice-ufrag:${offer.iceUfrag}\r\na=ice-pwd:${offer.icePwd}\r\n`

	for (const [index, media] of offer.medias.entries()) {
		const list = byMedia.get(index)
		if (!list) continue
		fragment += `m=${media}\r\na=mid:${index}\r\n`
		for (const candidate of list) fragment += `a=${candidate.candidate}\r\n`
	}

	return fragment
}

// Reader of the video of one camera over WHEP.
export class WhepReader {
	// Peer connection, while the reader runs.
	#pc?: RTCPeerConnection
	// Session URL the server answered with.
	#session?: string
	// Offer data, once the offer is made.
	#offer?: OfferData
	// Candidates gathered before the session URL is known.
	readonly #queued: RTCIceCandidate[] = []
	// Whether the WebRTC connection was made.
	#connected = false
	// Whether the reader ended, closed or failed.
	#ended = false
	// Cancels the signaling requests in flight.
	readonly #abort = new AbortController()

	// Creates a reader with options; it starts with start.
	constructor(readonly options: WhepReaderOptions) {}

	// Fetch of the signaling requests, bound to the window as the browser requires.
	get #fetch(): typeof fetch {
		return this.options.fetch ?? globalThis.fetch.bind(globalThis)
	}

	// Makes the offer, sends it, and applies the answer. A failure is reported to onError. Never rejects.
	async start(): Promise<void> {
		try {
			const pc = this.options.peerConnection?.() ?? new RTCPeerConnection({ iceServers: [] })
			this.#pc = pc
			pc.addTransceiver('video', { direction: 'recvonly' })
			pc.onicecandidate = (event) => this.#candidate(event.candidate)
			pc.onconnectionstatechange = () => this.#connectionState(pc.connectionState)
			pc.ontrack = (event) => this.options.onTrack(event.streams[0] ?? new MediaStream([event.track]))

			const offer = await pc.createOffer()
			this.#offer = parseOffer(offer.sdp ?? '')
			await pc.setLocalDescription(offer)
			if (this.#ended) return

			const response = await this.#fetch(this.options.url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp, signal: this.#abort.signal })

			if (response.status !== 201) {
				const body = (await response.json().catch(() => undefined)) as { readonly error?: string; readonly code?: string } | undefined
				this.#fail({ stage: 'signaling', message: body?.error ?? `The server answered ${response.status}.`, ...(body?.code && { code: body.code }) })
				return
			}

			this.#session = new URL(response.headers.get('location') ?? '', new URL(this.options.url, location.href)).toString()
			const answer = await response.text()
			if (this.#ended) return this.#deleteSession()

			await pc.setRemoteDescription({ type: 'answer', sdp: answer })
			if (this.#queued.length > 0) this.#sendCandidates(this.#queued.splice(0))
		} catch (error) {
			if (!this.#ended) this.#fail({ stage: 'signaling', message: Error.isError(error) ? error.message : 'The video could not be requested.' })
		}
	}

	// Ends the session and closes the peer connection; nothing is reported afterwards.
	close() {
		if (this.#ended) return
		this.#ended = true
		this.#abort.abort()
		this.#deleteSession()
		this.#pc?.close()
	}

	// Handles a gathered candidate: sent at once, or queued until the session URL is known.
	#candidate(candidate: RTCIceCandidate | null) {
		if (this.#ended || !candidate) return
		if (this.#session) this.#sendCandidates([candidate])
		else this.#queued.push(candidate)
	}

	// Sends candidates to the session.
	#sendCandidates(candidates: readonly RTCIceCandidate[]) {
		const session = this.#session
		const offer = this.#offer
		if (!session || !offer) return

		void this.#fetch(session, { method: 'PATCH', headers: { 'Content-Type': 'application/trickle-ice-sdpfrag', 'If-Match': '*' }, body: sdpFragment(offer, candidates), signal: this.#abort.signal })
			.then((response) => {
				if (response.status !== 204 && !this.#ended) this.#fail({ stage: 'signaling', message: 'The video session ended.' })
			})
			.catch(() => undefined)
	}

	// Handles a change of the WebRTC connection: a failure or close ends the reader.
	#connectionState(state: RTCPeerConnectionState) {
		if (this.#ended) return
		if (state === 'connected') this.#connected = true
		if (state !== 'failed' && state !== 'closed') return
		this.#fail({ stage: 'media', message: this.#connected ? 'The video connection was lost.' : 'No video connection could be made; the browser may not reach the UDP port of the server.' })
	}

	// Ends the reader with a failure, reported once.
	#fail(failure: Omit<WhepFailure, 'connected'>) {
		if (this.#ended) return
		this.#ended = true
		this.#abort.abort()
		this.#deleteSession()
		this.#pc?.close()
		this.options.onError({ ...failure, connected: this.#connected })
	}

	// Ends the session on the server, even while the page unloads.
	#deleteSession() {
		const session = this.#session
		this.#session = undefined
		if (session) void this.#fetch(session, { method: 'DELETE', keepalive: true }).catch(() => undefined)
	}
}
