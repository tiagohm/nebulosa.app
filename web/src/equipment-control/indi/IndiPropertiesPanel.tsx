import { useMemo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Button } from '../../ui/Button'
import { TextInput } from '../../ui/TextInput'
import { Notice } from '../parts'
import { indiView } from './indi'
import { groupVectors, searchVectors } from './indi.format'
import { IndiPropertyVector } from './IndiPropertyVector'
import { useIndiSubscription, useWatchedIndiDevices } from './useIndi'

// INDI Properties view of one physical device in Equipment Control: every vector its driver defines, grouped by
// the driver's groups in driver order, with a search over group, vector, and element names and labels, and
// collapsible groups (several may be open; the first one is open at first). Groups and vectors appear, change,
// and disappear as the driver defines, updates, and deletes them. Showing the view subscribes to the device's
// property stream, and leaving it unsubscribes; neither connects, disconnects, nor stops anything.

export interface IndiPropertiesPanelProps {
	// Id of the open connection of the device.
	readonly connectionId: string
	// Id of the physical device.
	readonly hardwareId: string
}

// INDI properties of a device.
export function IndiPropertiesPanel({ connectionId, hardwareId }: IndiPropertiesPanelProps) {
	const devices = useWatchedIndiDevices()
	const present = devices.some((device) => device.connectionId === connectionId && device.hardwareId === hardwareId)
	useIndiSubscription(connectionId, hardwareId, present)

	const view = useSnapshot(indiView)
	const [query, setQuery] = useState('')
	// Groups the user opened; undefined until they open or close one, when the first group is open.
	const [expanded, setExpanded] = useState<ReadonlySet<string>>()
	const groups = useMemo(() => groupVectors(view.vectors), [view.vectors])
	const searching = query.trim() !== ''
	const shown = searchVectors(groups, query)
	const open = expanded ?? new Set(groups.slice(0, 1).map((group) => group.name))
	const count = shown.reduce((total, group) => total + group.vectors.length, 0)

	function toggle(name: string, isOpen: boolean) {
		// A search shows its matches open without changing what the user opened.
		if (searching || open.has(name) === isOpen) return
		const next = new Set(open)
		if (isOpen) next.add(name)
		else next.delete(name)
		setExpanded(next)
	}

	if (!present) return <Message>The INDI server no longer reports this device.</Message>
	if (view.status === 'refused') return <Message error>{view.error ?? 'The properties of this device cannot be shown.'}</Message>
	if (view.vectors.length === 0) return <Message>{view.status === 'ready' ? 'The driver defines no property.' : 'Loading the properties…'}</Message>

	return (
		<div className="flex flex-col">
			<div className="flex flex-wrap items-center gap-2 border-b border-line-100 px-4 py-3">
				<TextInput className="min-w-48 flex-1" placeholder="Search properties" value={query} onChange={(event) => setQuery(event.target.value)} />
				<span className="text-xs text-ink-300">
					{shown.length} {shown.length === 1 ? 'group' : 'groups'} · {count} {count === 1 ? 'property' : 'properties'}
				</span>
				<Button size="sm" variant="secondary" onClick={() => setExpanded(new Set(groups.map((group) => group.name)))}>
					Expand all
				</Button>
				<Button size="sm" variant="secondary" onClick={() => setExpanded(new Set())}>
					Collapse all
				</Button>
			</div>
			{shown.length === 0 && <Message>No property matches the search.</Message>}
			{shown.map((group) => (
				<details key={group.name} open={searching || open.has(group.name)} onToggle={(event) => toggle(group.name, event.currentTarget.open)} className="border-b border-line-100 px-4">
					<summary className="cursor-pointer py-3 text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase select-none">
						{group.name} · {group.vectors.length}
					</summary>
					<div className="flex flex-col pb-1">
						{group.vectors.map((vector) => (
							<IndiPropertyVector key={`${view.epoch}:${vector.name}:${view.definitions[vector.name] ?? 0}`} vector={vector} />
						))}
					</div>
				</details>
			))}
			{view.messages.length > 0 && (
				<details className="border-b border-line-100 px-4">
					<summary className="cursor-pointer py-3 text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase select-none">Driver messages · {view.messages.length}</summary>
					<ol className="m-0 flex list-none flex-col gap-1 p-0 pb-3 text-xs text-ink-200">
						{view.messages.toReversed().map((message) => (
							<li key={message.id} className="break-words">
								{message.timestamp && <span className="mr-2 font-mono text-ink-300">{message.timestamp}</span>}
								{message.message}
							</li>
						))}
					</ol>
				</details>
			)}
		</div>
	)
}

// One line explaining what the view shows instead of properties.
function Message({ error = false, children }: { readonly error?: boolean; readonly children: string }) {
	return (
		<div className="px-4 py-3">
			<Notice error={error}>{children}</Notice>
		</div>
	)
}
