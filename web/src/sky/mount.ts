import type { MountSlewResponse, MountState, OperationRecord, SkyObjectRef, SkyObserver } from 'api'
import { proxy } from 'valtio'
import { type ControlRuntime, watchedDeviceState } from '../equipment-control/control'
import { deviceUrl, jsonInit, responseError } from '../http'
import { type OperationsState, runningOn } from '../operations'
import { multiplyMatrixVector, writeEquatorialToHorizontalMatrix, writeRaDecUnitVector } from './celestial/geometry'
import type { ObserverLocation } from './celestial/types'
import type { SkySelection } from './sky'

// Mount runtime of the tab for the Sky workspace: the one mount the active profile assigns to the MOUNT role on its
// open server connection, the slews this tab started on it, and whether the map follows it. Its real state is the one
// the control runtime mirrors (mountView), never fetched apart. The mount is addressed by its server connection id
// and exact device id, and switching profile or connection drops everything known about the previous mount. Positions
// only come from the server; a mount without a reported state has no position. Slew targets are resolved by the
// server at its real current time, never at the Sky simulation clock's instant.

// Mount followed by the runtime.
export interface MountTarget {
	// Id of the open server connection that provides the mount.
	readonly connectionId: string
	// Exact device id of the mount.
	readonly id: string
	// Driver-reported name, for display.
	readonly name: string
}

// Slew started from this tab.
export interface MountSlew {
	// Id of the operation, matching its operation:updated events.
	readonly operationId: string
	// Name of the object slewed to.
	readonly targetName: string
	// Coordinate commanded and the object's place when it was resolved.
	readonly response: MountSlewResponse
}

// Mount runtime state.
export interface MountRuntime {
	// Mount followed; absent when the profile has no MOUNT on an open connection.
	target?: MountTarget
	// Latest slew started from this tab on the target.
	slew?: MountSlew
	// Whether a slew or stop request is being sent.
	sending: boolean
	// Why the latest slew or stop request was refused.
	error?: string
	// Whether the map keeps the mount at its center.
	following: boolean
}

// Equatorial point of date in radians.
export interface MountPoint {
	// Right ascension of date (JNOW) in radians.
	readonly rightAscension: number
	// Declination of date in radians.
	readonly declination: number
}

// Mount runtime of the tab.
export const mountRuntime = proxy<MountRuntime>({ sending: false, following: false })

// Mount runtime with the state the control runtime mirrors for its target, as the views read it.
export interface MountView extends Readonly<MountRuntime> {
	// Latest state reported for the target; absent until known, after the mount is removed, or without a target.
	readonly state?: MountState
}

// Whether a target is the same mount as another (connection and device id).
function sameMount(a: Pick<MountTarget, 'connectionId' | 'id'> | undefined, b: Pick<MountTarget, 'connectionId' | 'id'> | undefined) {
	return a?.connectionId === b?.connectionId && a?.id === b?.id
}

// Returns the runtime with the state the control runtime mirrors for its target.
export function mountView(runtime: Readonly<MountRuntime>, control: Pick<ControlRuntime, 'watched' | 'states'>): MountView {
	return { ...runtime, state: watchedDeviceState(control, 'mount', runtime.target) }
}

// Follows another mount, or none. Everything known about the previous one is dropped and following stops. The same
// mount only refreshes its name.
export function watchMount(runtime: MountRuntime, target: MountTarget | undefined) {
	if (sameMount(runtime.target, target)) {
		if (target && runtime.target?.name !== target.name) runtime.target = target
		return
	}

	runtime.target = target
	runtime.slew = undefined
	runtime.error = undefined
	runtime.sending = false
	runtime.following = false
}

// Returns where the followed mount points, or undefined when it is not connected or its state is
// unknown, and while the Sky shows another instant than now (live false): the reported position is the
// present one, never a simulated one.
export function mountPoint(runtime: Pick<MountView, 'state'>, live: boolean): MountPoint | undefined {
	const state = runtime.state
	return live && state?.connected ? { rightAscension: state.rightAscension, declination: state.declination } : undefined
}

// Returns the point of date the selection is at: the mount's reported position for the mount marker
// (see mountPoint), otherwise the selection's computed position; undefined when unknown.
export function selectionPoint(selection: Pick<SkySelection, 'ref' | 'position'> | undefined, runtime: Pick<MountView, 'target' | 'state'>, live: boolean): MountPoint | undefined {
	if (selection?.ref.kind === 'mount') return sameMount(selection.ref, runtime.target) ? mountPoint(runtime, live) : undefined
	const position = selection?.position
	return position && { rightAscension: position.rightAscension, declination: position.declination }
}

// Horizontal place of a point of date for an observer at a Unix time in milliseconds: azimuth from north
// through east in [0, 2π) and geometric (unrefracted) altitude, both in radians.
export function horizontalOf(point: MountPoint, time: number, observer: ObserverLocation): { readonly azimuth: number; readonly altitude: number } {
	const matrix = new Float64Array(9)
	const vector = new Float64Array(3)
	writeEquatorialToHorizontalMatrix(time, observer, matrix)
	writeRaDecUnitVector(point.rightAscension, point.declination, vector)
	multiplyMatrixVector(matrix, vector[0], vector[1], vector[2], vector)
	const azimuth = Math.atan2(vector[0], vector[1])
	return { azimuth: azimuth < 0 ? azimuth + 2 * Math.PI : azimuth, altitude: Math.asin(Math.max(-1, Math.min(1, vector[2]))) }
}

// Progress of the latest slew started from this tab: running until its operation reports an outcome.
export function slewProgress(runtime: Pick<MountRuntime, 'slew'>, operations: Pick<OperationsState, 'operations'>): OperationRecord | undefined {
	const slew = runtime.slew
	return slew && operations.operations[slew.operationId]
}

// Why the followed mount cannot slew now, or undefined when it can: among other reasons, while any
// operation started by any tab holds it. The server checks again.
export function slewBlocker(runtime: Pick<MountView, 'target' | 'state' | 'sending' | 'slew'>, operations: Pick<OperationsState, 'operations'>): string | undefined {
	if (!runtime.target) return 'No mount is assigned on the connection'
	const state = runtime.state
	if (!state?.connected) return 'The mount is disconnected'
	if (!state.canGoTo) return 'The mount cannot go to a target'
	if (state.parked || state.parking) return 'The mount is parked'
	if (runtime.sending) return 'A request is being sent'
	if (state.slewing || slewProgress(runtime, operations)?.state === 'running') return 'The mount is slewing'
	if (runningOn(operations, runtime.target.connectionId, runtime.target.id).length > 0) return 'The mount is busy'
	return undefined
}

// Asks the server to slew the followed mount to an object, resolved by the server at its current time
// for the observer. On acceptance the slew is recorded and its outcome arrives as operation:updated events;
// on refusal the server's reason is kept in error.
export async function slewMount(runtime: MountRuntime, target: SkyObjectRef, targetName: string, observer: SkyObserver, request: typeof fetch = fetch) {
	const mount = runtime.target
	if (!mount || runtime.sending) return

	runtime.sending = true
	runtime.error = undefined

	try {
		const response = await request(deviceUrl(mount.connectionId, 'mount', mount.id, 'slew'), jsonInit('POST', { target, observer }))
		if (!sameMount(runtime.target, mount)) return

		if (response.ok) {
			const body = (await response.json()) as MountSlewResponse
			if (sameMount(runtime.target, mount)) runtime.slew = { operationId: body.operationId, targetName, response: body }
		} else {
			const message = await responseError(response)
			if (sameMount(runtime.target, mount)) runtime.error = message
		}
	} catch {
		if (sameMount(runtime.target, mount)) runtime.error = 'The server cannot be reached'
	} finally {
		if (sameMount(runtime.target, mount)) runtime.sending = false
	}
}

// Asks the server to abort the operation of the followed mount and stop its motion.
export async function stopMount(runtime: MountRuntime, request: typeof fetch = fetch) {
	const mount = runtime.target
	if (!mount) return

	runtime.error = undefined

	try {
		const response = await request(deviceUrl(mount.connectionId, 'mount', mount.id, 'stop'), { method: 'POST' })
		if (!response.ok && sameMount(runtime.target, mount)) runtime.error = await responseError(response)
	} catch {
		if (sameMount(runtime.target, mount)) runtime.error = 'The server cannot be reached'
	}
}
