import { cn } from 'cn'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { navigate, redirect, routeState, TOOL_IDS } from '../shell/route'
import { WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Icon } from '../ui/Icon'
import { TOOL_DEFINITIONS, type ToolDefinition, toolStatus } from './tools'
import { ToolStatusBadge } from './ToolStatusBadge'

// Tools workspace: the catalog of standalone tools and the view of the tool the URL names. A planned
// tool is listed but cannot be opened, so a URL naming one returns to the catalog.

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

	return (
		<WorkspaceLayout workspace="tools" title="Tools">
			<div className="h-full overflow-y-auto overscroll-contain p-4">
				<div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
					{TOOL_IDS.map((id) => (
						<ToolCard key={id} tool={TOOL_DEFINITIONS[id]} />
					))}
				</div>
			</div>
		</WorkspaceLayout>
	)
}

interface ToolCardProps {
	// Tool shown.
	readonly tool: ToolDefinition
}

// Catalog card of a tool: what it does and whether it can be opened; clicking an available tool opens it.
function ToolCard({ tool }: ToolCardProps) {
	const status = toolStatus(tool)
	const available = status === 'available'

	return (
		<button
			type="button"
			disabled={!available}
			onClick={() => navigate(routeState, { workspace: 'tools', tool: tool.id })}
			className={cn(
				'flex items-start gap-3 rounded-md border border-line-100 bg-base-000 p-3 text-left font-mono text-inherit transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none',
				available ? 'cursor-pointer hover:border-line-200' : 'cursor-default opacity-70',
			)}
		>
			<span className="flex size-9 flex-none items-center justify-center rounded-sm bg-base-200 text-ink-200">
				<Icon name={tool.icon} />
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="flex items-center justify-between gap-2">
					<span className="min-w-0 text-sm leading-5 font-semibold text-ink-100">{tool.label}</span>
					<ToolStatusBadge status={status} />
				</span>
				<span className="text-xs leading-4 text-ink-200">{tool.description}</span>
			</span>
		</button>
	)
}
