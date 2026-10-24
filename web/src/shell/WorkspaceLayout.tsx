import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { activeProfile, panelOpen, profileState, setPanelOpen } from '../profile/profile'
import { IconButton } from '../ui/IconButton'
import { ContextualPanel } from './ContextualPanel'
import type { WorkspaceId } from './route'
import { useMediaQuery, WIDE_SCREEN } from './useMediaQuery'

// Common frame of every workspace: optional tabs spanning the whole workspace (such as the Images document and
// camera tabs), a header with the title, the workspace's context controls (such as the Images tool selector)
// and actions, the main content, and the collapsible contextual panel. On
// wide screens the panel's visibility is a preference of the active profile, kept per workspace; on
// narrow screens it is a drawer that starts closed and is never persisted.

// Contextual panel content of a workspace.
export interface WorkspacePanel {
	// Heading of the panel.
	readonly title: string
	// Controls of the current context.
	readonly content: ReactNode
}

export interface WorkspaceLayoutProps {
	// Workspace the layout belongs to; keys its panel preference.
	readonly workspace: WorkspaceId
	// Workspace name shown in the header.
	readonly title: string
	// Context controls shown after the title, such as an operational mode selector.
	readonly context?: ReactNode
	// Actions shown at the end of the header, before the panel toggle.
	readonly actions?: ReactNode
	// Contextual panel; absent when the workspace has none.
	readonly panel?: WorkspacePanel
	// Tabs shown above the header, the content, and the panel, selecting the context all of them show.
	readonly tabs?: ReactNode
	// Main content; fills the remaining space and manages its own scrolling.
	readonly children: ReactNode
}

// Frame of a workspace.
export function WorkspaceLayout({ workspace, title, context, actions, panel, tabs, children }: WorkspaceLayoutProps) {
	const docked = useMediaQuery(WIDE_SCREEN)
	const profiles = useSnapshot(profileState)
	const [drawerOpen, setDrawerOpen] = useState(false)
	const open = docked ? panelOpen(activeProfile(profiles).settings, workspace) : drawerOpen

	function setOpen(value: boolean) {
		if (docked) setPanelOpen(profileState, workspace, value)
		else setDrawerOpen(value)
	}

	const frame = (
		<section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-12 flex-none items-center gap-3 border-b border-line-100 bg-base-100 px-4">
					<h1 className="m-0 flex-none text-sm font-semibold text-ink-100">{title}</h1>
					{context && <div className="flex min-w-0 items-center gap-2">{context}</div>}
					<div className="ml-auto flex flex-none items-center gap-1">
						{actions}
						{panel && <IconButton icon="panel" label={open ? 'Hide panel' : 'Show panel'} pressed={open} onClick={() => setOpen(!open)} />}
					</div>
				</header>
				<div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
			</div>
			{panel && (
				<ContextualPanel title={panel.title} open={open} docked={docked} onClose={() => setOpen(false)}>
					{panel.content}
				</ContextualPanel>
			)}
		</section>
	)

	if (!tabs) return frame

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{tabs}
			{frame}
		</div>
	)
}

export interface EmptyStateProps {
	// Short statement of the state.
	readonly title: string
	// Explanation of the state or of how to leave it.
	readonly description?: ReactNode
	// Action that resolves the state, such as a button.
	readonly action?: ReactNode
}

// Centered message for a workspace or panel with nothing to show yet.
export function EmptyState({ title, description, action }: EmptyStateProps) {
	return (
		<div className="flex w-full h-full flex-col items-center justify-center gap-3 p-6 text-center">
			<p className="m-0 text-sm font-medium text-ink-100">{title}</p>
			{description && <p className="m-0 max-w-sm text-[13px] leading-5 text-ink-300">{description}</p>}
			{action}
		</div>
	)
}
