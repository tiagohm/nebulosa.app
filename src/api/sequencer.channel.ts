import { isSequencerTerminalState } from '#/sequencer.state'
import type { SequencerSession, SequencerSessionSnapshot } from '#/sequencer.state'
import { webSocketBus } from './message'
import type { Messager, WebSocketMessageHandler } from './message'
import type { SequencerRuntimeChange } from './sequencer.runtime'
import { SequencerProgressEmitter } from './sequencer.snapshot'

// WebSocket fanout of the sequencer, over the sockets `WebSocketMessageHandler` already holds.
//
// Four channels carry two different kinds of value. `sequencer:session`, `sequencer:event` and
// `sequencer:artifact` report consolidated state: each message corresponds to something the store accepted,
// and every one of them is recoverable afterwards — the session by reading it, the events by asking for the
// ones after a sequence the client already holds, the artifacts by listing them. `sequencer:progress` is the
// cadence, is volatile, and is never replayed: a client that reconnects is owed the current reading, not the
// history of percentages it missed, and the snapshot it receives on connecting already carries it.
//
// Instants inside the payloads are milliseconds since the Unix epoch.

// Collaborators the channel is wired with.
export interface SequencerChannelOptions {
	// Socket registry the messages are sent through.
	readonly wsm: WebSocketMessageHandler
	// Derives the snapshot of one session, or undefined when the session is unknown to this process.
	readonly snapshot: (sessionId: string) => SequencerSessionSnapshot | undefined
	// Every session the process holds, oldest first, used to greet a socket that just connected.
	readonly sessions: () => readonly SequencerSession[]
	// Cadence of the progress channel in milliseconds, defaulting to the one the emitter declares.
	readonly interval?: number
}

// Publishes the sequencer to the connected clients.
export class SequencerChannel {
	readonly #wsm: WebSocketMessageHandler
	readonly #snapshot: (sessionId: string) => SequencerSessionSnapshot | undefined
	readonly #sessions: () => readonly SequencerSession[]
	readonly #emitter: SequencerProgressEmitter
	readonly #unsubscribe: () => void
	// Session the cadence describes, undefined while nothing is running. One session runs at a time, so this
	// is the running one rather than a set, and it is cleared by the terminal change of that same session.
	#tracked?: string

	// Wires the fanout and starts greeting sockets as they connect.
	constructor(options: SequencerChannelOptions) {
		this.#wsm = options.wsm
		this.#snapshot = options.snapshot
		this.#sessions = options.sessions

		this.#emitter = new SequencerProgressEmitter({
			snapshot: () => (this.#tracked === undefined ? undefined : this.#snapshot(this.#tracked)),
			emit: (snapshot) => this.#wsm.send('sequencer:progress', snapshot),
			interval: options.interval,
		})

		this.#unsubscribe = webSocketBus.subscribe('open', (socket) => this.welcome(socket))
	}

	// Sends one socket the state it needs to be current: the snapshot of every session that has not ended.
	//
	// A terminal session is left out on purpose — it is a finished record a client reads when it wants it, not
	// something a fresh connection has to be told about — and no progress is sent, because the snapshot is the
	// current reading and the cadence takes over from there. The events are not replayed either: the snapshot
	// carries `lastEventSequence`, which is exactly what the client asks the events route to continue from.
	welcome(socket: Messager) {
		for (const session of this.#sessions()) {
			if (isSequencerTerminalState(session.state)) continue

			const snapshot = this.#snapshot(session.id)

			if (snapshot !== undefined) this.#wsm.send('sequencer:session', snapshot, socket)
		}
	}

	// Fans out one durable change and keeps the cadence aligned with what is running.
	//
	// The session snapshot goes out first, so a client that reads the events after it already has the state
	// they belong to. The cadence follows the session that has started and not yet ended, and a change that
	// ends it emits one last reading before stopping: the final state is a transition like any other, and
	// leaving it to be discovered by the next tick would mean never sending it at all.
	changed(change: SequencerRuntimeChange) {
		const { session } = change
		const snapshot = this.#snapshot(session.id)

		if (snapshot !== undefined) this.#wsm.send('sequencer:session', snapshot)

		for (const event of change.events) this.#wsm.send('sequencer:event', event)
		for (const artifact of change.artifacts) this.#wsm.send('sequencer:artifact', artifact)

		if (isSequencerTerminalState(session.state)) {
			if (this.#tracked !== session.id) return

			this.#emitter.changed()
			this.#emitter.stop()
			this.#tracked = undefined
		} else if (session.startedAt !== undefined) {
			this.#tracked = session.id
			// `changed` emits and restarts the interval; `start` is what the first change of a session needs.
			if (this.#emitter.started) this.#emitter.changed()
			else this.#emitter.start()
		}
	}

	// Releases the cadence and the socket subscription. Idempotent, and required on shutdown so the interval
	// does not outlive the process's own teardown.
	close() {
		this.#emitter.stop()
		this.#tracked = undefined
		this.#unsubscribe()
	}
}
