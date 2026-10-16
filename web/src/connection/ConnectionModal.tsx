import { type SubmitEvent, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Button } from '../ui/Button'
import { List, ListItem } from '../ui/List'
import { Modal } from '../ui/Modal'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { CONNECTION_TYPES, type ConnectionInput, connectionState, DEFAULT_PORT, removeConnection, saveConnection } from './connection'

const EMPTY_FORM: ConnectionInput = { name: '', host: '', port: DEFAULT_PORT, type: 'INDI' }

export function ConnectionModal() {
	const { open, connections, selected } = useSnapshot(connectionState)
	const [form, setForm] = useState(EMPTY_FORM)
	// Id of the connection loaded into the form by Edit.
	const [editing, setEditing] = useState<string>()

	function reset() {
		setForm(EMPTY_FORM)
		setEditing(undefined)
	}

	function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
		e.preventDefault()
		if (saveConnection(connectionState, form, editing)) reset()
	}

	function handleEdit() {
		const connection = connections.find((c) => c.id === selected)
		if (!connection) return
		setForm({ name: connection.name, host: connection.host, port: connection.port, type: connection.type })
		setEditing(connection.id)
	}

	function handleRemove() {
		if (selected === undefined) return
		if (selected === editing) reset()
		removeConnection(connectionState, selected)
	}

	function handleClose() {
		connectionState.open = false
	}

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
								<ListItem key={c.id} title={c.name} description={`${c.host}:${c.port}`} meta={c.type} selected={c.id === selected} onClick={() => (connectionState.selected = c.id)} />
							))}
						</List>
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						<Button variant="secondary" disabled={selected === undefined} onClick={handleEdit}>
							Edit
						</Button>
						<Button variant="ghost" disabled={selected === undefined} onClick={handleRemove}>
							Remove
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	)
}
