import { angularDistance } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import type { GPS, Mount, MountTargetCoordinate, NameAndLabel, PierSide, TrackMode } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, MountManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { errorMessage, makeTime } from 'src/api/util'
import { coordinateInfo } from '#/mount'
import { isDeviceQuiescent } from './device.lifecycle'
import type { OperationContext, OperationResult, OperationScope } from './operation'
import { abortReason, waitForDeviceState } from './operation.wait'
import { resourceKey } from './resource'
import type { ResourceKey } from './resource'

// Axis direction of an open-ended manual motion. North/south and west/east are independent INDI vectors,
// so one direction of each pair may be active at the same time.
export type MountMoveDirection = 'NORTH' | 'SOUTH' | 'WEST' | 'EAST'

// Timing and precision overrides for one mount command; every duration is in milliseconds.
export interface MountCommandOptions {
	// Maximum time the commanded state may take to be observed.
	readonly timeout?: number
	// Angular distance, in radians, under which the mount already counts as pointing at the target.
	readonly tolerance?: Angle
	// Angular distance, in radians, within which a slew that has stopped counts as having arrived. This is
	// not a pointing-accuracy budget: the comparison is against the coordinate the mount itself reports,
	// which matches the commanded target once it believes it arrived. It exists to catch a slew that
	// stopped somewhere else entirely, so it is deliberately loose enough never to fail a normal arrival.
	readonly arrivalTolerance?: Angle
	// Maximum time a physical stop has to bring the mount back to quiescence.
	readonly settleTimeout?: number
}

// State observed once a slew has come to a stop.
export interface MountSlewResult {
	// Final right ascension in radians, in the equinox of date.
	readonly rightAscension: Angle
	// Final declination in radians, in the equinox of date.
	readonly declination: Angle
	// Pier side reported after the slew, or NEITHER when the driver does not publish one.
	readonly pierSide: PierSide
}

// Outcome of a meridian flip, carrying the evidence that the mount really changed sides.
export interface MountFlipResult extends MountSlewResult {
	// Pier side observed immediately before the flip was commanded.
	readonly initialPierSide: PierSide
	// True only when the driver publishes a pier side and it actually changed. A flip on a driver without
	// pier side still slews, but nothing here proves the mechanical side changed.
	readonly pierSideVerified: boolean
}

// Live manual motion. The operation scope, and therefore the mount lease, stays open until every axis has
// been stopped, so no other operation can take the mount while it is still moving.
export interface ManualMoveHandle {
	// Identifier of the operation holding the mount for this motion.
	readonly id: string
	// Directions currently commanded, in the order they were started.
	readonly directions: () => readonly MountMoveDirection[]
	// Starts or stops one direction. Stopping the last active direction ends the motion and resolves only
	// after the mount has been observed to stop.
	readonly move: (direction: MountMoveDirection, enabled: boolean) => Promise<OperationResult<void>>
	// Stops every direction and resolves after the mount has come to a stop and the lease is released.
	readonly stop: () => Promise<OperationResult<void>>
}

// One observed mount transition. The device is passed live rather than snapshotted because evaluation
// always reads the newest values, and the property/state pair is what carries an INDI Alert.
interface MountUpdate {
	// Device the update came from.
	readonly mount: Mount
	// Field that changed, absent when the update is a poll of the current state.
	readonly property?: keyof Mount & string
	// INDI state published with the change, absent when the update is a poll of the current state.
	readonly state?: PropertyState
}

// Mutable bookkeeping of one open-ended manual motion, retained per mount so the direct endpoints, which
// only carry a device id and a boolean, can reach the motion that a previous request started.
interface ManualMove {
	// Public handle of the motion.
	readonly handle: ManualMoveHandle
	// Directions currently commanded on the device.
	readonly directions: Set<MountMoveDirection>
}

// Default milliseconds a slew, a flip, or a homing move has to complete.
const DEFAULT_SLEW_TIMEOUT = 600000

// Default milliseconds a switch echo, such as tracking, has to be observed.
const DEFAULT_SWITCH_TIMEOUT = 10000

// Default milliseconds a physical stop has to bring the mount back to quiescence.
const DEFAULT_SETTLE_TIMEOUT = 30000

// Default angular tolerance for treating the mount as already pointing at the target.
const DEFAULT_TOLERANCE = (1 / 60) * DEG2RAD

// Default angular tolerance for accepting that a slew which stopped actually reached its target.
const DEFAULT_ARRIVAL_TOLERANCE = DEG2RAD

// Properties whose Alert state means the commanded motion itself failed. An Alert on an unrelated vector,
// such as the site time, must not fail a slew that is otherwise progressing.
const SLEW_PROPERTIES = new Set<string>(['equatorialCoordinate', 'slewing', 'parked', 'parking'])

// Direction that shares an axis with each one. TELESCOPE_MOTION_NS and TELESCOPE_MOTION_WE are AtMostOne
// switches, so commanding one direction is what turns its opposite off at the driver.
const OPPOSITE_DIRECTION: Record<MountMoveDirection, MountMoveDirection> = {
	NORTH: 'SOUTH',
	SOUTH: 'NORTH',
	WEST: 'EAST',
	EAST: 'WEST',
}

// Signal for physical stops issued while the owning operation is already being canceled. Cleanup cannot
// inherit the operation signal, which is aborted by then, and would never send the command it exists for.
const UNCANCELABLE = new AbortController().signal

// Owns every mutation of a mount and turns the ones with a physical effect into awaitable operations.
//
// Each command opens its own nested scope holding the mount, so a direct endpoint runs it as a whole
// operation tree while a composite feature, passing its own context, inherits the mount it already owns
// and gets cancellation and cleanup that do not disturb the feature around it.
export class MountCommander implements DeviceHandler<Mount> {
	// Waiters per device, fed by the manager callbacks. A mount can be observed by several waits at once,
	// such as a slew and the settle of a manual motion that is being canceled.
	readonly #listeners = new Map<Mount, Set<(update: MountUpdate) => void>>()
	// Open manual motion per physical mount, at most one, since a second one would only conflict with the
	// lease the first already holds.
	readonly #manualMoves = new Map<ResourceKey, ManualMove>()

	// Registers the commander as a mount observer so waits settle on device events instead of polling.
	constructor(readonly mountManager: MountManager) {
		mountManager.addHandler(this)
	}

	// Required by the manager contract; discovery is published by MountHandler.
	added() {}

	// Feeds every waiter observing the device, which is how a slew learns it finished or hit an Alert.
	updated(mount: Mount, property: keyof Mount & string, state?: PropertyState) {
		this.#emit({ mount, property, state })
	}

	// Wakes every waiter so it reevaluates; removal is reported as a disconnected device by evaluation,
	// and the operation itself is canceled independently by DeviceLifecycle.
	removed(mount: Mount) {
		this.#emit({ mount })
	}

	// Slews to a target and resolves only after the mount has stopped there, or after it has been stopped.
	async goTo(scope: OperationScope, mount: Mount, target: MountTargetCoordinate<string | Angle>, options: MountCommandOptions = {}): Promise<OperationResult<MountSlewResult>> {
		return await scope.start<MountSlewResult>('mountGoTo', [{ key: resourceKey(mount), device: mount }], async (context) => {
			if (!mount.canGoTo) return unsupported(mount, 'go to a target')

			const [rightAscension, declination] = resolveTarget(mount, target)
			const slewed = await this.#slew(context, mount, rightAscension, declination, 'goto', options)

			return slewed.ok ? { ok: true, value: slewResult(mount) } : slewed
		}).result
	}

	// Flips to a target across the meridian and reports whether the pier side change could be confirmed.
	async flip(scope: OperationScope, mount: Mount, target: MountTargetCoordinate<string | Angle>, options: MountCommandOptions = {}): Promise<OperationResult<MountFlipResult>> {
		return await scope.start<MountFlipResult>('mountFlip', [{ key: resourceKey(mount), device: mount }], async (context) => {
			if (!mount.canFlip) return unsupported(mount, 'flip')

			const initialPierSide = mount.pierSide
			const [rightAscension, declination] = resolveTarget(mount, target)
			const slewed = await this.#slew(context, mount, rightAscension, declination, 'flip', options)

			if (!slewed.ok) return slewed

			// A driver without pier side can still perform the movement, but nothing it publishes proves the
			// mount changed sides, so the flip is reported as unverified instead of being failed. The side
			// before the flip has to be known as well: going from NEITHER to WEST may only be the driver
			// reporting a side for the first time, which is not evidence that anything changed.
			const pierSideVerified = mount.hasPierSide && initialPierSide !== 'NEITHER' && mount.pierSide !== 'NEITHER' && mount.pierSide !== initialPierSide

			return { ok: true, value: { ...slewResult(mount), initialPierSide, pierSideVerified } }
		}).result
	}

	// Redefines the mount's idea of where it is pointing. The driver applies it without any movement, so
	// there is no observable transition to wait for.
	async sync(scope: OperationScope, mount: Mount, target: MountTargetCoordinate<string | Angle>): Promise<OperationResult<void>> {
		return await scope.start<void>('mountSync', [{ key: resourceKey(mount), device: mount }], () => {
			if (!mount.canSync) return unsupported(mount, 'sync')

			const [rightAscension, declination] = resolveTarget(mount, target)
			this.mountManager.syncTo(mount, rightAscension, declination)

			return { ok: true, value: undefined }
		}).result
	}

	// Enables or disables tracking and resolves only after the mount reports the requested state, so a
	// composite operation never starts its next step against a mount that silently ignored the switch.
	async setTracking(scope: OperationScope, mount: Mount, enabled: boolean, options: MountCommandOptions = {}): Promise<OperationResult<void>> {
		return await scope.start<void>('mountTracking', [{ key: resourceKey(mount), device: mount }], async (context) => {
			if (!mount.canTracking) return unsupported(mount, 'change tracking')

			const observed = await waitForDeviceState<MountUpdate>({
				signal: context.signal,
				timeout: options.timeout ?? DEFAULT_SWITCH_TIMEOUT,
				subscribe: (listener) => this.#subscribe(mount, listener),
				current: () => ({ mount }),
				evaluate: (update) => {
					if (!mount.connected) return 'disconnected'
					if (update.state === 'Alert' && update.property === 'tracking') return 'alert'
					return mount.tracking === enabled ? 'success' : 'pending'
				},
				command: () => this.mountManager.tracking(mount, enabled),
			})

			return observed.ok ? { ok: true, value: undefined } : observed
		}).result
	}

	// Parks the mount and resolves once parking has finished.
	async park(scope: OperationScope, mount: Mount, options: MountCommandOptions = {}): Promise<OperationResult<void>> {
		return await this.#parkable(scope, 'mountPark', mount, true, options)
	}

	// Unparks the mount and resolves once it reports itself unparked.
	async unpark(scope: OperationScope, mount: Mount, options: MountCommandOptions = {}): Promise<OperationResult<void>> {
		return await this.#parkable(scope, 'mountUnpark', mount, false, options)
	}

	// Moves to the configured home position and resolves once homing has finished.
	async home(scope: OperationScope, mount: Mount, options: MountCommandOptions = {}): Promise<OperationResult<void>> {
		return await this.#homing(
			scope,
			'mountHome',
			mount,
			(device) => this.mountManager.home(device),
			() => mount.canHome,
			options,
		)
	}

	// Searches for the mechanical home position and resolves once homing has finished.
	async findHome(scope: OperationScope, mount: Mount, options: MountCommandOptions = {}): Promise<OperationResult<void>> {
		return await this.#homing(
			scope,
			'mountFindHome',
			mount,
			(device) => this.mountManager.findHome(device),
			() => mount.canFindHome,
			options,
		)
	}

	// Stores the current position as the home position.
	async setHome(scope: OperationScope, mount: Mount): Promise<OperationResult<void>> {
		return await this.#mutate(
			scope,
			'mountSetHome',
			mount,
			() => mount.canSetHome,
			'set the home position',
			() => this.mountManager.setHome(mount),
		)
	}

	// Stores the current position as the park position.
	async setPark(scope: OperationScope, mount: Mount): Promise<OperationResult<void>> {
		return await this.#mutate(
			scope,
			'mountSetPark',
			mount,
			() => mount.canSetPark,
			'set the park position',
			() => this.mountManager.setPark(mount),
		)
	}

	// Selects the tracking rate applied while the mount is tracking.
	async setTrackMode(scope: OperationScope, mount: Mount, mode: TrackMode): Promise<OperationResult<void>> {
		return await this.#mutate(
			scope,
			'mountTrackMode',
			mount,
			() => mount.canTracking,
			'change the track mode',
			() => this.mountManager.trackMode(mount, mode),
		)
	}

	// Selects the speed preset used by manual motion.
	async setSlewRate(scope: OperationScope, mount: Mount, rate: NameAndLabel | string): Promise<OperationResult<void>> {
		return await this.#mutate(
			scope,
			'mountSlewRate',
			mount,
			() => true,
			'change the slew rate',
			() => this.mountManager.slewRate(mount, rate),
		)
	}

	// Writes the observing site the mount computes its pointing from.
	async setGeographicCoordinate(scope: OperationScope, mount: Mount, coordinate: GeographicCoordinate): Promise<OperationResult<void>> {
		return await this.#mutate(
			scope,
			'mountLocation',
			mount,
			() => true,
			'change the location',
			() => this.mountManager.geographicCoordinate(mount, coordinate),
		)
	}

	// Writes the mount clock, which its pointing model depends on.
	async setTime(scope: OperationScope, mount: Mount, time: GPS['time']): Promise<OperationResult<void>> {
		return await this.#mutate(
			scope,
			'mountTime',
			mount,
			() => true,
			'change the time',
			() => this.mountManager.time(mount, time),
		)
	}

	// Starts an open-ended motion in one direction, or joins the motion already holding the mount.
	//
	// Unlike every other command, the returned handle outlives this call: the scope stays open, and the
	// mount stays leased, until the motion is stopped.
	async startManualMove(scope: OperationScope, mount: Mount, direction: MountMoveDirection, options: MountCommandOptions = {}): Promise<OperationResult<ManualMoveHandle>> {
		// Capabilities are only published while the device is connected, so a disconnected mount would
		// otherwise be reported as one that cannot move at all.
		if (!mount.connected) return { ok: false, reason: 'disconnected' } as const
		if (!mount.canMove) return unsupported(mount, 'move manually')

		const key = resourceKey(mount)
		const active = this.#manualMoves.get(key)

		// North/south and west/east are independent axes, so a second direction joins the open motion. A
		// second scope would only be refused by the lease the first one already holds.
		if (active !== undefined) {
			const moved = await active.handle.move(direction, true)
			return moved.ok ? { ok: true, value: active.handle } : moved
		}

		const directions = new Set<MountMoveDirection>()
		const stopped = Promise.withResolvers<OperationResult<void>>()
		const started = Promise.withResolvers<OperationResult<ManualMoveHandle>>()

		const operation = scope.start<void>('mountManualMove', [{ key, device: mount }], (context) => {
			const move = async (direction: MountMoveDirection, enabled: boolean): Promise<OperationResult<void>> => {
				if (context.signal.aborted) return { ok: false, reason: 'aborted', error: 'manual move is no longer running' }
				if (!mount.connected) return { ok: false, reason: 'disconnected' }
				if (directions.has(direction) === enabled) return { ok: true, value: undefined }

				try {
					this.#commandMove(mount, direction, enabled)
				} catch (error) {
					// A transport that cannot send leaves the axis in an unknown state, and no later request
					// would end a motion the caller never learned had started. Ending the operation here is
					// what keeps a failed send from holding the mount for the rest of the process, and it
					// also keeps the failure inside the result contract instead of rejecting the caller.
					const failure = { ok: false, reason: 'commandFailed', error: errorMessage(error) } as const
					stopped.resolve(failure)
					await operation.result
					return failure
				}

				if (enabled) {
					// The axis now moves the other way, so the direction it replaced is no longer commanded.
					// Keeping it would leave an entry nothing will ever turn off, and the motion would go on
					// holding the mount waiting for a request that has no reason to arrive.
					directions.delete(OPPOSITE_DIRECTION[direction])
					directions.add(direction)
					return { ok: true, value: undefined }
				}

				directions.delete(direction)

				// The last direction ending ends the motion itself, and its cleanup is what waits for the
				// mount to stop, so the caller only learns the axis stopped once the lease is gone.
				if (directions.size > 0) return { ok: true, value: undefined }

				stopped.resolve({ ok: true, value: undefined })
				return await operation.result
			}

			const handle: ManualMoveHandle = Object.freeze({
				id: context.id,
				directions: () => [...directions],
				move,
				stop: async () => {
					stopped.resolve({ ok: true, value: undefined })
					return await operation.result
				},
			})

			this.#manualMoves.set(key, { handle, directions })

			context.onCleanup(async () => {
				if (this.#manualMoves.get(key)?.handle === handle) this.#manualMoves.delete(key)
				await this.#stopManualMotion(mount, directions, options)
			})

			// Cancellation aborts the signal but still waits for the executor to return, so the motion has to
			// end itself here; nothing else would ever resolve the promise below.
			context.signal.addEventListener('abort', () => stopped.resolve({ ok: false, reason: abortReason(context.signal) }), { once: true })

			started.resolve({ ok: true, value: handle })

			// The executor stays pending on purpose: the scope must hold the mount for as long as any axis
			// is moving, so it ends only when the motion is stopped or the operation is canceled.
			return stopped.promise
		})

		// A scope refused for busy or disconnected devices never runs its executor, so the failure has to
		// be taken from the operation itself.
		void operation.result.then((result) => {
			if (!result.ok) started.resolve(result)
		})

		const moved = await started.promise

		if (moved.ok) {
			const first = await moved.value.move(direction, true)
			if (!first.ok) return first
		}

		return moved
	}

	// Applies the direct move endpoints, which carry only a device and a boolean, to the open motion.
	async manualMove(scope: OperationScope, mount: Mount, direction: MountMoveDirection, enabled: boolean, options: MountCommandOptions = {}): Promise<OperationResult<void>> {
		if (enabled) {
			const started = await this.startManualMove(scope, mount, direction, options)
			return started.ok ? { ok: true, value: undefined } : started
		}

		const active = this.#manualMoves.get(resourceKey(mount))

		// Stopping a direction nobody started is what a client does when it releases a button after the
		// motion has already ended, so it is not an error.
		return active === undefined ? { ok: true, value: undefined } : await active.handle.move(direction, false)
	}

	// Returns the open manual motion of a mount, if any.
	manualMoveOf(mount: Mount) {
		return this.#manualMoves.get(resourceKey(mount))?.handle
	}

	// Stops every physical motion of a mount and waits for it to become quiescent.
	//
	// This is the one command that does not acquire the mount. It is the emergency stop, used both by the
	// stop endpoint and by the abort path of every wait here, and it exists precisely for the states in
	// which acquisition is impossible: a moving mount is unavailable to the arbiter, and a mount moving
	// under someone else's operation is leased away. Refusing to stop it in either case would leave the
	// only command that can make the device safe unreachable.
	async stopMotion(mount: Mount, options: MountCommandOptions = {}): Promise<OperationResult<void>> {
		if (!mount.connected) return { ok: false, reason: 'disconnected' }
		if (!mount.canAbort) return unsupported(mount, 'abort motion')

		return await this.#settle(mount, () => this.mountManager.stop(mount), options)
	}

	// Physical stop issued whenever a command concludes unsuccessfully, including a failure the driver
	// itself reported. A disconnected mount is not moving under our command any more and cannot be sent
	// anything, so only a mount that stays in motion is reported as a cleanup failure.
	async #abortMotion(mount: Mount, options: MountCommandOptions) {
		if (!mount.connected) return

		const result = await this.stopMotion(mount, options)

		if (!result.ok) throw new Error(`mount ${mount.name} did not stop: ${result.reason}`)
	}

	// Sends the goto or flip command and waits for the mount to reach the target and stop moving.
	async #slew(context: OperationContext, mount: Mount, rightAscension: Angle, declination: Angle, mode: 'goto' | 'flip', options: MountCommandOptions) {
		if (mount.parked) return { ok: false, reason: 'unexpectedState', error: `mount ${mount.name} is parked` } as const

		const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
		const arrivalTolerance = options.arrivalTolerance ?? DEFAULT_ARRIVAL_TOLERANCE
		let moving = false

		const slewed = await waitForDeviceState<MountUpdate>({
			signal: context.signal,
			timeout: options.timeout ?? DEFAULT_SLEW_TIMEOUT,
			subscribe: (listener) => this.#subscribe(mount, listener),
			current: () => ({ mount }),
			evaluate: (update) => {
				if (!mount.connected) return 'disconnected'
				if (update.state === 'Alert' && update.property !== undefined && SLEW_PROPERTIES.has(update.property)) return 'alert'

				if (mount.slewing) {
					// Movement was observed, so the slew is only complete once it stops again. Without this the
					// gap between the command and the driver raising its busy state would read as success.
					moving = true
					return 'pending'
				}

				// Movement ended. Whether it ended at the target is decided after the wait, not here: the
				// driver publishes the coordinate and the busy state in one vector, and the manager applies
				// the state first, so the position read at this instant can still be the previous one.
				if (moving) return 'success'

				// A mount that never moved is only done if it was already pointing at the target; anything
				// else means the driver has not started yet.
				return separation(mount, rightAscension, declination) <= tolerance ? 'success' : 'pending'
			},
			command: () => {
				if (mode === 'flip') this.mountManager.flipTo(mount, rightAscension, declination)
				else this.mountManager.goTo(mount, rightAscension, declination)
			},
			abort: () => this.#abortMotion(mount, options),
		})

		if (!slewed.ok || !moving) return slewed

		// A mount that moved and stopped has not necessarily arrived: a limit, a park, or an abort issued
		// outside this operation also stops it, and no driver is required to publish an Alert for any of
		// them. Only the final position tells the difference, and it is reliable here because the rest of
		// the update that ended the movement has been applied before this continuation runs.
		const separated = separation(mount, rightAscension, declination)

		if (separated <= arrivalTolerance) return slewed

		return { ok: false, reason: 'unexpectedState', error: `mount ${mount.name} stopped ${(separated / DEG2RAD).toFixed(3)}° short of the target` } as const
	}

	// Commands parking or unparking and waits for the parked flag to settle.
	async #parkable(scope: OperationScope, kind: string, mount: Mount, parked: boolean, options: MountCommandOptions) {
		return await scope.start<void>(kind, [{ key: resourceKey(mount), device: mount }], async (context) => {
			if (!mount.canPark) return unsupported(mount, 'park')

			const observed = await waitForDeviceState<MountUpdate>({
				signal: context.signal,
				timeout: options.timeout ?? DEFAULT_SLEW_TIMEOUT,
				subscribe: (listener) => this.#subscribe(mount, listener),
				current: () => ({ mount }),
				evaluate: (update) => {
					if (!mount.connected) return 'disconnected'
					if (update.state === 'Alert' && update.property === 'parking') return 'alert'
					return mount.parked === parked && !mount.parking ? 'success' : 'pending'
				},
				command: () => (parked ? this.mountManager.park(mount) : this.mountManager.unpark(mount)),
				abort: () => this.#abortMotion(mount, options),
			})

			return observed.ok ? { ok: true, value: undefined } : observed
		}).result
	}

	// Commands a homing move and waits for the mount to finish it.
	async #homing(scope: OperationScope, kind: string, mount: Mount, command: (mount: Mount) => void, supported: () => boolean, options: MountCommandOptions) {
		return await scope.start<void>(kind, [{ key: resourceKey(mount), device: mount }], async (context) => {
			if (!supported()) return unsupported(mount, 'home')
			if (mount.parked) return { ok: false, reason: 'unexpectedState', error: `mount ${mount.name} is parked` }

			let homing = false

			const observed = await waitForDeviceState<MountUpdate>({
				signal: context.signal,
				timeout: options.timeout ?? DEFAULT_SLEW_TIMEOUT,
				subscribe: (listener) => this.#subscribe(mount, listener),
				current: () => ({ mount }),
				evaluate: (update) => {
					if (!mount.connected) return 'disconnected'
					if (update.state === 'Alert' && update.property === 'homing') return 'alert'

					if (mount.homing) {
						homing = true
						return 'pending'
					}

					return homing ? 'success' : 'pending'
				},
				command: () => command(mount),
				abort: () => this.#abortMotion(mount, options),
			})

			return observed.ok ? { ok: true, value: undefined } : observed
		}).result
	}

	// Runs a mutation that has no observable completion under a scope owning the mount, so it cannot be
	// interleaved with a slew or with any other operation already holding the device.
	async #mutate(scope: OperationScope, kind: string, mount: Mount, supported: () => boolean, description: string, command: VoidFunction): Promise<OperationResult<void>> {
		return await scope.start<void>(kind, [{ key: resourceKey(mount), device: mount }], () => {
			if (!supported()) return unsupported(mount, description)

			command()

			return { ok: true, value: undefined }
		}).result
	}

	// Releases every commanded direction and waits for the mount to stop, escalating to the abort switch
	// when clearing the motion vectors alone did not bring it to a stop.
	async #stopManualMotion(mount: Mount, directions: Set<MountMoveDirection>, options: MountCommandOptions) {
		const commanded = [...directions]
		directions.clear()

		if (!mount.connected) return

		const released = await this.#settle(
			mount,
			() => {
				for (const direction of commanded) this.#commandMove(mount, direction, false)
			},
			options,
		)

		if (released.ok) return

		const aborted = await this.stopMotion(mount, options)
		if (!aborted.ok) throw new Error(`mount ${mount.name} did not stop: ${aborted.reason}`)
	}

	// Sends a stop command and waits for the mount to report no motion, on a signal of its own so it still
	// runs while the operation that owns the mount is being canceled.
	async #settle(mount: Mount, command: VoidFunction, options: MountCommandOptions): Promise<OperationResult<void>> {
		const settled = await waitForDeviceState<MountUpdate>({
			signal: UNCANCELABLE,
			timeout: options.settleTimeout ?? DEFAULT_SETTLE_TIMEOUT,
			subscribe: (listener) => this.#subscribe(mount, listener),
			current: () => ({ mount }),
			// Quiescence is the same condition the arbiter uses to decide the mount is acquirable again, so
			// it covers homing, parking, and pulse guiding, which drivers report independently of slewing.
			// A disconnected mount is not moving under our command any more, and nothing further will ever
			// be reported by a device that stopped talking.
			evaluate: () => (!mount.connected || isDeviceQuiescent(mount) ? 'success' : 'pending'),
			command,
		})

		return settled.ok ? { ok: true, value: undefined } : settled
	}

	// Sends one axis-motion switch.
	#commandMove(mount: Mount, direction: MountMoveDirection, enabled: boolean) {
		if (direction === 'NORTH') this.mountManager.moveNorth(mount, enabled)
		else if (direction === 'SOUTH') this.mountManager.moveSouth(mount, enabled)
		else if (direction === 'WEST') this.mountManager.moveWest(mount, enabled)
		else this.mountManager.moveEast(mount, enabled)
	}

	// Registers a waiter for one device and returns its idempotent unsubscriber.
	#subscribe(mount: Mount, listener: (update: MountUpdate) => void) {
		let listeners = this.#listeners.get(mount)

		if (listeners === undefined) {
			listeners = new Set()
			this.#listeners.set(mount, listeners)
		}

		listeners.add(listener)

		return () => {
			const current = this.#listeners.get(mount)

			if (current?.delete(listener) && current.size === 0) this.#listeners.delete(mount)
		}
	}

	// Notifies the waiters of one device, over a copy so a waiter that unsubscribes while settling does
	// not disturb the iteration.
	#emit(update: MountUpdate) {
		const listeners = this.#listeners.get(update.mount)
		if (listeners === undefined) return
		for (const listener of listeners) listener(update)
	}
}

// Converts a target expressed in any supported frame into the equinox-of-date coordinate the mount
// commands take, using the site and clock the mount itself reports.
function resolveTarget(mount: Mount, target: MountTargetCoordinate<string | Angle>) {
	return coordinateInfo(makeTime('now', mount.geographicCoordinate), mount.geographicCoordinate.longitude, target, { equatorial: true, equatorialJ2000: true }).equatorial
}

// Angular distance in radians between where the mount points and the requested target.
function separation(mount: Mount, rightAscension: Angle, declination: Angle) {
	return angularDistance(mount.equatorialCoordinate.rightAscension, mount.equatorialCoordinate.declination, rightAscension, declination)
}

// Snapshots where the mount ended up after a movement.
function slewResult(mount: Mount): MountSlewResult {
	const { rightAscension, declination } = mount.equatorialCoordinate
	return { rightAscension, declination, pierSide: mount.pierSide }
}

// Reports a capability the driver does not expose as an expected failure rather than an exception.
function unsupported(mount: Mount, action: string) {
	return { ok: false, reason: 'unexpectedState', error: `mount ${mount.name} cannot ${action}` } as const
}
