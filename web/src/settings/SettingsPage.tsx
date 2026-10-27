import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { Notice } from '../equipment-control/parts'
import { navigate, routeState } from '../shell/route'
import { useMediaQuery, WIDE_SCREEN } from '../shell/useMediaQuery'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { ExternalToolDetail } from './ExternalToolDetail'
import { externalToolsState, refreshExternalTools } from './externaltools'
import { ExternalToolsSelect, ExternalToolsSidebar } from './ExternalToolsSidebar'

// Settings page (the gear button of the top bar), whose only section is External Tools: the external programs the
// server supports, such as ASTAP, and the settings of the one shown. The program shown is part of the
// URL; without one, the first program is shown. Switching programs with unsaved changes asks before
// discarding them. Opening the page or selecting a program never runs or saves anything.

// Settings page.
export function SettingsPage() {
	const { route } = useSnapshot(routeState)
	const { tools, loading, loadError } = useSnapshot(externalToolsState)
	const wide = useMediaQuery(WIDE_SCREEN)
	const [dirty, setDirty] = useState(false)
	const [pending, setPending] = useState<string>()
	const toolId = route.workspace === 'settings' ? route.tool : undefined
	const selected = toolId ? tools.find((tool) => tool.id === toolId) : tools[0]

	function show(id: string) {
		setDirty(false)
		navigate(routeState, { workspace: 'settings', tool: id })
	}

	function select(id: string) {
		if (id === selected?.id) return
		if (dirty) setPending(id)
		else show(id)
	}

	function body() {
		if (tools.length === 0) return <EmptyState title={loading ? 'Loading external tools…' : 'No external tools'} description={loading ? undefined : 'The server reported no supported external tool.'} />

		const detail = selected ? <ExternalToolDetail key={selected.id} tool={selected} onDirtyChange={setDirty} /> : <EmptyState title="External tool not found" description="The server does not support this external tool." />

		return wide ? (
			<div className="flex min-h-0 flex-1">
				<ExternalToolsSidebar tools={tools} selected={selected?.id} onSelect={select} />
				{detail}
			</div>
		) : (
			<div className="flex min-h-0 flex-1 flex-col">
				<ExternalToolsSelect tools={tools} selected={selected?.id} onSelect={select} />
				{detail}
			</div>
		)
	}

	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<header className="flex min-h-12 flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-100 bg-base-100 px-4 py-1.5">
				<h1 className="m-0 flex-none text-sm font-semibold text-ink-100">Settings</h1>
				<span className="text-xs text-ink-200">External Tools</span>
				<div className="ml-auto flex flex-none items-center gap-2">
					<Button variant="secondary" disabled={loading} onClick={() => void refreshExternalTools(externalToolsState)}>
						Refresh
					</Button>
				</div>
			</header>
			{loadError && (
				<div className="flex-none border-b border-line-100 px-4 py-2">
					<Notice error>The external tools could not be loaded: {loadError}</Notice>
				</div>
			)}
			<div className="relative flex min-h-0 flex-1 flex-col">{body()}</div>
			<Modal open={pending !== undefined} onClose={() => setPending(undefined)} title="Discard unsaved changes?" className="max-w-md">
				<p className="m-0 text-[13px] leading-5 text-ink-200">The changes to {selected?.name} were not saved. Showing another external tool discards them.</p>
				<div className="mt-5 flex justify-end gap-2">
					<Button variant="secondary" onClick={() => setPending(undefined)}>
						Keep Editing
					</Button>
					<Button
						data-autofocus
						onClick={() => {
							if (pending) show(pending)
							setPending(undefined)
						}}
					>
						Discard Changes
					</Button>
				</div>
			</Modal>
		</section>
	)
}
