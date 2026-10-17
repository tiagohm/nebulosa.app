import { type SubmitEvent, useState } from 'react'
import { useSnapshot } from 'valtio'
import { activeProfile, forgetConnection, profileState, selectConnection } from '../profile/profile'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { Modal } from '../ui/Modal'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { connect, type Connection, type ConnectionInput, connectionState, DEFAULT_PORT, disconnect, removeConnection, saveConnection, serverOf } from './connection'

// Modal that creates, edits, and removes saved connections, selects the one the active profile works
// with, and connects or disconnects the highlighted one on the server.

// Initial form values for a new connection: an INDI server on the default port.
const EMPTY_FORM: ConnectionInput = { name: '', host: '', port: DEFAULT_PORT, type: 'INDI' }

// Supported connection backends.
export const CONNECTION_TYPES = ['INDI', 'ALPACA', 'SIMULATOR'] as const

// Returns the list description of a saved connection: its endpoint, whether the active profile uses it,
// and whether the server holds it open.
function connectionDescription(connection: Connection, inProfile: boolean, connected: boolean): string {
	return [connection.type === 'SIMULATOR' ? 'Built-in' : `${connection.host}:${connection.port}`, inProfile && 'In use', connected && 'Connected'].filter(Boolean).join(' · ')
}

// Connections modal, shown while connectionState.open is true. The form on the left saves a new
// connection or the one being edited; the list on the right acts on the highlighted connection.
export function ConnectionModal() {
	const { open, connections, selected, servers, loading, error } = useSnapshot(connectionState)
	const profiles = useSnapshot(profileState)
	const profileConnectionId = profiles.profiles.length > 0 ? activeProfile(profiles).connectionId : undefined
	const [form, setForm] = useState(EMPTY_FORM)
	// Id of the connection loaded into the form by Edit.
	const [editing, setEditing] = useState<string>()
	const selectedConnection = connections.find((c) => c.id === selected)
	// Whether the server holds the highlighted connection open, for this or another tab.
	const selectedIsOpen = serverOf(servers, selectedConnection) !== undefined
	// Pending request on the highlighted connection.
	const selectedLoading = loading?.connectionId === selected ? loading?.kind : undefined

	// Clears the form and leaves edit mode.
	function reset() {
		setForm(EMPTY_FORM)
		setEditing(undefined)
	}

	// Saves the form as a new connection, or over the one being edited, and clears the form on success.
	function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
		e.preventDefault()
		if (saveConnection(connectionState, form, editing)) reset()
	}

	// Loads the selected connection into the form for editing.
	function handleEdit() {
		const connection = connections.find((c) => c.id === selected)
		if (!connection) return
		setForm({ name: connection.name, host: connection.host, port: connection.port, type: connection.type })
		setEditing(connection.id)
	}

	// Removes the selected connection, clearing the form when it was being edited. Profiles that used it
	// lose their selection and its equipment setup.
	function handleRemove() {
		if (selected === undefined) return
		if (selected === editing) reset()
		removeConnection(connectionState, selected)
		forgetConnection(profileState, selected)
	}

	// Hides the modal; open connections stay open.
	function handleClose() {
		connectionState.open = false
	}

	// Makes the highlighted connection the one the active profile works with, without opening it.
	function handleUse() {
		if (selected !== undefined) selectConnection(profileState, selected)
	}

	// Disconnects the highlighted connection when the server holds it open; otherwise selects it for the
	// active profile and connects it.
	function handleConnection() {
		const connection = connectionState.connections.find((c) => c.id === selected)
		if (!connection) return

		if (selectedIsOpen) {
			void disconnect(connectionState, connection)
		} else {
			selectConnection(profileState, connection.id)
			void connect(connectionState, connection)
		}
	}

	// Whether the form can be saved: the name is not blank, and the host is not blank unless the type is SIMULATOR.
	function canSave() {
		const { name, host, type } = form

		if (name.trim().length === 0) {
			return false
		}

		return type === 'SIMULATOR' || host.trim().length > 0
	}

	return (
		<Modal open={open} onClose={handleClose} title="Connections" className="max-w-[760px]">
			<div className="flex flex-wrap gap-6">
				<form onSubmit={handleSubmit} className="flex flex-[1_1_280px] flex-col gap-4 border-r border-line-100 pr-6 max-sm:border-r-0 max-sm:pr-0">
					<div className="text-xs font-medium tracking-[0.04em] text-ink-300 uppercase">{editing ? 'Edit connection' : 'New connection'}</div>
					<TextInput data-autofocus label="Name" placeholder="Observatory" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
					<div className="grid grid-cols-2 gap-4">
						<TextInput disabled={form.type === 'SIMULATOR'} label="Host" placeholder="192.168.0.10" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
						<NumberInput disabled={form.type === 'SIMULATOR'} label="Port" min={1} max={65535} value={form.port} onChange={(port) => setForm({ ...form, port })} />
					</div>
					<Select label="Type" options={CONNECTION_TYPES} value={form.type} onChange={(type) => setForm({ ...form, type })} />
					<div className="flex gap-2">
						<Button disabled={!canSave()} type="submit">
							Save
						</Button>
						{editing && (
							<Button variant="secondary" onClick={reset}>
								Cancel
							</Button>
						)}
					</div>
				</form>
				<div className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
					<div className="text-xs font-medium tracking-[0.04em] text-ink-300 uppercase">Saved connections · {connections.length}</div>
					<div className="h-full overflow-y-auto">
						<List emptyText="No saved connections yet.">
							{connections.map((c) => (
								<ListItem key={c.id} title={c.name} description={connectionDescription(c, c.id === profileConnectionId, serverOf(servers, c) !== undefined)} meta={c.type} selected={c.id === selected} onClick={() => (connectionState.selected = c.id)} />
							))}
						</List>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button variant={selectedIsOpen ? 'secondary' : 'primary'} disabled={selected === undefined || loading !== undefined} onClick={handleConnection}>
							{selectedLoading === 'connect' ? 'Connecting…' : selectedLoading === 'disconnect' ? 'Disconnecting…' : selectedIsOpen ? 'Disconnect' : 'Connect'}
						</Button>
						<Button variant="secondary" disabled={selected === undefined || selected === profileConnectionId} onClick={handleUse}>
							Use in profile
						</Button>
						<div className="ml-auto flex gap-2">
							<Button variant="secondary" disabled={selected === undefined || selectedIsOpen} onClick={handleEdit}>
								Edit
							</Button>
							<Button variant="ghost" disabled={selected === undefined || selectedIsOpen} onClick={handleRemove}>
								Remove
							</Button>
						</div>
						{error && <p className="m-0 basis-full text-[13px] leading-5 text-danger">{error}</p>}
					</div>
				</div>
			</div>
		</Modal>
	)
}
