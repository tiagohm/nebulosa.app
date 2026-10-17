import { cn } from 'cn'
import { useState } from 'react'
import type { CameraRole } from '../equipment/roles'
import { routeState } from '../shell/route'
import { WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { requirementSummary, type ToolAvailability, toolAvailability } from './availability'
import { canLaunch, launchTool } from './launch'
import { ToolDetails } from './ToolDetails'
import { TOOL_CATEGORIES, type ToolDefinition, TOOLS } from './tools'
import { ToolStatusBadge } from './ToolStatusBadge'
import { useToolContext } from './useToolContext'

// Tools workspace: the catalog where every tool is discovered, with its requirements evaluated against
// the current profile, and opened in the workspace that runs it. Unavailable and planned tools stay
// listed with the reason they cannot run.

// Tools workspace.
export function ToolsWorkspace() {
	const context = useToolContext()
	const [selectedId, setSelectedId] = useState<string>()
	const selected = TOOLS.find((tool) => tool.id === selectedId)

	return (
		<WorkspaceLayout workspace="tools" title="Tools" panel={{ title: 'Tool Details', content: <ToolDetails tool={selected} availability={selected && toolAvailability(selected, context)} camera={context.camera?.role} /> }}>
			<div className="h-full overflow-y-auto overscroll-contain p-4">
				{TOOL_CATEGORIES.map((category) => (
					<section key={category.id} className="mb-6 last:mb-0">
						<h2 className="m-0 mb-2 text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase">{category.label}</h2>
						<div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
							{TOOLS.filter((tool) => tool.category === category.id).map((tool) => (
								<ToolCard key={tool.id} tool={tool} availability={toolAvailability(tool, context)} camera={context.camera?.role} selected={tool.id === selectedId} onSelect={() => setSelectedId(tool.id)} />
							))}
						</div>
					</section>
				))}
			</div>
		</WorkspaceLayout>
	)
}

interface ToolCardProps {
	// Tool shown.
	readonly tool: ToolDefinition
	// Whether its requirements are met now.
	readonly availability: ToolAvailability
	// Camera role of the Capture camera view the tool opens in; absent when none is assigned.
	readonly camera?: CameraRole
	// Whether its details are shown in the panel.
	readonly selected: boolean
	// Shows its details.
	readonly onSelect: () => void
}

// Catalog card of a tool: what it does, what it needs and whether that is met, and how to open it.
function ToolCard({ tool, availability, camera, selected, onSelect }: ToolCardProps) {
	const summary = requirementSummary(tool)

	return (
		<article className={cn('flex flex-col gap-2 rounded-md border p-3 transition-colors duration-150 motion-reduce:transition-none', selected ? 'border-accent/60 bg-accent-subtle/40' : 'border-line-100 bg-base-000 hover:border-line-200')}>
			<button type="button" onClick={onSelect} className="flex cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left font-mono text-inherit focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
				<span className="flex size-9 flex-none items-center justify-center rounded-sm bg-base-200 text-ink-200">
					<Icon name={tool.icon} />
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="flex items-center justify-between gap-2">
						<span className="min-w-0 text-sm leading-5 font-semibold text-ink-100">{tool.label}</span>
						<ToolStatusBadge status={tool.status} />
					</span>
					<span className="text-xs leading-4 text-ink-200">{tool.description}</span>
				</span>
			</button>
			<div className="mt-auto flex items-center justify-between gap-2 pl-12">
				<span className={cn('min-w-0 text-[11px] leading-4', !summary ? 'text-ink-300' : availability.ready ? 'text-success' : 'text-ink-300')}>{!summary ? 'No requirements' : availability.ready ? 'Ready' : (availability.missing[0]?.message ?? summary)}</span>
				{canLaunch(tool) && (
					<Button size="sm" variant="secondary" className="px-2 py-0.5 text-xs" onClick={() => launchTool(routeState, tool, camera)}>
						Open
					</Button>
				)}
			</div>
		</article>
	)
}
