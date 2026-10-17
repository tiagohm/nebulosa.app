import type { ManagedDeviceType } from 'api'

// Equipment roles of a profile's setup: the operational function each assigned device fills. The ROLES
// table is the single place to add a role; the Equipment Setup modal and the setup store read it.

// Operational function a device can be assigned to.
export type EquipmentRole = 'MAIN_CAMERA' | 'GUIDE_CAMERA' | 'MOUNT' | 'FOCUSER' | 'FILTER_WHEEL' | 'ROTATOR' | 'GUIDE_OUTPUT' | 'DOME' | 'COVER' | 'FLAT_PANEL'

// Devices assigned to the roles of one connection, by device id; an absent role has no device.
export type EquipmentSetup = Partial<Record<EquipmentRole, string>>

// Definition of a role.
export interface RoleDefinition {
	// Role identifier.
	readonly role: EquipmentRole
	// Display name.
	readonly label: string
	// Device type accepted by the role.
	readonly deviceType: ManagedDeviceType
}

// Roles in display order.
export const ROLES: readonly RoleDefinition[] = [
	{ role: 'MAIN_CAMERA', label: 'Main Camera', deviceType: 'camera' },
	{ role: 'GUIDE_CAMERA', label: 'Guide Camera', deviceType: 'camera' },
	{ role: 'MOUNT', label: 'Mount', deviceType: 'mount' },
	{ role: 'GUIDE_OUTPUT', label: 'Guide Output', deviceType: 'guideOutput' },
	{ role: 'FOCUSER', label: 'Focuser', deviceType: 'focuser' },
	{ role: 'FILTER_WHEEL', label: 'Filter Wheel', deviceType: 'wheel' },
	{ role: 'ROTATOR', label: 'Rotator', deviceType: 'rotator' },
	{ role: 'DOME', label: 'Dome', deviceType: 'dome' },
	{ role: 'COVER', label: 'Cover', deviceType: 'cover' },
	{ role: 'FLAT_PANEL', label: 'Flat Panel', deviceType: 'flatPanel' },
]

// Groups of roles that cannot share a device: one camera cannot image and guide at once.
export const EXCLUSIVE_ROLES: readonly (readonly EquipmentRole[])[] = [['MAIN_CAMERA', 'GUIDE_CAMERA']]

// Whether value names a role.
export function isEquipmentRole(value: string): value is EquipmentRole {
	return ROLES.some((r) => r.role === value)
}

// Returns the definition of a role.
export function roleDefinition(role: EquipmentRole): RoleDefinition {
	return ROLES.find((r) => r.role === role)!
}

// Returns the role of setup that already holds deviceId and cannot share it with role, if any.
export function conflictingRole(setup: EquipmentSetup, role: EquipmentRole, deviceId: string): EquipmentRole | undefined {
	for (const group of EXCLUSIVE_ROLES) {
		if (!group.includes(role)) continue
		const other = group.find((r) => r !== role && setup[r] === deviceId)
		if (other) return other
	}

	return undefined
}
