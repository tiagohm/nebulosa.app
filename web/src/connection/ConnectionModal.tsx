import { type SubmitEvent, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { Modal } from '../ui/Modal'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { connect, type ConnectionInput, connectionState, DEFAULT_PORT, disconnect, removeConnection, saveConnection } from './connection'

// Modal that creates, edits, and removes saved connections, and connects or disconnects the selected one.

// Initial form values for a new connection: an INDI server on the default port.
const EMPTY_FORM: ConnectionInput = { name: '', host: '', port: DEFAULT_PORT, type: 'INDI' }

// Supported connection backends.
export const CONNECTION_TYPES = ['INDI', 'ALPACA', 'SIMULATOR'] as const

// Connections modal, shown while connectionState.open is true. The form on the left saves a new
// connection or the one being edited; the list on the right acts on the selected connection.
export function ConnectionModal() {
	const { open, connections, selected, active, loading, error } = useSnapshot(connectionState)
	const [form, setForm] = useState(EMPTY_FORM)
	// Id of the connection loaded into the form by Edit.
	const [editing, setEditing] = useState<string>()
	// Whether the selected connection is the one this tab holds open.
	const selectedIsActive = selected !== undefined && active?.connectionId === selected

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

	// Removes the selected connection, clearing the form when it was being edited.
	function handleRemove() {
		if (selected === undefined) return
		if (selected === editing) reset()
		removeConnection(connectionState, selected)
	}

	// Hides the modal; the tab's active connection stays open.
	function handleClose() {
		connectionState.open = false
	}

	// Connects the selected connection, or disconnects it when it is the tab's active one.
	function handleConnection() {
		if (selectedIsActive) {
			void disconnect(connectionState)
		} else {
			const connection = connectionState.connections.find((c) => c.id === selected)
			if (connection) void connect(connectionState, connection)
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
								<ListItem key={c.id} title={c.name} description={c.type === 'SIMULATOR' ? 'Built-in' : `${c.host}:${c.port}`} meta={active?.connectionId === c.id ? `${c.type} · Connected` : c.type} selected={c.id === selected} onClick={() => (connectionState.selected = c.id)} />
							))}
						</List>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button variant={selectedIsActive ? 'secondary' : 'primary'} disabled={selected === undefined || loading !== undefined || (active !== undefined && !selectedIsActive)} onClick={handleConnection}>
							{loading === 'connect' ? 'Connecting…' : loading === 'disconnect' ? 'Disconnecting…' : selectedIsActive ? 'Disconnect' : 'Connect'}
						</Button>
						<div className="ml-auto flex gap-2">
							<Button variant="secondary" disabled={selected === undefined || selectedIsActive} onClick={handleEdit}>
								Edit
							</Button>
							<Button variant="ghost" disabled={selected === undefined || selectedIsActive} onClick={handleRemove}>
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
