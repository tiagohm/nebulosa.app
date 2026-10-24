import type { ManagedDeviceType } from 'api'

// Equipment roles of a profile's setup: the operational function each assigned device fills, grouped by
// the part of the system it belongs to. The ROLES table is the single place to add a role; the
// Equipment Setup modal and the setup store read it.

// Operational function a device can be assigned to.
export type EquipmentRole = 'MAIN_CAMERA' | 'GUIDE_CAMERA' | 'MOUNT' | 'FOCUSER' | 'FILTER_WHEEL' | 'ROTATOR' | 'GUIDE_OUTPUT' | 'DOME' | 'COVER' | 'FLAT_PANEL'

// Part of the system a role belongs to.
export type RoleGroup = 'IMAGING' | 'TELESCOPE' | 'OBSERVATORY'

// Reference to the device assigned to a role. The name is kept so the assignment can be shown while
// the connection is closed; it never changes for an id, because the id is derived from the name.
export interface DeviceAssignment {
	// Stable device id reported by the server.
	readonly id: string
	// Driver-reported device name at assignment time; empty when unknown.
	readonly name: string
}

// Devices assigned to the roles of one connection; an absent role has no device.
export type EquipmentSetup = Partial<Record<EquipmentRole, DeviceAssignment>>

// Definition of a role.
export interface RoleDefinition {
	// Role identifier.
	readonly role: EquipmentRole
	// Display name.
	readonly label: string
	// Device type accepted by the role.
	readonly deviceType: ManagedDeviceType
	// Group the role is listed under.
	readonly group: RoleGroup
}

// Definition of a role group.
export interface RoleGroupDefinition {
	// Group identifier.
	readonly group: RoleGroup
	// Display name.
	readonly label: string
}

// Role groups in display order.
export const ROLE_GROUPS: readonly RoleGroupDefinition[] = [
	{ group: 'IMAGING', label: 'Imaging' },
	{ group: 'TELESCOPE', label: 'Telescope & Guiding' },
	{ group: 'OBSERVATORY', label: 'Observatory' },
]

// Roles in display order within their group.
export const ROLES: readonly RoleDefinition[] = [
	{ role: 'MAIN_CAMERA', label: 'Main Camera', deviceType: 'camera', group: 'IMAGING' },
	{ role: 'FILTER_WHEEL', label: 'Filter Wheel', deviceType: 'wheel', group: 'IMAGING' },
	{ role: 'FOCUSER', label: 'Focuser', deviceType: 'focuser', group: 'IMAGING' },
	{ role: 'ROTATOR', label: 'Rotator', deviceType: 'rotator', group: 'IMAGING' },
	{ role: 'MOUNT', label: 'Mount', deviceType: 'mount', group: 'TELESCOPE' },
	{ role: 'GUIDE_CAMERA', label: 'Guide Camera', deviceType: 'camera', group: 'TELESCOPE' },
	{ role: 'GUIDE_OUTPUT', label: 'Guide Output', deviceType: 'guideOutput', group: 'TELESCOPE' },
	{ role: 'DOME', label: 'Dome', deviceType: 'dome', group: 'OBSERVATORY' },
	{ role: 'COVER', label: 'Cover', deviceType: 'cover', group: 'OBSERVATORY' },
	{ role: 'FLAT_PANEL', label: 'Flat Panel', deviceType: 'flatPanel', group: 'OBSERVATORY' },
]

// Camera roles, in precedence order: a camera is looked up in this order when its role is resolved, so the main
// camera comes first.
export const CAMERA_ROLES = ['MAIN_CAMERA', 'GUIDE_CAMERA'] as const satisfies readonly EquipmentRole[]

// Role filled by a camera.
export type CameraRole = (typeof CAMERA_ROLES)[number]

// Groups of roles that cannot share a device: one camera cannot image and guide at once.
export const EXCLUSIVE_ROLES: readonly (readonly EquipmentRole[])[] = [['MAIN_CAMERA', 'GUIDE_CAMERA']]

// Whether value names a role.
export function isEquipmentRole(value: string): value is EquipmentRole {
	return ROLES.some((r) => r.role === value)
}

// Whether value names a camera role.
export function isCameraRole(value: unknown): value is CameraRole {
	return (CAMERA_ROLES as readonly unknown[]).includes(value)
}

// Returns the definition of a role.
export function roleDefinition(role: EquipmentRole): RoleDefinition {
	return ROLES.find((r) => r.role === role)!
}

// Returns the role of setup that already holds deviceId and cannot share it with role, if any.
export function conflictingRole(setup: Readonly<EquipmentSetup>, role: EquipmentRole, deviceId: string): EquipmentRole | undefined {
	for (const group of EXCLUSIVE_ROLES) {
		if (!group.includes(role)) continue
		const other = group.find((r) => r !== role && setup[r]?.id === deviceId)
		if (other) return other
	}

	return undefined
}
