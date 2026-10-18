import { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import type { Client } from 'nebulosa/src/devices/indi/device'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { DeviceRegistry } from './devices'
import type { OperationRegistry } from './operations'
import { EphemerisUnavailableError, HorizonsEphemerisError, type SkyObserver, type SkyPosition } from './sky/ephemeris'
import type { SkyLocator } from './sky/routes'
import type { SkyObjectRef } from './sky/types'

// Physical mount commands of the Sky workspace. A slew to an object resolves the object at the server's
// real current time, never at a simulated instant, refuses targets below the observer's horizon, and runs
// through the toolkit's MountCommander, whose operation checks connection, capability, lease, driver
// alerts, timeout, and arrival, under the process-wide operation registry, so no other operation can
// hold the mount meanwhile. The HTTP response only says the command was accepted; the outcome is
// published later as an operation:updated event (kind mount.slew) from the real operation result. Every
// command addresses one device of one connection by its exact id.

// Body of POST /api/connections/:id/mounts/:deviceId/slew.
export interface MountSlewRequest {
	// Object to point at.
	readonly target: SkyObjectRef
	// Observer whose horizon the target must be above; the mount points from the same site.
	readonly observer: SkyObserver
}

// Response of an accepted slew: the coordinate commanded and where it was for the observer.
export interface MountSlewResponse {
	// Id of the slew operation, repeated by its operation:updated events.
	readonly operationId: string
	// Instant the target was resolved at, Unix milliseconds (UTC); the server's current time.
	readonly time: number
	// Commanded right ascension in radians, true equator and equinox of date (JNOW).
	readonly rightAscension: number
	// Commanded declination in radians, equinox of date.
	readonly declination: number
	// Azimuth of the target from north through east in radians, at time.
	readonly azimuth: number
	// Refracted altitude of the target in radians at time; never negative.
	readonly altitude: number
}

// Responds with an error message and a status.
function errorResponse(message: string, status: number) {
	return Response.json({ error: message }, { status })
}

// Mount commands over the devices of every open connection.
export class MountCommands implements Disposable {
	// Commander driving the mounts and observing their state.
	readonly #commander: MountCommander

	// Creates the commands over the device registry. client resolves an open connection id to its client,
	// locate resolves sky objects, and operations runs and publishes every mount operation.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: (connectionId: string) => Client | undefined,
		readonly locate: SkyLocator,
		readonly operations: OperationRegistry,
	) {
		this.#commander = new MountCommander(devices.mounts)
	}

	// Responds with the state of a mount, or 404 when the connection is not open or has no such mount.
	state(connectionId: string, deviceId: string): Response {
		const client = this.client(connectionId)
		const state = client && this.devices.mountState(client, deviceId)
		return state ? Response.json(state) : errorResponse('Mount not found', 404)
	}

	// Slews a mount to an object resolved now. Responds 202 with MountSlewResponse once the command
	// started; 404 for an unknown mount or object, 409 when the mount is disconnected, parked, or busy,
	// 422 when it cannot go to a target or the target is below the horizon, 502 when Horizons rejects the
	// target, and 503 when no provider can compute it.
	async slew(connectionId: string, deviceId: string, { target, observer }: MountSlewRequest, signal?: AbortSignal): Promise<Response> {
		const client = this.client(connectionId)
		const mount = client && this.devices.mount(client, deviceId)
		if (!mount) return errorResponse('Mount not found', 404)
		if (!mount.connected) return errorResponse('The mount is disconnected', 409)
		if (!mount.canGoTo) return errorResponse('The mount cannot go to a target', 422)
		if (mount.parked || mount.parking) return errorResponse('The mount is parked', 409)
		if (this.operations.arbiter.availability(resourceKey(mount)) !== 'available') return errorResponse('The mount is busy', 409)

		const time = Date.now()
		let position: SkyPosition | undefined

		try {
			position = await this.locate(target, { time, observer, mode: 'accurate', signal })
		} catch (error) {
			if (error instanceof EphemerisUnavailableError) return errorResponse(error.message, 503)
			if (error instanceof HorizonsEphemerisError) return errorResponse(error.message, 502)
			throw error
		}

		if (!position) return errorResponse('Object not found', 404)

		const { rightAscension, declination, azimuth, altitude } = position
		if (azimuth === undefined || altitude === undefined) return errorResponse('An observer is required', 422)
		if (altitude < 0) return errorResponse('The target is below the horizon', 422)

		const result = this.#commander.goTo(this.operations.coordinator, mount, { type: 'JNOW', JNOW: { x: rightAscension, y: declination } })
		const { operationId } = this.operations.track('mount.slew', [{ connectionId, deviceId: mount.id }], result)

		return Response.json({ operationId, time, rightAscension, declination, azimuth, altitude } satisfies MountSlewResponse, { status: 202 })
	}

	// Cancels the operation holding a mount and stops its motion, resolving once it has stopped. Responds
	// 204 when stopped, 404 for an unknown mount, and 409 when it could not be stopped.
	async stop(connectionId: string, deviceId: string): Promise<Response> {
		const client = this.client(connectionId)
		const mount = client && this.devices.mount(client, deviceId)
		if (!mount) return errorResponse('Mount not found', 404)

		await this.operations.coordinator.cancelByDevice(resourceKey(mount))
		const result = await this.#commander.stopMotion(mount)
		return result.ok ? new Response(null, { status: 204 }) : errorResponse(result.error ?? `The mount did not stop (${result.reason})`, 409)
	}

	// Stops observing the mounts; their operations belong to the operation registry.
	[Symbol.dispose]() {
		this.#commander.dispose()
	}
}
