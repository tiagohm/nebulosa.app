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

// External Tools section of the Settings page: the external programs the server supports, such as ASTAP, and the
// settings of the one shown. The program shown is part of the URL; without one, the first program is shown.
// Switching programs with unsaved changes asks before discarding them. Opening the section or selecting a program
// never runs or saves anything.

export interface ExternalToolsSettingsProps {
	// Id of the program shown, from the route; absent shows the first one.
	readonly tool?: string
}

// Header action of the section: fetches the programs and their states again.
export function ExternalToolsActions() {
	const { loading } = useSnapshot(externalToolsState)

	return (
		<Button variant="secondary" disabled={loading} onClick={() => void refreshExternalTools(externalToolsState)}>
			Refresh
		</Button>
	)
}

// Content of the External Tools section.
export function ExternalToolsSettings({ tool }: ExternalToolsSettingsProps) {
	const { tools, loading, loadError } = useSnapshot(externalToolsState)
	const wide = useMediaQuery(WIDE_SCREEN)
	const [dirty, setDirty] = useState(false)
	const [pending, setPending] = useState<string>()
	const selected = tool ? tools.find((entry) => entry.id === tool) : tools[0]

	function show(id: string) {
		setDirty(false)
		navigate(routeState, { workspace: 'settings', section: 'external-tools', tool: id })
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
		<>
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
		</>
	)
}
