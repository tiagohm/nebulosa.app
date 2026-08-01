import type { Camera, Cover, Device, FlatPanel, Focuser, GuideOutput, Mount, MountTargetCoordinate, Wheel } from 'nebulosa/src/devices/indi/device'
import type { CameraManager, CoverManager, FlatPanelManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { OperationResult } from '#/orchestration'
import type { CameraCommander } from './camera.commander'
import type { CoverCommander } from './cover.commander'
import type { FlatPanelCommander } from './flatpanel.commander'
import type { FocuserCommander } from './focuser.commander'
import type { GuideOutputCommander } from './guideoutput.commander'
import type { MountCommander } from './mount.commander'
import type { OperationCoordinator } from './operation'
import { abortableDelay } from './operation.wait'
import { resourceKey } from './resource'
import type { ResourceKey } from './resource'
import type { WheelCommander } from './wheel.commander'

// Coordinated device managers handed to the Alpaca server.
// The Alpaca server is a second ingress into the same hardware: it writes to the INDI managers directly,
// so a remote client could move a device the application is already using, or start an exposure over one
// that is integrating. This module wraps each manager in a proxy whose mutating methods go through the
// commanders instead, which makes every Alpaca request compete for the same resource keys as the HTTP
// routes and the composite features. Reads, listings and handler registration pass straight through.
// Alpaca has no channel for reporting an asynchronous failure: its handlers answer before the device has
// moved, and clients observe the outcome by polling state. A refused or failed command is therefore only
// logged here, and the client sees the device simply not change.
// Exposure durations are seconds, matching the Alpaca and INDI camera contracts.

// The managers the Alpaca server is given. The rotator is listed but never mutated by the server, so it
// is carried through unchanged.
export interface AlpacaManagers {
	// Cameras exposed as Alpaca camera devices.
	readonly camera: CameraManager
	// Mounts exposed as Alpaca telescope devices.
	readonly mount: MountManager
	// Focusers exposed as Alpaca focuser devices.
	readonly focuser: FocuserManager
	// Wheels exposed as Alpaca filterwheel devices.
	readonly wheel: WheelManager
	// Covers exposed as the cover half of Alpaca covercalibrator devices.
	readonly cover: CoverManager
	// Flat panels exposed as the calibrator half of Alpaca covercalibrator devices.
	readonly flatPanel: FlatPanelManager
	// Rotators exposed as Alpaca rotator devices, read-only from the server.
	readonly rotator: RotatorManager
	// Guide outputs driving the Alpaca pulse-guide commands.
	readonly guideOutput: GuideOutputManager
}

// The commanders each intercepted manager call is routed to.
export interface AlpacaCommanders {
	// Owns camera cooling.
	readonly camera: CameraCommander
	// Owns mount slewing, parking, tracking and manual motion.
	readonly mount: MountCommander
	// Owns focuser motion.
	readonly focuser: FocuserCommander
	// Owns wheel slot changes.
	readonly wheel: WheelCommander
	// Owns cover motion.
	readonly cover: CoverCommander
	// Owns flat panel light output.
	readonly flatPanel: FlatPanelCommander
	// Owns pulse guiding.
	readonly guideOutput: GuideOutputCommander
}

// Overrides for a manager, keyed by method name and keeping each method's own parameters. The Alpaca
// server ignores what these return, so an override answers immediately and reports asynchronously.
type ManagerCommands<M extends object> = { [K in keyof M]?: M[K] extends (...args: infer A) => unknown ? (...args: A) => void : never }

// Wraps a manager so the named methods are replaced and everything else reaches the real one.
// A proxy is the only workable wrapper: the managers keep their state in private class fields, so any
// pass-through function has to run with the manager itself as receiver, which is what binding to the
// target does here.
function coordinated<M extends object>(manager: M, commands: ManagerCommands<M>): M {
	return new Proxy(manager, {
		get(target, property) {
			const override = (commands as Record<string | symbol, unknown>)[property]
			if (override !== undefined) return override

			const value = Reflect.get(target, property, target) as unknown
			return typeof value === 'function' ? (value as (...args: never) => unknown).bind(target) : value
		},
	})
}

// Logs the outcome of a coordinated command, which is the only place an Alpaca failure can be seen.
function report(device: Device, action: string, result: OperationResult<unknown>) {
	if (result.ok) return
	console.error('alpaca failed to %s:', action, device.name, result.reason, result.error ?? '')
}

// Builds the coordinated view of the managers the Alpaca server writes through.
export function coordinatedAlpacaManagers(managers: AlpacaManagers, commanders: AlpacaCommanders, coordinator: OperationCoordinator): AlpacaManagers {
	// Pending coordinated commands per device, as a chain the next command is appended to.
	const queues = new Map<ResourceKey, Promise<unknown>>()

	// Runs a coordinated command without making the Alpaca caller wait for the device, after everything
	// already queued for that device.
	// Each command holds the device for as long as it runs, and one Alpaca request routinely issues
	// several in a row: the exposure handler sets the frame type before starting the exposure, and the
	// calibrator handler switches the light on before setting its brightness. Dispatched concurrently,
	// the second would compete with the first and be refused, so a device runs its commands in the order
	// the server issued them. A command arriving while another ingress owns the device is still refused,
	// since the queue only orders what Alpaca itself asked for.
	function dispatch(device: Device, action: string, command: () => Promise<OperationResult<unknown>>) {
		const key = resourceKey(device)
		const queued = (queues.get(key) ?? Promise.resolve()).then(async () => report(device, action, await command()))

		queues.set(key, queued)

		void queued.finally(() => {
			if (queues.get(key) === queued) queues.delete(key)
		})
	}

	// Applies one immediate driver setting under a short operation holding the device, so a setting meant
	// for an Alpaca exposure cannot land on a device someone else is already using.
	function configure(kind: string, device: Device, command: () => void) {
		dispatch(
			device,
			kind,
			() =>
				coordinator.start<void>(kind, [{ key: resourceKey(device), device }], () => {
					if (!device.connected) return { ok: false, reason: 'disconnected' }

					command()

					return { ok: true, value: undefined }
				}).result,
		)
	}

	// Cancels whatever owns the device and then issues the physical stop, the same order the HTTP routes
	// use: the emergency stop must reach a device that is unavailable or leased away. It never queues,
	// because what it cancels may well be the command the queue is currently waiting for.
	function stop(device: Device, command: () => OperationResult<void> | Promise<OperationResult<void>>) {
		void (async () => {
			await coordinator.cancelByResource(resourceKey(device))
			report(device, 'stop', await command())
		})()
	}

	// Builds the equatorial target of a slew or sync. Alpaca reports and accepts coordinates of the epoch
	// the mount itself uses, which is JNOW for the drivers behind these managers. Angles are radians.
	function target(rightAscension: Angle, declination: Angle): MountTargetCoordinate<Angle> {
		return { type: 'JNOW', JNOW: { x: rightAscension, y: declination } }
	}

	const camera = coordinated(managers.camera, {
		bin: (device: Camera, x: number, y: number) => configure('alpacaCameraBin', device, () => managers.camera.bin(device, x, y)),
		frame: (device: Camera, x: number, y: number, width: number, height: number) => configure('alpacaCameraFrame', device, () => managers.camera.frame(device, x, y, width, height)),
		frameFormat: (device: Camera, value: string) => configure('alpacaCameraFrameFormat', device, () => managers.camera.frameFormat(device, value)),
		frameType: (device: Camera, value: Parameters<CameraManager['frameType']>[1]) => configure('alpacaCameraFrameType', device, () => managers.camera.frameType(device, value)),
		gain: (device: Camera, value: number) => configure('alpacaCameraGain', device, () => managers.camera.gain(device, value)),
		offset: (device: Camera, value: number) => configure('alpacaCameraOffset', device, () => managers.camera.offset(device, value)),
		cooler: (device: Camera, enabled: boolean) => dispatch(device, 'switch the cooler', () => commanders.camera.cooler(coordinator, device, enabled)),
		temperature: (device: Camera, value: number) => dispatch(device, 'set the temperature', () => commanders.camera.temperature(coordinator, device, value)),

		// The Alpaca client owns the frame it is exposing: it polls ImageReady and fetches the bytes
		// itself, so no capture session is started here. The camera is held for the exposure window
		// instead, which is what keeps an application capture from starting over a sensor that is
		// integrating for someone else. The download that follows is not covered by the lease, and
		// cancelling the operation is what tells the driver to abort the exposure.
		startExposure: (device: Camera, exposureTimeInSeconds: number) =>
			dispatch(
				device,
				'expose',
				() =>
					coordinator.start<void>('alpacaExposure', [{ key: resourceKey(device), device }], async (context) => {
						if (!device.connected) return { ok: false, reason: 'disconnected' }

						context.onCleanup(() => {
							if (context.signal.aborted) managers.camera.stopExposure(device)
						})

						managers.camera.startExposure(device, exposureTimeInSeconds)

						return await abortableDelay(exposureTimeInSeconds * 1000, context.signal)
					}).result,
			),

		stopExposure: (device: Camera) =>
			stop(device, () => {
				managers.camera.stopExposure(device)
				return { ok: true, value: undefined }
			}),
	})

	const mount = coordinated(managers.mount, {
		goTo: (device: Mount, rightAscension: Angle, declination: Angle) => dispatch(device, 'slew', () => commanders.mount.goTo(coordinator, device, target(rightAscension, declination))),
		syncTo: (device: Mount, rightAscension: Angle, declination: Angle) => dispatch(device, 'sync', () => commanders.mount.sync(coordinator, device, target(rightAscension, declination))),
		tracking: (device: Mount, enabled: boolean) => dispatch(device, 'change the tracking', () => commanders.mount.setTracking(coordinator, device, enabled)),
		trackMode: (device: Mount, mode: Parameters<MountManager['trackMode']>[1]) => dispatch(device, 'change the track mode', () => commanders.mount.setTrackMode(coordinator, device, mode)),
		geographicCoordinate: (device: Mount, coordinate: Parameters<MountManager['geographicCoordinate']>[1]) => dispatch(device, 'change the site', () => commanders.mount.setGeographicCoordinate(coordinator, device, coordinate)),
		time: (device: Mount, value: Parameters<MountManager['time']>[1]) => dispatch(device, 'change the time', () => commanders.mount.setTime(coordinator, device, value)),
		park: (device: Mount) => dispatch(device, 'park', () => commanders.mount.park(coordinator, device)),
		unpark: (device: Mount) => dispatch(device, 'unpark', () => commanders.mount.unpark(coordinator, device)),
		setPark: (device: Mount) => dispatch(device, 'set the park position', () => commanders.mount.setPark(coordinator, device)),
		findHome: (device: Mount) => dispatch(device, 'find home', () => commanders.mount.findHome(coordinator, device)),
		moveNorth: (device: Mount, enabled: boolean) => dispatch(device, 'move north', () => commanders.mount.manualMove(coordinator, device, 'NORTH', enabled)),
		moveSouth: (device: Mount, enabled: boolean) => dispatch(device, 'move south', () => commanders.mount.manualMove(coordinator, device, 'SOUTH', enabled)),
		moveWest: (device: Mount, enabled: boolean) => dispatch(device, 'move west', () => commanders.mount.manualMove(coordinator, device, 'WEST', enabled)),
		moveEast: (device: Mount, enabled: boolean) => dispatch(device, 'move east', () => commanders.mount.manualMove(coordinator, device, 'EAST', enabled)),
		stop: (device: Mount) => stop(device, () => commanders.mount.stopMotion(device)),
	})

	const focuser = coordinated(managers.focuser, {
		moveTo: (device: Focuser, position: number) => dispatch(device, 'move', () => commanders.focuser.moveTo(coordinator, device, position)),
		moveIn: (device: Focuser, steps: number) => dispatch(device, 'move in', () => commanders.focuser.moveIn(coordinator, device, steps)),
		moveOut: (device: Focuser, steps: number) => dispatch(device, 'move out', () => commanders.focuser.moveOut(coordinator, device, steps)),
		reverse: (device: Focuser, enabled: boolean) => dispatch(device, 'reverse', () => commanders.focuser.reverse(coordinator, device, enabled)),
		stop: (device: Focuser) => stop(device, () => commanders.focuser.stopMotion(device)),
	})

	const wheel = coordinated(managers.wheel, {
		moveTo: (device: Wheel, slot: number) => dispatch(device, 'move', () => commanders.wheel.moveTo(coordinator, device, slot)),
	})

	const cover = coordinated(managers.cover, {
		park: (device: Cover) => dispatch(device, 'park', () => commanders.cover.park(coordinator, device)),
		unpark: (device: Cover) => dispatch(device, 'unpark', () => commanders.cover.unpark(coordinator, device)),
		stop: (device: Cover) => stop(device, () => commanders.cover.stopMotion(device)),
	})

	const flatPanel = coordinated(managers.flatPanel, {
		enable: (device: FlatPanel) => dispatch(device, 'switch the light on', () => commanders.flatPanel.enable(coordinator, device)),
		disable: (device: FlatPanel) => dispatch(device, 'switch the light off', () => commanders.flatPanel.disable(coordinator, device)),
		intensity: (device: FlatPanel, value: number) => dispatch(device, 'change the brightness', () => commanders.flatPanel.intensity(coordinator, device, value)),
	})

	const guideOutput = coordinated(managers.guideOutput, {
		pulse: (device: GuideOutput, direction: Parameters<GuideOutputManager['pulse']>[1], duration: number) => dispatch(device, 'pulse', () => commanders.guideOutput.pulse(coordinator, device, direction, duration)),
	})

	return { camera, mount, focuser, wheel, cover, flatPanel, rotator: managers.rotator, guideOutput }
}
