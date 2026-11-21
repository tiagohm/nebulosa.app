import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { useRoleDevice } from '../equipment/useEquipment'
import { useActiveSite } from '../location/useLocation'
import { navigate, openWorkspace, redirect, routeState, type ToolId } from '../shell/route'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { LinkButton } from '../ui/LinkButton'
import { SectionHeading } from '../ui/SectionHeading'
import { StatusBadge } from '../ui/StatusBadge'
import { TextInput } from '../ui/TextInput'
import { meridianFlipHeadline, meridianFlipState, monitorKey } from './meridianflip/meridianflip'
import { latestExecution, MERIDIAN_FLIP_STEP_LABELS, meridianFlipExecutorState } from './meridianflip/meridianflipexecutor'
import { formatEndpoint, MOUNT_REMOTE_PROTOCOL_LABELS, mountListeners, mountRemoteControlState } from './mountremotecontrol/listeners'
import { observatoryCamerasState } from './observatorycameras/observatorycameras'
import { type ToolReadiness, toolReadiness, type ToolReadinessContext } from './readiness'
import { catalogGroups, TOOL_DEFINITIONS, type ToolDefinition, toolStatus } from './tools'

// Tools workspace: the catalog of standalone tools, grouped in the order of a night and narrowed by a filter, and the
// view of the tool the URL names. A card names its tool and
// shows one word only by exception (readiness.ts): planned, blocked by the active profile, or running on the server.
// A planned tool is listed but cannot be opened, so a URL naming one returns to the catalog; a blocked tool still opens,
// into its own setup state.

// Name of the application, the title of the page outside Tools.
const APP_TITLE = 'Nebulosa'

// What the catalog remembers for the tab while a tool or another workspace is shown, never persisted: how far it was
// scrolled, in CSS pixels.
const catalogMemory: { scrollTop: number } = { scrollTop: 0 }

// Tools workspace.
export function ToolsWorkspace() {
	const { route } = useSnapshot(routeState)
	const tool = route.workspace === 'tools' && route.tool ? TOOL_DEFINITIONS[route.tool] : undefined
	const View = tool?.view
	const shown = View ? tool : undefined
	const previous = useRef<ToolId | undefined>(undefined)

	// A tool that has no view yet cannot be shown, so its URL is replaced by the catalog's.
	useEffect(() => {
		if (tool && !View) redirect(routeState, { workspace: 'tools' })
	}, [tool, View])

	// Names the page after the tool shown, so tabs and history tell them apart, and gives the name back when Tools is left.
	useEffect(() => {
		document.title = `${shown?.label ?? 'Tools'} · ${APP_TITLE}`
	}, [shown])
	useEffect(
		() => () => {
			document.title = APP_TITLE
		},
		[],
	)

	// Moves the focus where the eye goes: to the title of a tool when it opens, and back to its card when the catalog
	// returns from it, never scrolling the view.
	useEffect(() => {
		const from = previous.current
		previous.current = shown?.id
		if (shown) {
			document.querySelector<HTMLElement>('[data-workspace-title]')?.focus({ preventScroll: true })
		} else if (from) {
			document.querySelector<HTMLElement>(`[data-tool-card="${from}"]`)?.focus({ preventScroll: true })
		}
	}, [shown])

	if (View) return <View />

	return <ToolsCatalog />
}

// Catalog of the tools, in the groups of a night after a Running group of the tools running work on the server, narrowed
// by a filter, each card with the readiness of its tool for the active profile. The filter is transient view state of the
// catalog; Enter opens the only tool it leaves. Every openable card is a Tab stop of its own. The scroll position is kept
// for the tab across tools and workspaces.
function ToolsCatalog() {
	const context = useToolReadinessContext()
	const [query, setQuery] = useState('')
	const scrollRef = useRef<HTMLDivElement>(null)
	const filterRef = useRef<HTMLInputElement>(null)
	const readiness = (id: ToolId) => toolReadiness(id, toolStatus(TOOL_DEFINITIONS[id]) === 'planned', context)
	const groups = catalogGroups(query, (id) => readiness(id)?.running === true)
	const openable = groups.flatMap((group) => group.tools).filter((id) => toolStatus(TOOL_DEFINITIONS[id]) === 'available')

	// Scrolls back to where the catalog was before it was last left, and remembers where it is when it is left.
	useLayoutEffect(() => {
		const scroller = scrollRef.current
		if (!scroller) return undefined
		scroller.scrollTop = catalogMemory.scrollTop
		return () => {
			catalogMemory.scrollTop = scroller.scrollTop
		}
	}, [])

	// Opens the only openable tool the filter leaves on Enter.
	function handleFilterKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter' && openable.length === 1) navigate(routeState, { workspace: 'tools', tool: openable[0] })
	}

	// Clears the filter and keeps the focus in it, so the next query can be typed at once.
	function clearFilter() {
		setQuery('')
		filterRef.current?.focus()
	}

	const filter = <TextInput ref={filterRef} type="search" title="Find a tool by what it does, such as dew, FOV, Moon, or flip; Enter opens the only match" placeholder="Filter tools" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleFilterKeyDown} className="w-56 max-sm:w-40" />

	return (
		<WorkspaceLayout workspace="tools" title="Tools" actions={filter}>
			<div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain p-4">
				{groups.length === 0 ? (
					<EmptyState
						title={`No tool matches "${query.trim()}"`}
						description={
							<>
								Plate solving, star detection, focusing, guiding, and polar alignment are in <LinkButton onClick={() => openWorkspace(routeState, 'images')}>Images</LinkButton>; framing and finding objects are in <LinkButton onClick={() => openWorkspace(routeState, 'sky')}>Sky</LinkButton>.
							</>
						}
						action={
							<Button variant="secondary" onClick={clearFilter}>
								Clear Filter
							</Button>
						}
					/>
				) : (
					<div className="flex flex-col gap-6">
						{groups.map((group) => (
							<section key={group.label} className="flex flex-col gap-2">
								<SectionHeading as="h2">{group.label}</SectionHeading>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
									{group.tools.map((id) => {
										const tool = TOOL_DEFINITIONS[id]
										return <ToolCard key={id} tool={tool} planned={toolStatus(tool) === 'planned'} readiness={readiness(id)} />
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
		listeners: device ? mountListeners(servers, device.connectionId, device.id).map((server) => `${MOUNT_REMOTE_PROTOCOL_LABELS[server.protocol]} on ${formatEndpoint(server.host, server.port)}`) : [],
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

// Catalog card of a tool: its summary (hidden on a phone, where the name alone keeps the list short), the full
// description as its tooltip, and, by exception, its readiness, whose reason is a caption wherever there is no hover to
// show a tooltip (a phone, or a touch screen of any width) and visually hidden text otherwise, so a screen reader still
// reads it with the card; clicking a tool that is not planned opens it, even when its readiness says what it lacks.
function ToolCard({ tool, planned, readiness }: ToolCardProps) {
	return (
		<button
			type="button"
			data-tool-card={tool.id}
			disabled={planned}
			title={planned ? `${tool.description} ${readiness?.reason ?? ''}`.trim() : tool.description}
			onClick={() => navigate(routeState, { workspace: 'tools', tool: tool.id })}
			className="flex items-start gap-3 rounded-md max-sm:items-center border border-line-100 bg-base-000 p-3 text-left font-mono text-inherit transition-colors duration-150 not-disabled:cursor-pointer not-disabled:hover:border-line-200 not-disabled:active:border-line-200 not-disabled:active:bg-base-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default motion-reduce:transition-none"
		>
			<span className="flex size-9 flex-none items-center justify-center rounded-sm bg-base-200 text-ink-200">
				<Icon name={tool.icon} />
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
					<span className="min-w-0 text-sm leading-5 font-semibold text-ink-100">{tool.label}</span>
					{readiness && <StatusBadge tone={readiness.tone} label={readiness.label} title={readiness.reason} />}
				</span>
				<span className="line-clamp-2 text-sm leading-5 text-pretty text-ink-200 max-sm:hidden">{tool.summary}</span>
				{readiness && <span className="text-xs leading-4 text-pretty text-ink-300 [@media(hover:hover)_and_(min-width:40rem)]:hidden">{readiness.reason}</span>}
			</span>
		</button>
	)
}
