import type { OperationRecord } from 'api'
import { type OperationsState, runningOn } from '../operations'
import type { RoleStatus } from './equipment'
import { type EquipmentRole, roleDefinition } from './roles'
import type { RoleDevice } from './useEquipment'

// Whether the device of a role can be used by a feature now, and why not. A role is ready only when its
// device is connected and no operation holds it: being selected is not enough, and a device held by an
// operation of any tab or service is busy. Busy is judged on the exact connection and device ids, so
// two profiles assigning the same physical device see the same operation. Whether a feature is
// implemented at all is declared by its own registry (Capture modes, Images tools, standalone tools);
// device capabilities are not reported by the server yet, so they are not checked.

// Availability of a role's device: ready, busy with operations, or the role state that prevents use.
export type RoleAvailability = { readonly status: 'ready' } | { readonly status: 'busy'; readonly operations: readonly OperationRecord[]; readonly message: string } | { readonly status: Exclude<RoleStatus, 'connected'>; readonly message: string }

// Existing flow that resolves an unavailable role: opening Connections or Equipment Setup.
export type RoleFix = 'connections' | 'equipment'

// Returns why a role in a status cannot be used, or undefined when it is connected.
function roleProblem(role: EquipmentRole, status: RoleStatus): string | undefined {
	const label = roleDefinition(role).label

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

// Evaluates the device a role resolves to (see useRoleDevice) against the running operations.
export function roleAvailability(role: EquipmentRole, { device, status }: Pick<RoleDevice, 'device' | 'status'>, operations: Pick<OperationsState, 'operations'>): RoleAvailability {
	if (status !== 'connected') return { status, message: roleProblem(role, status)! }

	const running = device ? runningOn(operations, device.connectionId, device.id) : []
	if (running.length > 0) return { status: 'busy', operations: running, message: `The ${roleDefinition(role).label} is busy.` }

	return { status: 'ready' }
}

// Returns the flow that resolves an availability, or undefined when there is nothing to fix there:
// ready, busy (the operation must end), or a connection change in progress.
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
