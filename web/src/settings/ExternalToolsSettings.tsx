import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { navigate, routeState, setLeaveGuard } from '../shell/route'
import { useMediaQuery, WIDE_SCREEN } from '../shell/useMediaQuery'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { Modal, ModalActions } from '../ui/Modal'
import { Notice } from '../ui/Notice'
import { ExternalToolDetail } from './ExternalToolDetail'
import { externalToolsState, refreshExternalTools } from './externaltools'
import { ExternalToolsSelect, ExternalToolsSidebar } from './ExternalToolsSidebar'

// External Tools section of the Settings page: the external programs the server supports, such as MediaMTX, and the
// settings of the one shown. The program shown is part of the URL; without one, the first program is shown.
// Leaving a program with unsaved changes, for another program, another section, or another workspace, asks before
// discarding them. Opening the section or selecting a program never runs or saves anything.

export interface ExternalToolsSettingsProps {
	// Id of the program shown, from the route; absent shows the first one.
	readonly tool?: string
}

// Header action of the section: fetches the programs and their states again.
export function ExternalToolsActions() {
	const { loading } = useSnapshot(externalToolsState)

	return (
		<Button variant="secondary" disabled={loading} title={loading ? 'Loading the external tools…' : 'Fetch the external tools and their states from the server again'} onClick={() => void refreshExternalTools(externalToolsState)}>
			Reload
		</Button>
	)
}

// Content of the External Tools section.
export function ExternalToolsSettings({ tool }: ExternalToolsSettingsProps) {
	const { tools, loading, loadError } = useSnapshot(externalToolsState)
	const wide = useMediaQuery(WIDE_SCREEN)
	const [dirty, setDirty] = useState(false)
	// Navigation held by the leave guard until the person discards the changes or keeps editing.
	const [pending, setPending] = useState<() => void>()
	const selected = tool ? tools.find((entry) => entry.id === tool) : tools[0]

	// Holds every navigation away from the program while its changes are unsaved.
	useEffect(() => {
		if (!dirty) return undefined
		return setLeaveGuard((proceed) => {
			setPending(() => proceed)
			return false
		})
	}, [dirty])

	function select(id: string) {
		if (id !== selected?.id) navigate(routeState, { workspace: 'settings', section: 'external-tools', tool: id })
	}

	function discard() {
		const proceed = pending
		setPending(undefined)
		setDirty(false)
		proceed?.()
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
				<p className="m-0 text-sm leading-5 text-ink-200">The changes to {selected?.name} were not saved. Leaving them discards them.</p>
				<ModalActions>
					<Button variant="secondary" onClick={() => setPending(undefined)} data-autofocus>
						Keep Editing
					</Button>
					<Button variant="danger" onClick={discard}>
						Discard Changes
					</Button>
				</ModalActions>
			</Modal>
		</>
	)
}
