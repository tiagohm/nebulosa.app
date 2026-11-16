import { type KeyboardEvent, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { useRoleDevice } from '../equipment/useEquipment'
import { useActiveSite } from '../location/useLocation'
import { navigate, redirect, routeState } from '../shell/route'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Icon } from '../ui/Icon'
import { SectionHeading } from '../ui/SectionHeading'
import { StatusBadge } from '../ui/StatusBadge'
import { TextInput } from '../ui/TextInput'
import { meridianFlipHeadline, meridianFlipState, monitorKey } from './meridianflip/meridianflip'
import { latestExecution, MERIDIAN_FLIP_STEP_LABELS, meridianFlipExecutorState } from './meridianflip/meridianflipexecutor'
import { formatEndpoint, MOUNT_REMOTE_PROTOCOL_LABELS, mountRemoteControlState } from './mountremotecontrol/listeners'
import { observatoryCamerasState } from './observatorycameras/observatorycameras'
import { type ToolReadiness, toolReadiness, type ToolReadinessContext } from './readiness'
import { matchesTool, TOOL_DEFINITIONS, TOOL_GROUPS, type ToolDefinition, toolStatus } from './tools'

// Tools workspace: the catalog of standalone tools, grouped in the order of a night and narrowed by a filter, and the
// view of the tool the URL names. A card names its tool and
// shows one word only by exception (readiness.ts): planned, blocked by the active profile, or running on the server.
// A planned tool is listed but cannot be opened, so a URL naming one returns to the catalog; a blocked tool still opens,
// into its own setup state.

// Tools workspace.
export function ToolsWorkspace() {
	const { route } = useSnapshot(routeState)
	const tool = route.workspace === 'tools' && route.tool ? TOOL_DEFINITIONS[route.tool] : undefined
	const View = tool?.view

	// A tool that has no view yet cannot be shown, so its URL is replaced by the catalog's.
	useEffect(() => {
		if (tool && !View) redirect(routeState, { workspace: 'tools' })
	}, [tool, View])

	if (View) return <View />

	return <ToolsCatalog />
}

// Catalog of the tools, in the groups of a night, narrowed by a filter, each card with the readiness of its tool for the
// active profile. The filter is transient view state of the catalog; Enter opens the only tool it leaves.
function ToolsCatalog() {
	const context = useToolReadinessContext()
	const [query, setQuery] = useState('')
	const groups = TOOL_GROUPS.map((group) => ({ label: group.label, tools: group.tools.filter((id) => matchesTool(TOOL_DEFINITIONS[id], query)) })).filter((group) => group.tools.length > 0)
	const matches = groups.flatMap((group) => group.tools).filter((id) => toolStatus(TOOL_DEFINITIONS[id]) === 'available')

	// Opens the only openable tool the filter leaves when Enter is pressed in it.
	function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter' && matches.length === 1) navigate(routeState, { workspace: 'tools', tool: matches[0] })
	}

	const filter = <TextInput type="search" title="Filter tools by name or description; Enter opens the only match" placeholder="Filter tools" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} className="w-56 max-sm:w-40" />

	return (
		<WorkspaceLayout workspace="tools" title="Tools" actions={filter}>
			<div className="h-full overflow-y-auto overscroll-contain p-4">
				{groups.length === 0 ? (
					<EmptyState title="No tool matches" description="Change or clear the filter." />
				) : (
					<div className="flex flex-col gap-6">
						{groups.map((group) => (
							<section key={group.label} className="flex flex-col gap-2">
								<SectionHeading as="h2">{group.label}</SectionHeading>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
									{group.tools.map((id) => {
										const tool = TOOL_DEFINITIONS[id]
										const planned = toolStatus(tool) === 'planned'
										return <ToolCard key={id} tool={tool} planned={planned} readiness={toolReadiness(id, planned, context)} />
									})}
								</div>
							</section>
						))}
					</div>
				)}
			</div>
		</WorkspaceLayout>
	)
}

// Reads what the readiness of the tools depends on from the stores of the tab, for the active profile: its MOUNT role,
// its observing site, the media gateway, and the monitor, armed flip, running flip, and listeners of its mount.
function useToolReadinessContext(): ToolReadinessContext {
	const mount = useRoleDevice('MOUNT')
	const site = useActiveSite()
	const { gateway } = useSnapshot(observatoryCamerasState)
	const { monitors } = useSnapshot(meridianFlipState)
	const executor = useSnapshot(meridianFlipExecutorState)
	const { servers } = useSnapshot(mountRemoteControlState)
	const device = mount.device
	const key = device && monitorKey(device.connectionId, device.id)
	const monitor = key ? monitors[key] : undefined
	const flip = device && latestExecution(executor, device.connectionId, device.id)

	return {
		mount: mount.status,
		site: site !== undefined,
		gateway,
		meridianFlip: monitor && {
			headline: meridianFlipHeadline(monitor),
			step: flip?.state === 'running' && flip.step ? MERIDIAN_FLIP_STEP_LABELS[flip.step] : undefined,
			armed: key !== undefined && executor.arms[key] !== undefined,
		},
		listeners: device
			? Object.values(servers)
					.filter((server) => server.connectionId === device.connectionId && server.deviceId === device.id)
					.map((server) => `${MOUNT_REMOTE_PROTOCOL_LABELS[server.protocol]} on ${formatEndpoint(server.host, server.port)}`)
			: [],
	}
}

interface ToolCardProps {
	// Tool shown.
	readonly tool: ToolDefinition
	// Whether the tool is planned and cannot be opened.
	readonly planned: boolean
	// Word of the card; absent for a tool ready to use.
	readonly readiness?: ToolReadiness
}

// Catalog card of a tool: what it does and, by exception, its readiness; clicking a tool that is not planned opens it,
// even when its readiness says what it lacks.
function ToolCard({ tool, planned, readiness }: ToolCardProps) {
	return (
		<button
			type="button"
			disabled={planned}
			title={planned ? readiness?.reason : undefined}
			onClick={() => navigate(routeState, { workspace: 'tools', tool: tool.id })}
			className="flex items-start gap-3 rounded-md border border-line-100 bg-base-000 p-3 text-left font-mono text-inherit transition-colors duration-150 not-disabled:cursor-pointer not-disabled:hover:border-line-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default motion-reduce:transition-none"
		>
			<span className="flex size-9 flex-none items-center justify-center rounded-sm bg-base-200 text-ink-200">
				<Icon name={tool.icon} />
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
					<span className="min-w-0 text-sm leading-5 font-semibold text-ink-100">{tool.label}</span>
					{readiness && <StatusBadge tone={readiness.tone} label={readiness.label} title={readiness.reason} />}
				</span>
				<span className="text-xs leading-4 text-ink-200">{tool.description}</span>
			</span>
		</button>
	)
}
