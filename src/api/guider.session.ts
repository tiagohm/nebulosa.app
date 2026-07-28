import { PHD2Client } from 'nebulosa/src/devices/guiding/phd2'
import type { PHD2AppState, PHD2Command, PHD2Events } from 'nebulosa/src/devices/guiding/phd2'
import type { Camera, GuideOutput } from 'nebulosa/src/devices/indi/device'
import type { CameraManager, GuideOutputManager } from 'nebulosa/src/devices/indi/manager'
import { GuiderClient } from 'nebulosa/src/observation/guiding/client'
import { EventBus } from 'src/shared/bus'
import { exposureTimeInSeconds } from '#/camera'
import { DEFAULT_GUIDER_DITHER, DEFAULT_GUIDER_EVENT } from '#/guider'
import type { GuiderClientMode, GuiderConnect, GuiderDither, GuiderDitherPhase, GuiderEvent, GuiderSessionInfo, GuiderState, GuiderStatus } from '#/guider'
import type { OperationContext, OperationCoordinator, OperationFailureReason, OperationHandle, OperationResult } from './operation'
import { abortReason, waitForDeviceState } from './operation.wait'
import { resourceKey } from './resource'
import type { ResourceKey } from './resource'
import { errorMessage } from './util'

// Either transport driving a guider: a remote PHD2 server or the in-process client over INDI devices.
export type GuiderTransport = PHD2Client | GuiderClient

// State-changing commands a session serializes. Telemetry stays concurrent and is not listed here.
export type GuiderCommandKind = 'loop' | 'findStar' | 'startGuiding' | 'calibrate' | 'stopGuiding' | 'dither'

// Per-call overrides for one guider command.
export interface GuiderCommandOptions {
	// Signal of the operation asking for the command; it cancels the wait without ending the session.
	readonly signal?: AbortSignal
	// Maximum milliseconds the commanded state may take to be observed.
	readonly timeout?: number
}

// Overrides for one dither, which is the only command with progress between the request and its result.
export interface GuiderDitherOptions extends GuiderCommandOptions {
	// Receives the phases of this dither, and only of this one. The caller already holds the promise of the
	// command, so its progress belongs to the same call rather than to a bus carrying every session.
	readonly onPhase?: (phase: GuiderDitherPhase) => void
}

// Outcome of a star search. Neither transport publishes a terminal event for it, so acceptance of the
// command is the strongest thing that can be reported.
export interface GuiderFindStarResult {
	// Always true; a rejected search is reported as a failed result instead.
	readonly accepted: true
}

// Progress of one dither, published for presentation only.
export type GuiderDitherEvent =
	| Readonly<{ phase: 'dithering'; guider: GuiderEvent }>
	| Readonly<{ phase: 'dithered'; guider: GuiderEvent; dx: number; dy: number }>
	| Readonly<{ phase: 'settling'; guider: GuiderEvent }>
	| Readonly<{ phase: 'settled'; guider: GuiderEvent; ok: boolean; reason?: OperationFailureReason; error?: string }>

// Presentation events fanned out by the transport handler; they never take part in command correctness.
// Every one of them names its session, because several may be open at once.
export interface GuiderBusEvents {
	// A session was opened and is ready to receive commands.
	readonly add: GuiderSessionInfo
	// The guider published new telemetry or changed state.
	readonly update: GuiderEvent
	// A dither advanced to a new phase.
	readonly dither: GuiderDitherEvent
	// The session ended, expectedly or not.
	readonly remove: GuiderSessionInfo
}

// Process-wide fanout of guider presentation events.
export const guiderBus = new EventBus<GuiderBusEvents>()

// Prefix keeping guider resources outside the device key space.
const GUIDER_RESOURCE_PREFIX = 'logical:guider'

// What one session occupies. A guider always holds a logical resource, because a remote server drives its
// camera and output outside this process and a local session that is merely connected still has to reserve
// its devices while holding no lease on them.
//
// The key describes the target rather than the service, so several guiders coexist while a duplicate is
// refused by the arbiter itself instead of by a check in the commander.
export interface GuiderTarget {
	// Logical resource identifying what is occupied.
	readonly key: ResourceKey
	// Whether the target is a local device pair or a remote server.
	readonly mode: GuiderClientMode
	// Human-readable description used in listings and diagnostics.
	readonly label: string
	// Guide camera of a local target.
	readonly camera?: Camera
	// Guide output of a local target.
	readonly guideOutput?: GuideOutput
}

// Builds the logical key of a remote server. Host is lowercased so two spellings of the same address are
// one resource and the second connection to it is refused.
export function remoteGuiderKey(host: string, port: number): ResourceKey {
	return `${GUIDER_RESOURCE_PREFIX}:remote:${host.trim().toLowerCase()}:${port}`
}

// Builds the logical key of a local guider from the physical devices it drives, which is what refuses a
// second session over the same pair even while the first one is idle and owns no device lease.
export function localGuiderKey(camera: Camera, guideOutput: GuideOutput): ResourceKey {
	return `${GUIDER_RESOURCE_PREFIX}:local:${resourceKey(camera)}:${resourceKey(guideOutput)}`
}

// Timing overrides, exposed so tests can drive the same code paths without real device latency.
export interface GuiderSessionOptions {
	// Milliseconds a short command, such as loop or stop, has to be observed.
	readonly commandTimeout?: number
	// Milliseconds guiding or calibration has to reach the Guiding state.
	readonly guidingTimeout?: number
	// Milliseconds the guider has to become idle before the activity lease is released anyway.
	readonly releaseTimeout?: number
}

// One observed session transition. The app state is read live rather than snapshotted, and the raw event
// is retained because a failure such as CalibrationFailed is only visible there.
interface GuiderUpdate {
	// Latest PHD2 application state mapped from the transport events.
	readonly state: PHD2AppState
	// Event that produced the update, absent when the update is a poll of the current state.
	readonly event?: PHD2Events
	// Whether the transport has gone; a closed session never reaches any commanded state.
	readonly closed: boolean
}

// Bookkeeping of one dither, from the command until its terminal settle.
interface GuiderDitherOperation {
	// Terminal outcome of the dither.
	readonly result: PromiseWithResolvers<OperationResult<void>>
	// Resolves true once SettleBegin was observed, false when the command never reached settling.
	readonly settleStarted: PromiseWithResolvers<boolean>
	// Caller signal that cancels the dither without ending the session.
	readonly signal?: AbortSignal
	// Receives each phase of this dither, so the caller does not observe anyone else's.
	readonly onPhase?: (phase: GuiderDitherPhase) => void
	// Settle timeout in seconds, as configured by the dither request.
	readonly timeout: number
	// Abort listener removed on terminalization.
	onAbort?: VoidFunction
	// Timestamp in milliseconds at which settling began, absent while the command is still in flight.
	settleStartedAt?: number
	// Timer bounding the wait for SettleBegin.
	startTimer?: ReturnType<typeof setTimeout>
	// Timer bounding the wait for SettleDone.
	settleTimer?: ReturnType<typeof setTimeout>
	// Exactly-once guard so a late event cannot re-settle the dither.
	finished: boolean
}

// What one awaitable guider command contributes to the shared wait primitive.
interface GuiderObserveOptions {
	// Classifies each observed update as pending, successful, or an expected failure.
	readonly evaluate: (update: GuiderUpdate) => 'pending' | 'success' | OperationFailureReason
	// Sends the state-changing command after the observer is installed.
	readonly command: () => void | Promise<void>
	// Stops physical work before any non-successful result settles.
	readonly abort?: () => void | Promise<void>
}

// One open session and the operation holding its logical resource.
interface GuiderSessionEntry {
	// Connection, its state, and its serialized commands.
	readonly session: GuiderSession
	// Operation whose result settles after every lease of the session has been released.
	readonly operation: OperationHandle<void>
}

// Open activity holding the guide camera and guide output while the guider is capturing.
interface GuiderActivity {
	// Ends the activity and resolves after the guider is idle and both devices have been released.
	readonly release: () => Promise<OperationResult<void>>
}

// Default milliseconds for a short command such as loop, find star, or stop.
const DEFAULT_COMMAND_TIMEOUT = 30000

// Default milliseconds allowed to reach Guiding, which may include a full calibration run.
const DEFAULT_GUIDING_TIMEOUT = 600000

// Default milliseconds the guider has to become idle before its devices are released regardless.
const DEFAULT_RELEASE_TIMEOUT = 30000

// Milliseconds an abort path waits for its stop to complete before giving up on the answer.
const ABORT_STOP_TIMEOUT = 1000

// Signal for waits that must still run while the session is being torn down. Cleanup cannot inherit the
// operation signal, which is aborted by then, and would never send the stop it exists for.
const UNCANCELABLE = new AbortController().signal

// Owns the guider connection, its devices, and every state-changing command issued against it.
//
// The session is the one exception to the operation-tree model: it is a long operation owned by this
// service rather than a scope nested in whoever asked for it, because a connection outlives every
// command. A command requested by another operation, such as the dither of a capture, only passes its
// signal; the session stays the owner of its devices and serializes the command itself.
export class GuiderCommander {
	// Open sessions by id. Nothing else indexes them: the arbiter is what knows which targets are taken,
	// and this map only exists so a transport can reach a session by the id it published.
	readonly #sessions = new Map<string, GuiderSessionEntry>()

	// Creates the commander over the coordinator and the managers a local guider drives.
	constructor(
		readonly coordinator: OperationCoordinator,
		readonly cameraManager: CameraManager,
		readonly guideOutputManager: GuideOutputManager,
		readonly options: GuiderSessionOptions = {},
	) {}

	// Lists every open session, in the order they were opened.
	list(): readonly GuiderSessionInfo[] {
		return [...this.#sessions.values()].map((entry) => entry.session.info)
	}

	// Describes one session, or nothing when the id is unknown.
	info(guider: string) {
		return this.#sessions.get(guider)?.session.info
	}

	// Latest presentation snapshot of one session, or nothing when the id is unknown.
	event(guider: string) {
		return this.#sessions.get(guider)?.session.event
	}

	// Whether the named session is actively guiding, which is what makes a dither meaningful.
	running(guider: string) {
		return this.#sessions.get(guider)?.session.event.state === 'guiding'
	}

	// Whether the named session is looping exposures without guiding.
	looping(guider: string) {
		return this.#sessions.get(guider)?.session.event.state === 'looping'
	}

	// Opens a session and resolves only after the transport is attached and configured.
	//
	// The target is resolved before the operation starts, because its logical key is what the arbiter needs
	// to refuse a second connection to the same server or to the same pair of devices.
	async connect(request: GuiderConnect): Promise<OperationResult<GuiderSessionInfo>> {
		const target = this.#resolveTarget(request)

		if (!target.ok) return target

		const started = Promise.withResolvers<OperationResult<GuiderSessionInfo>>()
		const ended = Promise.withResolvers<OperationResult<void>>()

		const operation = this.coordinator.start<void>('guiderSession', [{ key: target.value.key }], async (context) => {
			const session = new GuiderSession(context, request, target.value, ended, {
				cameraManager: this.cameraManager,
				guideOutputManager: this.guideOutputManager,
				options: this.options,
			})

			const opened = await session.open()

			if (!opened.ok) {
				started.resolve(opened)
				return opened
			}

			// Registered before the teardown below so it runs last: the session is only forgotten once its
			// devices are idle and the transport is gone.
			context.onCleanup(() => {
				if (this.#sessions.get(context.id)?.session === session) this.#sessions.delete(context.id)
			})

			context.onCleanup(() => session.shutdown())

			// Cancellation aborts the signal but still waits for the executor to return, and the executor is
			// parked on the promise below. Nothing else would ever resolve it, so a cancel from outside the
			// commander, such as the cancelAll of a shutdown, has to end the session here.
			if (context.signal.aborted) session.end({ ok: false, reason: abortReason(context.signal) })
			else context.signal.addEventListener('abort', () => session.end({ ok: false, reason: abortReason(context.signal) }), { once: true })

			this.#sessions.set(context.id, { session, operation })
			guiderBus.emit('add', session.info)
			started.resolve({ ok: true, value: session.info })

			// The executor stays pending on purpose: the session holds its logical resource until the
			// transport goes away or a disconnect is requested.
			return await session.finished()
		})

		// A refused scope never runs its executor, so the failure has to be taken from the operation.
		void operation.result.then((result) => {
			if (!result.ok) started.resolve(result)
		})

		return await started.promise
	}

	// Ends one session gracefully: the command in flight is aborted, then the nested activity unwinds and
	// only after it reports the guider idle is the transport closed and every lease released.
	//
	// A remote session owns no local device, so nothing is stopped on its behalf: the PHD2 server is an
	// independent application and closing our socket is not a reason to end a run someone else is watching.
	async disconnect(guider: string): Promise<OperationResult<void>> {
		const entry = this.#sessions.get(guider)

		if (entry === undefined) return { ok: false, reason: 'unexpectedState', error: `guider session ${guider} is not open` }

		entry.session.end({ ok: true, value: undefined })

		return await entry.operation.result
	}

	// Starts continuous exposures without guide output.
	async loop(guider: string, options: GuiderCommandOptions = {}) {
		return await this.#command(guider, (session) => session.loop(options))
	}

	// Selects the best star of the latest frame as the lock position.
	async findStar(guider: string, options: GuiderCommandOptions = {}) {
		return await this.#command(guider, (session) => session.findStar(options))
	}

	// Starts guiding, calibrating first when no solution exists yet.
	async startGuiding(guider: string, options: GuiderCommandOptions = {}) {
		return await this.#command(guider, (session) => session.startGuiding(false, options))
	}

	// Forces a new calibration and succeeds only when it ends in guiding.
	async calibrate(guider: string, options: GuiderCommandOptions = {}) {
		return await this.#command(guider, (session) => session.startGuiding(true, options))
	}

	// Stops capture and releases the guide camera and guide output once the guider reports itself idle.
	async stopGuiding(guider: string, options: GuiderCommandOptions = {}) {
		return await this.#command(guider, (session) => session.stopGuiding(options))
	}

	// Dithers on one session and resolves only after it settles, so a capture never exposes mid-move.
	async dither(guider: string, request?: Partial<GuiderDither>, options: GuiderDitherOptions = {}) {
		return await this.#command(guider, (session) => session.dither(request, options))
	}

	// Clears the accumulated RMS statistics of one session.
	clear(guider: string) {
		this.#sessions.get(guider)?.session.clear()
	}

	// Reports connection and activity of one session.
	async status(guider: string): Promise<GuiderStatus> {
		const session = this.#sessions.get(guider)?.session

		if (session === undefined) return { connected: false, looping: false, running: false }

		return {
			connected: session.connected,
			looping: session.event.state === 'looping',
			running: session.event.state === 'guiding',
			profile: await session.profile(),
		}
	}

	// Resolves what a connect request occupies, refusing a request whose devices are unusable before any
	// resource is taken.
	#resolveTarget(request: GuiderConnect): OperationResult<GuiderTarget> {
		if (request.mode === 'remote') {
			const host = request.host.trim()

			if (host.length === 0) return { ok: false, reason: 'unexpectedState', error: 'the guider host is empty' }

			return { ok: true, value: { key: remoteGuiderKey(host, request.port), mode: 'remote', label: `${host}:${request.port}` } }
		}

		const camera = this.cameraManager.get(undefined, request.camera)
		const guideOutput = this.guideOutputManager.get(undefined, request.guideOutput)

		if (camera === undefined || !camera.connected) return { ok: false, reason: 'disconnected', error: 'the guide camera is not connected' }
		if (guideOutput === undefined || !guideOutput.connected) return { ok: false, reason: 'disconnected', error: 'the guide output is not connected' }

		return { ok: true, value: { key: localGuiderKey(camera, guideOutput), mode: 'local', label: `${camera.name} + ${guideOutput.name}`, camera, guideOutput } }
	}

	// Routes a command to one session, reporting an unknown id as an expected failure.
	async #command<T>(guider: string, run: (session: GuiderSession) => Promise<OperationResult<T>>): Promise<OperationResult<T>> {
		const session = this.#sessions.get(guider)?.session
		if (session === undefined) return { ok: false, reason: 'disconnected', error: `guider session ${guider} is not open` }
		return await run(session)
	}
}

// One guider connection: its transport, state, leases, and serialized commands.
class GuiderSession {
	// Mutable presentation snapshot; every publication clones it so listeners cannot retain a live reference.
	readonly event = structuredClone(DEFAULT_GUIDER_EVENT)
	// Dither defaults taken from the connect request and overridden per call.
	readonly #settings = structuredClone(DEFAULT_GUIDER_DITHER)
	// Rolling guide-error statistics, in pixels before the pixel scale is applied.
	readonly #rms = new RMS()
	// Waiters fed by transport events, which is how a command learns it reached its state.
	readonly #listeners = new Set<(update: GuiderUpdate) => void>()
	// Attached transport, absent before open and after the session closed.
	#client?: GuiderTransport
	// Latest application state mapped from the transport events.
	#state: PHD2AppState = 'Stopped'
	// Arcsec per pixel used to report guide errors in angular units.
	#pixelScale = 1
	// Command currently changing state; a second one is refused instead of sharing its waiter.
	#command?: GuiderCommandKind
	// Aborts the command in flight when the session is torn down.
	#commandController?: AbortController
	// Dither in flight, absent otherwise.
	#dither?: GuiderDitherOperation
	// Open activity holding the guide camera and guide output.
	#activity?: GuiderActivity
	// Aborted the moment the session begins ending, which is well before the transport is actually closed.
	// It is what tells a command arriving during teardown that there is no session left to serve it.
	readonly #ending = new AbortController()
	// Whether the transport is gone; a closed session ignores every later callback.
	#closed = false

	// Binds a session to the operation that owns it and to the promise ending that operation.
	constructor(
		readonly context: OperationContext,
		readonly request: GuiderConnect,
		readonly target: GuiderTarget,
		readonly ended: PromiseWithResolvers<OperationResult<void>>,
		readonly sessionContext: {
			readonly cameraManager: CameraManager
			readonly guideOutputManager: GuideOutputManager
			readonly options: GuiderSessionOptions
		},
	) {
		// Every event this session publishes carries its id, so a listener watching several guiders can tell
		// whose telemetry it just received.
		this.event.id = context.id
	}

	// Whether the transport is still attached.
	get connected() {
		return !this.#closed && this.#client !== undefined
	}

	// Snapshot describing this session to transports and listings.
	get info(): GuiderSessionInfo {
		return {
			id: this.context.id,
			mode: this.target.mode,
			key: this.target.key,
			target: this.target.label,
			state: this.event.state,
			connected: this.connected,
			looping: this.event.state === 'looping',
			running: this.event.state === 'guiding',
		}
	}

	// Attaches the transport and, for a local guider, configures its devices under a scope that owns them.
	async open(): Promise<OperationResult<void>> {
		return this.request.mode === 'remote' ? await this.#openRemote(this.request.host, this.request.port) : await this.#openLocal()
	}

	// Starts looping exposures and resolves once the guider reports it is looping.
	async loop(options: GuiderCommandOptions) {
		return await this.#serialize(
			'loop',
			options,
			async (signal) =>
				await this.#withActivity(async () => {
					const observed = await this.#observe(signal, options.timeout ?? this.sessionContext.options.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT, {
						evaluate: (update) => {
							if (update.closed) return 'disconnected'
							return this.#state === 'Looping' ? 'success' : 'pending'
						},
						command: () => this.#dispatch((client) => client.loop()),
						abort: () => this.#abortCapture(),
					})

					return observed.ok ? { ok: true, value: undefined } : observed
				}),
		)
	}

	// Asks the transport to lock onto the best star of the latest frame.
	async findStar(options: GuiderCommandOptions): Promise<OperationResult<GuiderFindStarResult>> {
		return await this.#serialize('findStar', options, async (signal) => {
			const client = this.#client

			if (client === undefined) return { ok: false, reason: 'disconnected' }

			const selected = await this.#request(signal, options.timeout ?? this.sessionContext.options.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT, async () => await client.findStar())

			if (!selected.ok) return selected

			// Neither transport publishes a terminal event for the search, so acceptance is all that can be
			// reported; an empty answer means no star survived detection.
			return selected.value === undefined ? { ok: false, reason: 'unexpectedState', error: 'no guide star was found' } : { ok: true, value: { accepted: true } }
		})
	}

	// Starts guiding and resolves only once the guider is actually guiding. A recalibration must have been
	// observed to pass through Calibrating, so a stale solution cannot satisfy it.
	async startGuiding(recalibrate: boolean, options: GuiderCommandOptions) {
		return await this.#serialize(
			recalibrate ? 'calibrate' : 'startGuiding',
			options,
			async (signal) =>
				await this.#withActivity(async () => {
					let calibrating = false

					const observed = await this.#observe(signal, options.timeout ?? this.sessionContext.options.guidingTimeout ?? DEFAULT_GUIDING_TIMEOUT, {
						evaluate: (update) => {
							if (update.closed) return 'disconnected'
							if (update.event?.Event === 'CalibrationFailed') return 'alert'

							if (this.#state === 'Calibrating') {
								calibrating = true
								return 'pending'
							}

							// Losing the star before guiding was ever reached means the run failed; losing it later
							// is a transient condition of an already successful command.
							if (this.#state === 'LostLock') return 'unexpectedState'
							if (this.#state !== 'Guiding') return 'pending'

							return !recalibrate || calibrating ? 'success' : 'pending'
						},
						command: () => this.#dispatch((client) => client.guide(recalibrate, this.#settings.settle)),
						abort: () => this.#abortCapture(),
					})

					return observed.ok ? { ok: true, value: undefined } : observed
				}),
		)
	}

	// Stops capture, waits for the guider to report itself idle, and releases its devices.
	async stopGuiding(options: GuiderCommandOptions) {
		return await this.#serialize('stopGuiding', options, async (signal) => {
			const observed = await this.#observe(signal, options.timeout ?? this.sessionContext.options.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT, {
				evaluate: (update) => {
					// A transport that vanished is not capturing any more, and nothing further will ever be
					// reported by it, so the stop has nothing left to wait for.
					if (update.closed) return 'success'
					return this.#state === 'Stopped' ? 'success' : 'pending'
				},
				command: () => this.#stopCapture(),
			})

			// The devices are only handed back once the guider is idle, which is what lets a future meridian
			// flip watch the guide output being released before it takes the mount.
			const released = await this.#releaseActivity()

			if (!observed.ok) return observed

			return released.ok ? { ok: true, value: undefined } : released
		})
	}

	// Dithers and settles. The settle may begin before a remote JSON-RPC reply arrives, so the terminal
	// event and the command reply race each other and only the first one to conclude settles the dither.
	async dither(request: Partial<GuiderDither> | undefined, options: GuiderDitherOptions): Promise<OperationResult<void>> {
		return await this.#serialize('dither', options, async (signal) => {
			const client = this.#client

			if (client === undefined) return { ok: false, reason: 'disconnected' }
			if (signal.aborted) return { ok: false, reason: abortReason(signal) }
			if (this.event.state !== 'guiding') return { ok: false, reason: 'unexpectedState', error: 'the guider is not guiding' }

			const settle = request?.settle ?? this.#settings.settle
			const operation = this.#startDither(settle.timeout, signal, options.onPhase)

			this.#publishDither({ phase: 'dithering', guider: structuredClone(this.event) })

			const command = (async () => {
				const amount = request?.amount ?? this.#settings.amount
				const raOnly = request?.raOnly ?? this.#settings.raOnly
				const timeout = Math.max(15000, (Math.max(0, settle.time) + Math.max(1, settle.timeout)) * 1000 + 5000)
				const dithered = client instanceof PHD2Client ? await client.send<number>('dither', { amount, raOnly, settle }, timeout) : client.dither(amount, raOnly, settle)

				if (dithered === undefined || dithered === false) {
					this.#finishDither({ ok: false, reason: 'commandFailed', error: 'the dither command was rejected' })
				} else if (!operation.finished) {
					await operation.settleStarted.promise
				}
			})().catch((error: unknown) => {
				this.#finishDither({ ok: false, reason: signal.aborted ? abortReason(signal) : 'commandFailed', error: errorMessage(error) })
			})

			await Promise.race([command, operation.result.promise])

			return await operation.result.promise
		})
	}

	// Clears the accumulated guide-error statistics.
	clear() {
		this.#rms.clear()
	}

	// Reports the remote PHD2 profile name, which a local session does not have.
	async profile() {
		const client = this.#client
		if (!(client instanceof PHD2Client)) return undefined
		return (await client.getProfile())?.name
	}

	// Ends the session with the given outcome, aborting the command in flight first so nothing is left
	// waiting on a transport that is about to go. Cleanup, not this method, stops the guider and releases
	// its devices, and the operation result is what tells the caller that finished.
	end(result: OperationResult<void>) {
		// The cause is carried into the abort so a command in flight reports why it stopped: a session lost
		// to a dropped socket must fail its wait as disconnected, not as an ordinary cancellation.
		const reason = result.ok ? 'aborted' : result.reason
		// Teardown is only finished once cleanup has run, and a command accepted in between would get a
		// controller this method has already passed and command a device the session is about to hand back.
		this.#ending.abort(reason)
		this.#commandController?.abort(reason)
		this.ended.resolve(result)
	}

	// Terminal outcome of the session, once its activity has been released too.
	//
	// The activity is a nested scope, and the coordinator waits for a child without folding its result into
	// the parent: a disconnect whose cleanup failed to stop the guider would otherwise report success while
	// the camera is still exposing. Releasing it here is also the graceful order, because the scope ends on
	// its own instead of being canceled while the session unwinds. A session that is already failing keeps
	// its own cause, which is the one that explains why it ended.
	async finished(): Promise<OperationResult<void>> {
		const result = await this.ended.promise
		const released = await this.#releaseActivity()
		return result.ok && !released.ok ? released : result
	}

	// Closes the transport after every nested scope has released its devices.
	shutdown() {
		if (this.#client === undefined) return

		this.#closed = true
		this.#detach()
		this.#finishDither({ ok: false, reason: 'disconnected' })

		// Wakes anything still waiting so it settles as disconnected instead of running to its timeout.
		this.#emit({ state: this.#state, closed: true })
		guiderBus.emit('remove', this.info)
	}

	// Drops the attached transport and tears it down, in that order so a callback fired by the teardown is
	// already refused by client identity.
	//
	// Clearing the reference is not enough on its own: a local client that connected holds a handler on the
	// camera manager and has blob delivery enabled, and a remote one holds an open socket. Left behind, they
	// keep driving devices this session no longer owns and a retry attaches a second client over the first.
	#detach() {
		const client = this.#client

		if (client === undefined) return

		this.#client = undefined

		try {
			if (client instanceof PHD2Client) client.close()
			else client.disconnect()
		} catch (error) {
			console.error('failed to close the guider transport:', error)
		}
	}

	// Attaches a remote PHD2 client. The client is stored before the handshake because the server may push
	// events as soon as the socket is up, and an event dropped there would be an app state never applied.
	//
	// Everything after the socket is up is inside the same guard: the session is only given a cleanup that
	// closes its transport once open() has succeeded, so anything failing here has to close its own socket.
	async #openRemote(host: string, port: number): Promise<OperationResult<void>> {
		const client = new PHD2Client({ handler: this.#handler })
		this.#client = client

		try {
			if (!(await client.connect(host, port))) {
				this.#detach()
				return { ok: false, reason: 'commandFailed', error: 'failed to connect to the PHD2 server' }
			}

			Object.assign(this.#settings, this.request.dither)

			// The handshake runs before any command exists, so it is bounded by the operation instead. A
			// server that drops the socket right after accepting it would otherwise leave this pending and the
			// executor with it, holding the logical resource against even a shutdown.
			const scale = await this.#request(this.context.signal, this.sessionContext.options.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT, async () => await client.getPixelScale())

			if (!scale.ok) {
				this.#detach()
				return scale
			}

			this.#pixelScale = scale.value || 1
			return { ok: true, value: undefined }
		} catch (error) {
			this.#detach()
			return { ok: false, reason: 'commandFailed', error: errorMessage(error) }
		}
	}

	// Attaches the in-process guider and applies its capture configuration under a scope owning both
	// devices. The scope ends right after: an idle client only needs the logical resource, so the camera
	// and the guide output stay acquirable until the guider is actually told to capture.
	async #openLocal(): Promise<OperationResult<void>> {
		if (this.request.mode !== 'local') return { ok: false, reason: 'unexpectedState', error: 'the request is not a local guider connection' }

		const request = this.request
		const { cameraManager, guideOutputManager } = this.sessionContext
		const { camera, guideOutput } = this.target

		// The devices were resolved before the operation started, because their keys are what the arbiter
		// used to decide this target was free.
		if (camera === undefined || guideOutput === undefined) return { ok: false, reason: 'unexpectedState', error: 'the local guider target has no devices' }
		if (!camera.connected || !guideOutput.connected) return { ok: false, reason: 'disconnected', error: 'the guide camera or the guide output disconnected' }

		const configured = await this.context.start<GuiderClient>(
			'guiderConfigure',
			[
				{ key: resourceKey(camera), device: camera },
				{ key: resourceKey(guideOutput), device: guideOutput },
			],
			() => {
				const client = new GuiderClient(cameraManager, guideOutputManager, { handler: this.#handler })
				this.#client = client

				if (!client.connect(camera, guideOutput, request)) {
					this.#detach()
					return { ok: false, reason: 'commandFailed', error: 'failed to start the local guider' }
				}

				try {
					const { capture } = request

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

					return { ok: true, value: client }
				} catch (error) {
					// connect() already attached the client to the camera manager, so a configuration that fails
					// has to detach it here rather than leave it subscribed to a device the session gives back.
					this.#detach()
					return { ok: false, reason: 'commandFailed', error: errorMessage(error) }
				}
			},
		).result

		// The scope may also fail without its executor ever reporting it, when it is refused or canceled after
		// the client attached, so the transport is torn down on every failure and not only on a thrown one.
		if (!configured.ok) {
			this.#detach()
			return configured
		}

		Object.assign(this.#settings, request.dither)
		this.#pixelScale = configured.value.getPixelScale() || 1
		return { ok: true, value: undefined }
	}

	// Runs one state-changing command, refusing a second one instead of letting it resolve another's waiter.
	async #serialize<T>(kind: GuiderCommandKind, options: GuiderCommandOptions, run: (signal: AbortSignal) => Promise<OperationResult<T>>): Promise<OperationResult<T>> {
		if (this.#closed || this.#ending.signal.aborted) return { ok: false, reason: 'disconnected' }
		if (this.#command !== undefined) return { ok: false, reason: 'busy', error: `the guider is running ${this.#command}` }

		this.#command = kind

		// The caller's signal cancels its own command; the controller is what lets a teardown abort a
		// command nobody is waiting on any more.
		const controller = new AbortController()
		const onAbort = () => controller.abort(options.signal?.reason)

		if (options.signal?.aborted) controller.abort(options.signal.reason)
		else options.signal?.addEventListener('abort', onAbort, { once: true })

		this.#commandController = controller

		try {
			return await run(controller.signal)
		} finally {
			options.signal?.removeEventListener('abort', onAbort)
			if (this.#commandController === controller) this.#commandController = undefined
			this.#command = undefined
		}
	}

	// Awaits one transport request under a bound the session controls, rather than one the transport owes.
	//
	// A PHD2 client that closes drops every command still in flight without settling it, and clears the
	// reply timeout along with it, so a request outstanding when the transport goes away never resolves at
	// all. Anything awaiting it would hang forever: a command would never reach the release of its
	// serializer and its caller would never get an answer. Racing the request against the end of the session
	// is what makes that impossible, whatever the transport does with what it was still owed.
	async #request<T>(signal: AbortSignal, timeout: number, send: () => Promise<T>): Promise<OperationResult<T>> {
		if (signal.aborted) return { ok: false, reason: abortReason(signal) }
		if (this.#ending.signal.aborted) return { ok: false, reason: 'disconnected' }

		const bounded = Promise.withResolvers<OperationResult<T>>()
		const onAbort = () => bounded.resolve({ ok: false, reason: abortReason(signal) })
		const onEnding = () => bounded.resolve({ ok: false, reason: 'disconnected' })
		const timer = setTimeout(() => bounded.resolve({ ok: false, reason: 'timeout' }), Math.max(1, timeout))

		signal.addEventListener('abort', onAbort, { once: true })
		this.#ending.signal.addEventListener('abort', onEnding, { once: true })

		try {
			const requested = send().then(
				(value) => ({ ok: true, value }) as const,
				(error: unknown) => ({ ok: false, reason: 'commandFailed', error: errorMessage(error) }) as const,
			)

			return await Promise.race([requested, bounded.promise])
		} finally {
			clearTimeout(timer)
			signal.removeEventListener('abort', onAbort)
			this.#ending.signal.removeEventListener('abort', onEnding)
		}
	}

	// Subscribes before commanding and settles on the first observed verdict.
	#observe(signal: AbortSignal, timeout: number, options: GuiderObserveOptions) {
		return waitForDeviceState<GuiderUpdate>({
			signal,
			timeout,
			subscribe: (listener) => this.#subscribe(listener),
			current: () => ({ state: this.#state, closed: this.#closed }),
			evaluate: options.evaluate,
			command: options.command,
			abort: options.abort,
		})
	}

	// Acquires the guide camera and guide output for the duration of the activity, then runs the command.
	// A command that fails hands them straight back, since nothing is capturing after it.
	async #withActivity<T>(run: () => Promise<OperationResult<T>>): Promise<OperationResult<T>> {
		const acquired = await this.#acquireActivity()

		if (!acquired.ok) return acquired

		const result = await run()

		if (!result.ok) await this.#releaseActivity()

		return result
	}

	// Opens the nested scope that owns the physical devices while the guider is capturing. A remote guider
	// drives devices outside this process, so it has nothing to acquire and the activity stays implicit.
	async #acquireActivity(): Promise<OperationResult<void>> {
		if (this.#activity !== undefined) return { ok: true, value: undefined }

		const { camera, guideOutput } = this.target

		if (camera === undefined || guideOutput === undefined) return { ok: true, value: undefined }

		const started = Promise.withResolvers<OperationResult<void>>()
		const released = Promise.withResolvers<OperationResult<void>>()
		const completed = Promise.withResolvers<OperationResult<void>>()

		const activity: GuiderActivity = {
			release: async () => {
				released.resolve({ ok: true, value: undefined })
				return await completed.promise
			},
		}

		const operation = this.context.start<void>(
			'guiderActivity',
			[
				{ key: resourceKey(camera), device: camera },
				{ key: resourceKey(guideOutput), device: guideOutput },
			],
			(activityContext) => {
				// Whatever ends the activity, the guider must not be left exposing while its devices go back
				// to the arbiter: the next operation would acquire a camera another client still drives.
				activityContext.onCleanup(() => this.#quiesce())
				activityContext.signal.addEventListener('abort', () => released.resolve({ ok: false, reason: abortReason(activityContext.signal) }), { once: true })

				this.#activity = activity
				started.resolve({ ok: true, value: undefined })

				// The executor stays pending on purpose: the scope must own both devices for as long as the
				// guider is capturing, so it ends only when the activity is released or canceled.
				return released.promise
			},
		)

		void operation.result.then((result) => {
			if (this.#activity === activity) this.#activity = undefined
			completed.resolve(result)
			if (!result.ok) started.resolve(result)
		})

		return await started.promise
	}

	// Ends the activity and waits for its cleanup, so the caller only learns the devices are free once they
	// really are.
	async #releaseActivity(): Promise<OperationResult<void>> {
		const activity = this.#activity
		if (activity === undefined) return { ok: true, value: undefined }
		return await activity.release()
	}

	// Stops capture and waits for the guider to report itself idle, on a signal of its own so it still runs
	// while the operation owning the devices is being canceled.
	async #quiesce() {
		if (this.#client === undefined || this.#state === 'Stopped') return

		const settled = await waitForDeviceState<GuiderUpdate>({
			signal: UNCANCELABLE,
			timeout: this.sessionContext.options.releaseTimeout ?? DEFAULT_RELEASE_TIMEOUT,
			subscribe: (listener) => this.#subscribe(listener),
			current: () => ({ state: this.#state, closed: this.#closed }),
			evaluate: (update) => (update.closed || this.#state === 'Stopped' ? 'success' : 'pending'),
			command: () => this.#stopCapture(),
		})

		if (!settled.ok) throw new Error(`the guider did not stop: ${settled.reason}`)
	}

	// Stops capture on whichever transport is attached. A session with no transport left has nothing to
	// stop, so this is a no-op rather than a failure: it also runs from abort and cleanup paths.
	//
	// The outcome is awaited rather than discarded, so a stop the transport refuses fails its wait as a
	// failed command instead of running to timeout with the rejection unhandled. Every caller of this bounds
	// the wait itself, either through the timeout of the wait it commands or through #abortCapture.
	async #stopCapture() {
		const client = this.#client
		if (client === undefined) return
		await client.stopCapture()
	}

	// Commands a stop from an abort path, where the wait has already settled and only reaching the device
	// still matters.
	//
	// The bound is what makes awaiting the stop safe here: a remote stop awaits an RPC reply, and the very
	// reason a wait is being aborted may be the transport that will never answer it. A refusal still
	// propagates, because it means the device was not told to stop and the caller has to hear that.
	async #abortCapture() {
		await Promise.race([this.#stopCapture(), Bun.sleep(ABORT_STOP_TIMEOUT)])
	}

	// Runs a transport command; a missing transport throws so the wait settles as a failed command.
	async #dispatch(command: (client: GuiderTransport) => unknown) {
		const client = this.#client
		if (client === undefined) throw new Error('the guider is not connected')
		await command(client)
	}

	// Registers a waiter and returns its idempotent unsubscriber.
	#subscribe(listener: (update: GuiderUpdate) => void) {
		this.#listeners.add(listener)
		return () => this.#listeners.delete(listener)
	}

	// Notifies every waiter over a copy, so one that unsubscribes while settling does not disturb iteration.
	#emit(update: GuiderUpdate) {
		for (const listener of this.#listeners) listener(update)
	}

	// Accepts a callback only from the transport this session attached and only while it is still open, so
	// an event from a previous connection can never alter a newer one.
	#accepts(client: GuiderTransport) {
		return !this.#closed && client === this.#client
	}

	// Transport callbacks. Every one of them is filtered by client identity before it touches session state.
	readonly #handler = {
		event: (client: GuiderTransport, event: PHD2Events) => {
			if (!this.#accepts(client)) return
			this.#applyEvent(event)
		},
		command: (client: PHD2Client, command: PHD2Command, success: boolean, result: unknown) => {
			if (!this.#accepts(client)) return
			console.info(command.method, 'received:', success, JSON.stringify(result))
		},
		close: (client: GuiderTransport) => {
			if (!this.#accepts(client)) return
			// An unexpected close ends the whole session: the operation unwinds, the activity cleanup finds
			// nothing left to command, and every lease goes back to the arbiter.
			this.end({ ok: false, reason: 'disconnected' })
		},
	} as const

	// Maps one transport event onto the session state and publishes the resulting snapshot.
	#applyEvent(event: PHD2Events) {
		switch (event.Event) {
			case 'AppState':
				this.#state = event.State

				switch (this.#state) {
					case 'Calibrating':
						this.#publish('calibrating')
						break
					case 'Guiding':
						this.#publish('guiding')
						break
					case 'Looping':
						this.#publish('looping')
						break
					case 'LostLock':
						this.#publish('starLost')
						break
					default:
						this.#publish('idle')
						break
				}

				break
			case 'StartCalibration':
				this.#state = 'Calibrating'
				this.#publish('calibrating')
				break
			case 'CalibrationFailed':
				this.#publish()
				break
			case 'LoopingExposures':
				this.#state = 'Looping'
				this.event.starMass = event.StarMass
				this.event.snr = event.SNR
				this.event.hfd = event.HFD
				this.#publish('looping')
				break
			case 'SettleBegin':
				this.#publish('settling')
				this.#beginDitherSettle()
				break
			case 'SettleDone':
				this.#finishDither(event.Status === 0 ? { ok: true, value: undefined } : { ok: false, reason: 'alert', error: event.Error })
				break
			case 'Settling':
				this.#publish('settling')
				this.#publishDither({ phase: 'settling', guider: structuredClone(this.event) })
				break
			case 'GuideStep': {
				this.#state = 'Guiding'
				const { RADistanceRaw, DECDistanceRaw, RADuration, RADirection, DECDuration, DECDirection } = event
				const { rightAscension, declination } = this.#rms.addDataPoint(RADistanceRaw, DECDistanceRaw)
				this.event.starMass = event.StarMass
				this.event.snr = event.SNR
				this.event.hfd = event.HFD
				this.event.rmsRA = rightAscension * this.#pixelScale
				this.event.rmsDEC = declination * this.#pixelScale
				this.event.step.ra = RADistanceRaw * this.#pixelScale
				this.event.step.dec = DECDistanceRaw * this.#pixelScale
				this.event.step.raCorrection = RADirection === 'West' ? RADuration : -RADuration
				this.event.step.decCorrection = DECDirection === 'North' ? DECDuration : -DECDuration
				this.event.step.dx = null
				this.event.step.dy = null
				this.#publish('guiding')
				break
			}
			case 'GuidingDithered':
				this.#state = 'Guiding'
				this.event.step.ra = null
				this.event.step.dec = null
				this.event.step.raCorrection = null
				this.event.step.decCorrection = null
				this.event.step.dx = event.dx
				this.event.step.dy = event.dy
				this.#publish('guiding')
				this.#publishDither({ phase: 'dithered', guider: structuredClone(this.event), dx: event.dx, dy: event.dy })
				break
			case 'StarLost':
				this.#state = 'LostLock'
				this.#publish('starLost')
				break
			case 'Paused':
				this.#state = 'Paused'
				this.#publish('paused')
				break
			case 'StartGuiding':
				this.#state = 'Guiding'
				this.#publish('guiding')
				break
			case 'GuidingStopped':
			case 'LoopingExposuresStopped':
				this.#state = 'Stopped'
				this.#publish('idle')
				break
			default:
				return
		}

		this.#emit({ state: this.#state, event, closed: this.#closed })
	}

	// Applies a presentation state and fans the snapshot out.
	#publish(state?: GuiderState) {
		if (state !== undefined) this.event.state = state
		guiderBus.emit('update', structuredClone(this.event))
	}

	// Fans out one dither phase for presentation, and hands it to whoever asked for this dither.
	//
	// The bus is a broadcast of every session, so nothing that depends on the progress being its own may
	// read it. The caller gets the phase through the call it already made instead, which is why no consumer
	// has to filter the bus by session.
	#publishDither(event: GuiderDitherEvent) {
		guiderBus.emit('dither', event)
		this.#dither?.onPhase?.(event.phase)
	}

	// Creates the dither bookkeeping and arms the timer bounding the wait for SettleBegin.
	#startDither(timeout: number, signal: AbortSignal, onPhase?: (phase: GuiderDitherPhase) => void) {
		const operation: GuiderDitherOperation = {
			result: Promise.withResolvers(),
			settleStarted: Promise.withResolvers(),
			signal,
			onPhase,
			timeout,
			finished: false,
		}

		const onAbort = () => this.#finishDither({ ok: false, reason: abortReason(signal) })
		operation.onAbort = onAbort
		signal.addEventListener('abort', onAbort, { once: true })

		operation.startTimer = setTimeout(
			() => {
				if (operation.settleStartedAt === undefined) {
					operation.settleStarted.resolve(false)
					this.#finishDither({ ok: false, reason: 'timeout', error: 'the guider never began settling' })
				}
			},
			Math.max(1, timeout) * 1000,
		)

		this.#dither = operation

		return operation
	}

	// Switches the dither from waiting for SettleBegin to waiting for its terminal SettleDone.
	#beginDitherSettle() {
		const operation = this.#dither

		if (!operation || operation.finished || operation.settleStartedAt) return

		operation.settleStartedAt = performance.now()

		if (operation.startTimer) {
			clearTimeout(operation.startTimer)
			operation.startTimer = undefined
		}

		operation.settleStarted.resolve(true)
		this.#publishDither({ phase: 'settling', guider: structuredClone(this.event) })

		operation.settleTimer = setTimeout(
			() => {
				this.#finishDither({ ok: false, reason: 'timeout', error: 'the guider did not settle in time' })
			},
			Math.max(1, operation.timeout) * 1000,
		)
	}

	// Terminalizes the dither exactly once, releasing its timers, listener, and pending milestones.
	#finishDither(result: OperationResult<void>) {
		const operation = this.#dither

		if (!operation || operation.finished) return

		operation.finished = true

		if (operation.startTimer) clearTimeout(operation.startTimer)
		if (operation.settleTimer) clearTimeout(operation.settleTimer)
		if (operation.signal && operation.onAbort) operation.signal.removeEventListener('abort', operation.onAbort)

		operation.settleStarted.resolve(operation.settleStartedAt !== undefined)

		if (result.ok) this.#publishDither({ phase: 'settled', guider: structuredClone(this.event), ok: true })
		else this.#publishDither({ phase: 'settled', guider: structuredClone(this.event), ok: false, reason: result.reason, error: result.error })

		operation.result.resolve(result)
		this.#dither = undefined
	}
}

// Rolling standard deviation of the guide error on both axes, in the units of the samples it is fed.
class RMS {
	// Number of accumulated samples.
	private size = 0
	// Sum of right ascension distances.
	private sumRA = 0
	// Sum of squared right ascension distances.
	private sumRASquared = 0
	// Sum of declination distances.
	private sumDEC = 0
	// Sum of squared declination distances.
	private sumDECSquared = 0

	// Accumulates one guide step and returns the updated RMS on both axes.
	addDataPoint(raDistance: number, decDistance: number) {
		this.size++

		this.sumRA += raDistance
		this.sumRASquared += raDistance * raDistance
		this.sumDEC += decDistance
		this.sumDECSquared += decDistance * decDistance

		return this.compute()
	}

	// Removes one previously accumulated sample and returns the updated RMS.
	removeDataPoint(raDistance: number, decDistance: number) {
		this.size--

		this.sumRA -= raDistance
		this.sumRASquared -= raDistance * raDistance
		this.sumDEC -= decDistance
		this.sumDECSquared -= decDistance * decDistance

		return this.compute()
	}

	// Computes the RMS from the running sums, clamping the radicand against rounding below zero.
	private compute() {
		const { size, sumRA, sumDEC } = this
		if (size <= 0) return { rightAscension: 0, declination: 0 } as const

		const rightAscension = Math.sqrt(Math.max(0, size * this.sumRASquared - sumRA * sumRA)) / size
		const declination = Math.sqrt(Math.max(0, size * this.sumDECSquared - sumDEC * sumDEC)) / size
		return { rightAscension, declination } as const
	}

	// Drops every accumulated sample.
	clear() {
		this.size = 0
		this.sumRA = 0
		this.sumRASquared = 0
		this.sumDEC = 0
		this.sumDECSquared = 0
	}
}
