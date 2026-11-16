import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { useRoleDevice } from '../equipment/useEquipment'
import { useActiveSite } from '../location/useLocation'
import { navigate, openWorkspace, redirect, routeState, type ToolId } from '../shell/route'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { LinkButton } from '../ui/LinkButton'
import { moveInRows } from '../ui/navigation'
import { SectionHeading } from '../ui/SectionHeading'
import { StatusBadge } from '../ui/StatusBadge'
import { TextInput } from '../ui/TextInput'
import { meridianFlipHeadline, meridianFlipState, monitorKey } from './meridianflip/meridianflip'
import { latestExecution, MERIDIAN_FLIP_STEP_LABELS, meridianFlipExecutorState } from './meridianflip/meridianflipexecutor'
import { formatEndpoint, MOUNT_REMOTE_PROTOCOL_LABELS, mountRemoteControlState } from './mountremotecontrol/listeners'
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
// scrolled, in CSS pixels, and the last tool opened, whose card takes the focus and the Tab stop again.
const catalogMemory: { scrollTop: number; tool?: ToolId } = { scrollTop: 0 }

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
			catalogMemory.tool = shown.id
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
// catalog; Enter opens the only tool it leaves, and ArrowDown
// moves to the cards. The cards are one Tab stop, the last one focused or opened; ArrowUp and ArrowDown move between
// the openable ones by row as the grid is laid out, across groups, and ArrowLeft, ArrowRight, Home, and End in reading
// order. The scroll position is kept for the tab across tools and workspaces.
function ToolsCatalog() {
	const context = useToolReadinessContext()
	const [query, setQuery] = useState('')
	const [current, setCurrent] = useState(catalogMemory.tool)
	const scrollRef = useRef<HTMLDivElement>(null)
	const filterRef = useRef<HTMLInputElement>(null)
	const readiness = (id: ToolId) => toolReadiness(id, toolStatus(TOOL_DEFINITIONS[id]) === 'planned', context)
	const groups = catalogGroups(query, (id) => readiness(id)?.running === true)
	const openable = groups.flatMap((group) => group.tools).filter((id) => toolStatus(TOOL_DEFINITIONS[id]) === 'available')
	const tabStop = current !== undefined && openable.includes(current) ? current : openable[0]

	// Scrolls back to where the catalog was before it was last left, and remembers where it is when it is left.
	useLayoutEffect(() => {
		const scroller = scrollRef.current
		if (!scroller) return undefined
		scroller.scrollTop = catalogMemory.scrollTop
		return () => {
			catalogMemory.scrollTop = scroller.scrollTop
		}
	}, [])

	// Focuses the card of a tool.
	function focusCard(id: ToolId | undefined) {
		if (id) scrollRef.current?.querySelector<HTMLElement>(`[data-tool-card="${id}"]`)?.focus()
	}

	// Opens the only openable tool the filter leaves on Enter, and moves to the cards on ArrowDown.
	function handleFilterKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter' && openable.length === 1) navigate(routeState, { workspace: 'tools', tool: openable[0] })
		else if (e.key === 'ArrowDown' && tabStop) {
			e.preventDefault()
			focusCard(tabStop)
		}
	}

	// Moves the focus between the openable cards: ArrowUp and ArrowDown to the card above or below as the grid is laid
	// out, ArrowLeft and ArrowRight in reading order, and Home and End to the first and last.
	function handleCardsKeyDown(e: KeyboardEvent<HTMLElement>) {
		const focused = (document.activeElement as HTMLElement | null)?.dataset.toolCard
		if (focused === undefined) return
		const boxes = openable.map((id) => scrollRef.current?.querySelector(`[data-tool-card="${id}"]`)?.getBoundingClientRect() ?? { top: 0, left: 0, width: 0 })
		const index = moveInRows(boxes, openable.indexOf(focused as ToolId), e.key)
		if (index === undefined) return
		e.preventDefault()
		focusCard(openable[index])
	}

	// Clears the filter and keeps the focus in it, so the next query can be typed at once.
	function clearFilter() {
		setQuery('')
		filterRef.current?.focus()
	}

	const filter = (
		<TextInput
			ref={filterRef}
			type="search"
			title="Find a tool by what it does, such as dew, FOV, Moon, or flip; Enter opens the only match, ArrowDown moves to the tools"
			placeholder="Filter tools"
			value={query}
			onChange={(e) => setQuery(e.target.value)}
			onKeyDown={handleFilterKeyDown}
			className="w-56 max-sm:w-40"
		/>
	)

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
					<div onKeyDown={handleCardsKeyDown} className="flex flex-col gap-6">
						{groups.map((group) => (
							<section key={group.label} className="flex flex-col gap-2">
								<SectionHeading as="h2">{group.label}</SectionHeading>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2">
									{group.tools.map((id) => {
										const tool = TOOL_DEFINITIONS[id]
										return <ToolCard key={id} tool={tool} planned={toolStatus(tool) === 'planned'} readiness={readiness(id)} tabStop={id === tabStop} onFocus={() => setCurrent(id)} />
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
	// Whether the card is the catalog's one Tab stop.
	readonly tabStop: boolean
	// Called when the card takes the focus.
	readonly onFocus: () => void
}

// Catalog card of a tool: its summary (hidden on a phone, where the name alone keeps the list short), the full
// description as its tooltip, and, by exception, its readiness, whose reason is a caption wherever there is no hover to
// show a tooltip (a phone, or a touch screen of any width) and visually hidden text otherwise, so a screen reader still
// reads it with the card; clicking a tool that is not planned opens it, even when its readiness says what it lacks.
function ToolCard({ tool, planned, readiness, tabStop, onFocus }: ToolCardProps) {
	return (
		<button
			type="button"
			data-tool-card={tool.id}
			tabIndex={tabStop ? 0 : -1}
			onFocus={onFocus}
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
				{readiness && <span className="text-xs leading-4 text-pretty text-ink-300 [@media(hover:hover)_and_(min-width:40rem)]:sr-only">{readiness.reason}</span>}
			</span>
		</button>
	)
}
