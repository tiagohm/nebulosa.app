import type { ConnectionType } from 'api'
import { type SubmitEvent, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { deviceState } from '../equipment/equipment'
import { activeProfile, forgetConnection, profileState, selectConnection } from '../profile/profile'
import { Button } from '../ui/Button'
import { ConfirmButton } from '../ui/ConfirmButton'
import { List, ListItem } from '../ui/List'
import { Modal } from '../ui/Modal'
import { NumberInput } from '../ui/NumberInput'
import { SectionHeading } from '../ui/SectionHeading'
import { Select } from '../ui/Select'
import { StatusBadge, type StatusTone } from '../ui/StatusBadge'
import { TextInput } from '../ui/TextInput'
import { connect, type Connection, type ConnectionInput, type ConnectionRequest, connectionState, DEFAULT_PORT, disconnect, highlightConnection, removeConnection, saveConnection, serverOf } from './connection'

// Modal that leads with the saved connections: it connects or disconnects the highlighted one on the server, makes it the
// one the active profile works with, and opens its Equipment Setup. Creating, editing, and removing a connection replace
// the list with a form until it is saved or cancelled. Opening it highlights the profile's connection.

// Initial form values for a new connection: an INDI server on the default port.
const EMPTY_FORM: ConnectionInput = { name: '', host: '', port: DEFAULT_PORT, type: 'INDI' }

// Supported connection backends.
export const CONNECTION_TYPES = ['INDI', 'ALPACA', 'SIMULATOR'] as const

// Display name of each connection backend.
const TYPE_LABELS: Readonly<Record<ConnectionType, string>> = { INDI: 'INDI', ALPACA: 'Alpaca', SIMULATOR: 'Simulator' }

// Returns the display name of a connection backend.
function typeLabel(type: ConnectionType): string {
	return TYPE_LABELS[type]
}

// What the form shows: a new connection, or the saved connection of the given id being edited.
type FormView = { readonly kind: 'new' } | { readonly kind: 'edit'; readonly id: string }

// Status of a saved connection in the list: a word, its tone, and the failure message as its tooltip.
interface ConnectionStatusView {
	// Tone of the badge.
	readonly tone: StatusTone
	// State in words.
	readonly label: string
	// Message of the last failure, when the state is Failed.
	readonly title?: string
}

// Returns the status of a saved connection from its pending request, whether the server holds it open, and its last failure.
function connectionStatus(pending: ConnectionRequest['kind'] | undefined, connected: boolean, error: string | undefined): ConnectionStatusView {
	if (pending === 'connect') return { tone: 'active', label: 'Connecting…' }
	if (pending === 'disconnect') return { tone: 'active', label: 'Disconnecting…' }
	if (connected) return { tone: 'success', label: 'Connected' }
	if (error) return { tone: 'danger', label: 'Failed', title: error }
	return { tone: 'muted', label: 'Disconnected' }
}

// Returns the list description of a saved connection: its backend, its endpoint unless it is the simulator, and whether
// the active profile uses it.
function connectionDescription(connection: Connection, inProfile: boolean): string {
	return [typeLabel(connection.type), connection.type !== 'SIMULATOR' && `${connection.host}:${connection.port}`, inProfile && 'In use'].filter(Boolean).join(' · ')
}

// Returns what to check after a failed connect or disconnect of a saved connection, or undefined for the simulator,
// which runs inside the Nebulosa server.
function recoveryHint(connection: Connection): string | undefined {
	if (connection.type === 'SIMULATOR') return undefined
	return `Check that the ${typeLabel(connection.type)} server is running at ${connection.host}:${connection.port} and reachable from the Nebulosa server, then try again.`
}

// Returns why the form cannot be saved: a blank name, or a blank host unless the type is SIMULATOR; undefined when it can.
function saveBlocker({ name, host, type }: ConnectionInput): string | undefined {
	if (name.trim().length === 0) return 'Enter a name'
	if (type !== 'SIMULATOR' && host.trim().length === 0) return 'Enter the host of the server'
	return undefined
}

// Returns the confirmation message of removing a saved connection, naming the profiles that lose it and its equipment setup.
function removalMessage(profileNames: readonly string[]): string {
	const loss = profileNames.length === 0 ? 'No profile uses it.' : `${new Intl.ListFormat('en', { type: 'conjunction' }).format(profileNames.map((name) => `“${name}”`))} ${profileNames.length === 1 ? 'loses' : 'lose'} this connection and its equipment setup.`
	return `${loss} This cannot be undone.`
}

// Connections modal, shown while connectionState.open is true: the saved connections and the actions on the highlighted
// one, or the form that creates or edits one.
export function ConnectionModal() {
	const { open, connections, selected } = useSnapshot(connectionState)
	const [view, setView] = useState<FormView>()
	// Saved connection being edited; undefined for a new one or once another tab removed it.
	const edited = view?.kind === 'edit' ? connections.find((c) => c.id === view.id) : undefined

	// Highlights the active profile's connection each time the modal opens.
	useEffect(() => {
		if (open && profileState.profiles.length > 0) highlightConnection(connectionState, activeProfile(profileState).connectionId)
	}, [open])

	// Returns to the list when the connection being edited is removed, such as by another tab.
	useEffect(() => {
		if (view?.kind === 'edit' && !edited) setView(undefined)
	}, [view, edited])

	// Hides the modal and returns it to the list with nothing highlighted, so it opens on the profile's connection; open
	// connections stay open.
	function handleClose() {
		connectionState.open = false
		connectionState.selected = undefined
		setView(undefined)
	}

	return (
		<Modal open={open} onClose={handleClose} title="Connections" className="max-w-160">
			{view === undefined ? <ConnectionList onNew={() => setView({ kind: 'new' })} onEdit={() => selected !== undefined && setView({ kind: 'edit', id: selected })} /> : <ConnectionForm key={view.kind === 'edit' ? view.id : 'new'} connection={edited} onDone={() => setView(undefined)} />}
		</Modal>
	)
}

// Properties of the list view of the Connections modal.
interface ConnectionListProps {
	// Opens the form for a new connection.
	readonly onNew: () => void
	// Opens the form on the highlighted connection.
	readonly onEdit: () => void
}

// Saved connections with their status, and the actions on the highlighted one: connect or disconnect, use it in the
// profile, open its Equipment Setup, and edit it.
function ConnectionList({ onNew, onEdit }: ConnectionListProps) {
	const { connections, selected, servers, loading, errors } = useSnapshot(connectionState)
	const profiles = useSnapshot(profileState)
	const profileConnectionId = profiles.profiles.length > 0 ? activeProfile(profiles).connectionId : undefined
	const selectedConnection = connections.find((c) => c.id === selected)
	// Whether the server holds the highlighted connection open, for this or another tab.
	const selectedIsOpen = serverOf(servers, selectedConnection) !== undefined
	// Pending request on the highlighted connection.
	const selectedLoading = loading?.connectionId === selected ? loading?.kind : undefined
	// Failure of the highlighted connection's last connect or disconnect.
	const error = selected === undefined ? undefined : errors[selected]
	const inProfile = selected !== undefined && selected === profileConnectionId
	// Row that takes the focus: the highlighted one, else the profile's, else the first.
	const focusId = selected ?? (connections.some((c) => c.id === profileConnectionId) ? profileConnectionId : connections[0]?.id)
	const empty = connections.length === 0

	// Disconnects the highlighted connection when the server holds it open; otherwise connects it, and makes it the
	// active profile's connection once the server holds it open, so a failed attempt leaves the profile as it was.
	async function handleConnection() {
		const connection = connectionState.connections.find((c) => c.id === selected)
		if (!connection) return

		if (serverOf(connectionState.servers, connection)) {
			await disconnect(connectionState, connection)
		} else {
			await connect(connectionState, connection)
			if (serverOf(connectionState.servers, connection)) selectConnection(profileState, connection.id)
		}
	}

	// Makes the highlighted connection the one the active profile works with, without opening it.
	function handleUse() {
		if (selected !== undefined) selectConnection(profileState, selected)
	}

	// Closes this modal and opens the Equipment Setup of the profile's connection.
	function handleEquipment() {
		connectionState.open = false
		deviceState.open = true
	}

	const connectBlocker = selected === undefined ? 'Select a connection' : loading !== undefined && selectedLoading === undefined ? 'Wait for the pending request to finish' : undefined

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-4">
				<SectionHeading className="flex-1">Saved connections · {connections.length}</SectionHeading>
				<Button variant={empty ? 'primary' : 'secondary'} data-autofocus={empty || undefined} onClick={onNew}>
					New connection
				</Button>
			</div>
			<div className="max-h-80 overflow-y-auto">
				<List emptyText="No saved connections yet. Add the INDI or Alpaca server of your rig, or the built-in simulator, with New connection.">
					{connections.map((c) => {
						const status = connectionStatus(loading?.connectionId === c.id ? loading.kind : undefined, serverOf(servers, c) !== undefined, errors[c.id])
						return (
							<ListItem
								key={c.id}
								title={c.name}
								description={connectionDescription(c, c.id === profileConnectionId)}
								meta={<StatusBadge tone={status.tone} label={status.label} title={status.title} />}
								selected={c.id === selected}
								autoFocus={c.id === focusId}
								onClick={() => (connectionState.selected = c.id)}
							/>
						)
					})}
				</List>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button variant={selectedIsOpen ? 'secondary' : 'primary'} disabled={connectBlocker !== undefined || selectedLoading !== undefined} title={connectBlocker ?? (selectedIsOpen ? 'Closes this connection for every tab and browser' : undefined)} onClick={() => void handleConnection()}>
					{selectedLoading === 'connect' ? 'Connecting…' : selectedLoading === 'disconnect' ? 'Disconnecting…' : selectedIsOpen ? 'Disconnect' : 'Connect'}
				</Button>
				<Button variant="secondary" disabled={selected === undefined || inProfile} title={selected === undefined ? 'Select a connection' : inProfile ? 'The active profile already uses this connection' : undefined} onClick={handleUse}>
					Use in profile
				</Button>
				<Button variant="secondary" disabled={!inProfile} title={selected === undefined ? 'Select a connection' : inProfile ? undefined : 'Use this connection in the profile to set up its equipment'} onClick={handleEquipment}>
					Equipment Setup
				</Button>
				<Button variant="secondary" className="ml-auto" disabled={selected === undefined || selectedIsOpen} title={selected === undefined ? 'Select a connection' : selectedIsOpen ? 'Disconnect to edit' : undefined} onClick={onEdit}>
					Edit
				</Button>
			</div>
			{error && selectedConnection && (
				<div className="flex flex-col gap-1 text-sm leading-5">
					<p className="m-0 text-danger">{error}</p>
					{recoveryHint(selectedConnection) && <p className="m-0 text-ink-300">{recoveryHint(selectedConnection)}</p>}
				</div>
			)}
		</div>
	)
}

// Properties of the form view of the Connections modal.
interface ConnectionFormProps {
	// Saved connection to edit; undefined for a new one.
	readonly connection?: Connection
	// Returns to the list, after a save, a removal, or Cancel.
	readonly onDone: () => void
}

// Form that saves a new connection or the edited one, and removes the edited one once confirmed.
function ConnectionForm({ connection, onDone }: ConnectionFormProps) {
	const [form, setForm] = useState<ConnectionInput>(() => (connection ? { name: connection.name, host: connection.host, port: connection.port, type: connection.type } : EMPTY_FORM))
	const { servers } = useSnapshot(connectionState)
	const profiles = useSnapshot(profileState)
	const blocker = saveBlocker(form)
	// Whether the server holds the edited connection open, which blocks its removal.
	const isOpen = serverOf(servers, connection) !== undefined
	// Names of the profiles that select the edited connection or keep an equipment setup for it.
	const affected = connection ? profiles.profiles.filter((p) => p.connectionId === connection.id || connection.id in p.equipment).map((p) => p.name) : []

	// Saves the form as a new connection, or over the edited one, and returns to the list on success.
	function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
		e.preventDefault()
		if (saveConnection(connectionState, form, connection?.id)) onDone()
	}

	// Removes the edited connection; profiles that used it lose their selection and its equipment setup.
	function handleRemove() {
		if (!connection) return
		removeConnection(connectionState, connection.id)
		forgetConnection(profileState, connection.id)
		onDone()
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<SectionHeading>{connection ? 'Edit connection' : 'New connection'}</SectionHeading>
			<TextInput autoFocus label="Name" placeholder="Observatory" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
			<Select label="Type" className="flex-none" options={CONNECTION_TYPES} format={typeLabel} value={form.type} onChange={(type) => setForm({ ...form, type })} />
			<div className="grid grid-cols-[minmax(0,1fr)_11rem] gap-4">
				<TextInput type="url" disabled={form.type === 'SIMULATOR'} title={form.type === 'SIMULATOR' ? 'The simulator runs inside the Nebulosa server' : undefined} label="Host" placeholder="192.168.0.10" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
				<NumberInput disabled={form.type === 'SIMULATOR'} label="Port" min={1} max={65535} value={form.port} onChange={(port) => setForm({ ...form, port })} />
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-2">
				{connection && (
					<ConfirmButton destructive disabled={isOpen} tooltip={isOpen ? 'Disconnect to remove' : undefined} title={`Remove “${connection.name}”?`} message={removalMessage(affected)} confirmLabel="Remove" onConfirm={handleRemove}>
						Remove
					</ConfirmButton>
				)}
				<div className="ml-auto flex gap-2">
					<Button variant="secondary" onClick={onDone}>
						Cancel
					</Button>
					<Button type="submit" disabled={blocker !== undefined} title={blocker}>
						Save
					</Button>
				</div>
			</div>
		</form>
	)
}
