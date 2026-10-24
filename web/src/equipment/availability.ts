import type { OperationRecord } from 'api'
import { type OperationsState, runningOn } from '../operations'
import type { RoleStatus } from './equipment'
import { type EquipmentRole, roleDefinition } from './roles'
import type { RoleDevice } from './useEquipment'

// Whether the device of a role can be used by a feature now, and why not. A role is ready only when its
// device is connected and no operation holds it: being selected is not enough, and a device held by an
// operation of any tab or service is busy. Busy is judged on the exact connection and device ids, so
// two profiles assigning the same physical device see the same operation. Whether a feature is
// implemented at all is declared by its own registry (Images tools, standalone tools). Whether a connected
// device can run a given operation (its mechanical design or capabilities, as the server reports them in the
// device state) is judged by that operation, which passes the reason to the evaluation as unsupported.

// Availability of a role's device: ready, busy with operations, unsupported by the operation (a connected device
// that can never run it, such as an alt-az mount for a polar alignment), or the role state that prevents use.
export type RoleAvailability = { readonly status: 'ready' } | { readonly status: 'busy'; readonly operations: readonly OperationRecord[]; readonly message: string } | { readonly status: 'unsupported'; readonly message: string } | { readonly status: Exclude<RoleStatus, 'connected'>; readonly message: string }

// Existing flow that resolves an unavailable role: opening Connections or Equipment Setup.
export type RoleFix = 'connections' | 'equipment'

// Returns why a device, named by label (a role, or "camera"), in a status cannot be used, or undefined when it is
// connected.
function deviceProblem(label: string, status: RoleStatus): string | undefined {
	switch (status) {
		case 'connected':
			return undefined
		case 'notSelected':
			return `No ${label} selected in Equipment Setup.`
		case 'unavailable':
			return `The ${label} is unavailable: its connection is not open.`
		case 'connecting':
			return `The ${label} is still connecting.`
		case 'disconnecting':
			return `The ${label} is disconnecting.`
		case 'error':
			return `The ${label} reported an error.`
		default:
			return `The ${label} is not connected.`
	}
}

// Evaluates the device a role resolves to (see useRoleDevice) against the running operations. unsupported is the
// reason the operation cannot run on that device, when it judged so from the device state.
export function roleAvailability(role: EquipmentRole, device: Pick<RoleDevice, 'device' | 'status'>, operations: Pick<OperationsState, 'operations'>, unsupported?: string): RoleAvailability {
	return deviceAvailability(roleDefinition(role).label, device, operations, unsupported)
}

// Evaluates a device and its state against the running operations, naming it by label in the messages, for a device
// used for itself rather than through a role, such as the camera of an Images camera tab. A connected device the
// operation does not support (unsupported, its reason) is unsupported before it is busy, since waiting for the
// running operations would not make it usable.
export function deviceAvailability(label: string, { device, status }: Pick<RoleDevice, 'device' | 'status'>, operations: Pick<OperationsState, 'operations'>, unsupported?: string): RoleAvailability {
	if (status !== 'connected') return { status, message: deviceProblem(label, status)! }
	if (unsupported !== undefined) return { status: 'unsupported', message: unsupported }

	const running = device ? runningOn(operations, device.connectionId, device.id) : []
	if (running.length > 0) return { status: 'busy', operations: running, message: `The ${label} is busy.` }

	return { status: 'ready' }
}

// Returns the flow that resolves an availability, or undefined when there is nothing to fix there:
// ready, busy (the operation must end), or a connection change in progress. An unsupported device is fixed by
// assigning another one in Equipment Setup.
export function availabilityFix(availability: RoleAvailability): RoleFix | undefined {
	switch (availability.status) {
		case 'ready':
		case 'busy':
		case 'connecting':
		case 'disconnecting':
			return undefined
		case 'unavailable':
			return 'connections'
		default:
			return 'equipment'
	}
}
