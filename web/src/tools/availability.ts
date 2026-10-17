import type { RoleStatus } from '../equipment/equipment'
import { type CameraRole, type EquipmentRole, roleDefinition } from '../equipment/roles'
import type { ToolDefinition, ToolRequirement } from './tools'

// Resolution of whether a tool's requirements are met in the tab's current context, and why not. A role
// is ready only when its device is connected: being selected is not enough. A camera requirement is
// evaluated against the camera of the Capture camera view the tool would open in, whichever role that
// is. Device capabilities are not reported by the server yet, so they are not checked.

// Camera of the Capture camera view a tool would open in.
export interface ToolCamera {
	// Camera role of the view.
	readonly role: CameraRole
	// Operational state of the role.
	readonly status: RoleStatus
}

// State a tool's requirements are evaluated against.
export interface ToolContext {
	// Operational state of every role of the active profile.
	readonly roles: Readonly<Record<EquipmentRole, RoleStatus>>
	// Camera of the selected Capture camera view; absent when no camera role is assigned.
	readonly camera?: ToolCamera
	// Whether an image document is open and active in the Images workspace.
	readonly hasImage: boolean
}

// Requirement that is not met, with the reason shown to the user.
export interface MissingRequirement {
	// Requirement that is not met.
	readonly requirement: ToolRequirement
	// State of the required role, for a role requirement.
	readonly status?: RoleStatus
	// Why the requirement is not met and how to meet it.
	readonly message: string
}

// Whether a tool can run now.
export interface ToolAvailability {
	// Whether every requirement is met.
	readonly ready: boolean
	// Requirements not met, in the tool's order.
	readonly missing: readonly MissingRequirement[]
}

// Returns why a role in a status does not meet a requirement, or undefined when it does.
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

// Evaluates a tool's requirements against a context.
export function toolAvailability(tool: Pick<ToolDefinition, 'requires'>, context: ToolContext): ToolAvailability {
	const missing: MissingRequirement[] = []

	for (const requirement of tool.requires) {
		if (requirement.kind === 'image') {
			if (!context.hasImage) missing.push({ requirement, message: 'No image open in Images.' })
			continue
		}

		if (requirement.kind === 'camera') {
			if (!context.camera) {
				missing.push({ requirement, status: 'notSelected', message: 'No camera configured in Equipment Setup.' })
				continue
			}

			const message = roleProblem(context.camera.role, context.camera.status)
			if (message) missing.push({ requirement, status: context.camera.status, message })
			continue
		}

		const status = context.roles[requirement.role]
		const message = roleProblem(requirement.role, status)
		if (message) missing.push({ requirement, status, message })
	}

	return { ready: missing.length === 0, missing }
}

// Returns a one-sentence summary of what a tool requires, such as "Requires a connected camera and
// Mount."; undefined for a tool that requires nothing.
export function requirementSummary(tool: Pick<ToolDefinition, 'requires'>): string | undefined {
	const parts = tool.requires.map((r) => (r.kind === 'image' ? 'an open image' : r.kind === 'camera' ? 'camera' : roleDefinition(r.role).label))
	if (parts.length === 0) return undefined
	const roles = tool.requires.some((r) => r.kind !== 'image')
	const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
	return roles ? `Requires a connected ${list}.` : `Requires ${list}.`
}
