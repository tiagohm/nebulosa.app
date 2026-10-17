import type { ReactNode } from 'react'
import { connectionState } from '../connection/connection'
import { deviceState } from '../equipment/equipment'
import { type CameraRole, roleDefinition } from '../equipment/roles'
import { RoleStatusText } from '../equipment/RoleStatusText'
import { PanelSection } from '../shell/ContextualPanel'
import { navigate, routeState } from '../shell/route'
import { EmptyState } from '../shell/WorkspaceLayout'
import { workspaceDefinition } from '../shell/workspaces'
import { Button } from '../ui/Button'
import type { MissingRequirement, ToolAvailability } from './availability'
import { canLaunch, launchTool } from './launch'
import type { ToolDefinition } from './tools'
import { ToolStatusBadge } from './ToolStatusBadge'

// Contextual panel of the Tools workspace: the selected tool's description, where it runs, each
// requirement with its current state and a shortcut to the flow that meets it, and the action that
// opens it.

export interface ToolDetailsProps {
	// Selected tool; absent when none is selected.
	readonly tool?: ToolDefinition
	// Whether its requirements are met now.
	readonly availability?: ToolAvailability
	// Camera role of the Capture camera view the tool opens in; absent when none is assigned.
	readonly camera?: CameraRole
}

// Details of the selected tool.
export function ToolDetails({ tool, availability, camera }: ToolDetailsProps) {
	if (!tool || !availability) return <EmptyState title="No tool selected" description="Select a tool to see what it needs." />

	return (
		<>
			<PanelSection title="Tool">
				<div className="flex items-center justify-between gap-2">
					<span className="text-sm font-semibold text-ink-100">{tool.label}</span>
					<ToolStatusBadge status={tool.status} />
				</div>
				<p className="m-0">{tool.description}</p>
				<p className="m-0 text-xs text-ink-300">Runs in {workspaceDefinition(tool.route.workspace).label}.</p>
			</PanelSection>
			<PanelSection title="Requirements">
				{tool.requires.length === 0 && <p className="m-0 text-ink-300">None.</p>}
				{tool.requires.map((requirement) => {
					const missing = availability.missing.find((m) => m.requirement === requirement)
					if (requirement.kind === 'image') return <RequirementRow key="image" label="Open image" state={missing ? 'Missing' : 'Ready'} missing={missing} />
					const role = requirement.kind === 'camera' ? camera : requirement.role
					return <RequirementRow key={requirement.kind === 'camera' ? 'camera' : requirement.role} label={role ? roleDefinition(role).label : 'Camera'} state={<RoleStatusText status={missing?.status ?? 'connected'} />} missing={missing} />
				})}
			</PanelSection>
			<PanelSection title="Open">
				{canLaunch(tool) ? (
					<>
						<Button size="sm" onClick={() => launchTool(routeState, tool, camera)}>
							Open {tool.label}
						</Button>
						{tool.status === 'preview' && <p className="m-0 text-xs text-ink-300">Preview: its layout is ready, its operations are not available yet.</p>}
					</>
				) : (
					<p className="m-0 text-ink-300">Coming soon.</p>
				)}
			</PanelSection>
		</>
	)
}

interface RequirementRowProps {
	// Requirement name.
	readonly label: string
	// Current state.
	readonly state: ReactNode
	// Why it is not met; absent when it is.
	readonly missing?: MissingRequirement
}

// One requirement with its state and, when not met, the reason and a shortcut to fix it.
function RequirementRow({ label, state, missing }: RequirementRowProps) {
	const fix = missing && fixOf(missing)

	return (
		<div className="flex flex-col gap-0.5">
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-ink-100">{label}</span>
				<span className="text-xs">{state}</span>
			</div>
			{missing && (
				<div className="flex items-baseline justify-between gap-2 text-xs">
					<span className="text-ink-300">{missing.message}</span>
					{fix && (
						<button type="button" onClick={fix.run} className="flex-none cursor-pointer border-0 bg-transparent p-0 font-mono text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
							{fix.label}
						</button>
					)}
				</div>
			)}
		</div>
	)
}

// Returns the action that resolves a missing requirement through an existing flow.
function fixOf(missing: MissingRequirement): { readonly label: string; readonly run: () => void } | undefined {
	if (missing.requirement.kind === 'image') return { label: 'Images', run: () => navigate(routeState, { workspace: 'images' }) }
	if (missing.status === 'unavailable') return { label: 'Connections', run: () => (connectionState.open = true) }
	if (missing.status === 'connecting' || missing.status === 'disconnecting') return undefined
	return { label: 'Equipment Setup', run: () => (deviceState.open = true) }
}
