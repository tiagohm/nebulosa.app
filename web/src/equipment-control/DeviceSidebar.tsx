import { type KeyboardEvent, useState } from 'react'
import { useSnapshot } from 'valtio'
import type { DeviceView } from '../equipment/equipment'
import { deviceBusy, operationsState } from '../operations'
import { List, ListItem } from '../ui/List'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { controlRuntime } from './control'
import { type DeviceGroup, groupActivity, groupTypes, searchGroups } from './groups'
import { TONE_COLORS } from './parts'

// Device list of the Equipment Control page: every physical device of the connection, once, with its type
// and what it reports doing, searchable by name or type; ArrowDown in the search moves into the list. Wide screens show
// it as a sidebar, the activity on the line under the name so names keep the whole row; narrow ones show a select
// instead, whose entries name the activity before the type so a cut entry still says it. Selecting a device only shows
// it: nothing is connected or commanded.

export interface DeviceListProps {
	// Physical devices of the connection.
	readonly groups: readonly DeviceGroup[]
	// Device runtime of the connection, for pending connect requests and errors.
	readonly runtime: DeviceView
	// Group shown, if any.
	readonly selected?: DeviceGroup
	// Shows a group.
	readonly onSelect: (group: DeviceGroup) => void
}

// Activity of a group as colored text.
function useActivity(runtime: DeviceView) {
	const control = useSnapshot(controlRuntime)
	const operations = useSnapshot(operationsState)

	return (group: DeviceGroup) => {
		// The writes of INDI properties name the physical device when no interface manages it.
		const busy = group.devices.some((device) => deviceBusy(operations, device.connectionId, device.id)) || (group.indi !== undefined && deviceBusy(operations, group.indi.connectionId, group.hardwareId))
		const error = group.devices.map((device) => runtime.errors[device.id]).find(Boolean)
		return groupActivity(group, control.states, busy, group.primary && runtime.pending[group.primary.id], error)
	}
}

// Moves the focus from the search into the list on ArrowDown, to its first device.
function enterList(event: KeyboardEvent<HTMLInputElement>) {
	if (event.key !== 'ArrowDown') return
	const first = event.currentTarget.closest('aside')?.querySelector<HTMLButtonElement>('li button')
	if (!first) return
	event.preventDefault()
	first.focus()
}

// Searchable list of the devices, for wide screens.
export function DeviceSidebar({ groups, runtime, selected, onSelect }: DeviceListProps) {
	const [query, setQuery] = useState('')
	const activityOf = useActivity(runtime)
	const shown = searchGroups(groups, query)

	return (
		<aside className="flex w-80 flex-none flex-col border-r border-line-100 bg-base-000">
			<div className="flex-none p-3">
				<TextInput placeholder="Search devices" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={enterList} />
			</div>
			<List emptyText={query ? 'No device matches the search.' : 'No devices.'} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				{shown.map((group) => {
					const activity = activityOf(group)

					const description = (
						<>
							{groupTypes(group)} · <span className={TONE_COLORS[activity.tone]}>{activity.label}</span>
						</>
					)

					return <ListItem opens key={group.hardwareId} title={group.name} description={description} selected={group === selected} onClick={() => onSelect(group)} />
				})}
			</List>
		</aside>
	)
}

// Value of the select when no device is shown.
const NONE = ''

// Select of the devices, for narrow screens.
export function DeviceSelect({ groups, runtime, selected, onSelect }: DeviceListProps) {
	const activityOf = useActivity(runtime)
	const options = [NONE, ...groups.map((group) => group.id)]

	function format(id: string) {
		const group = groups.find((g) => g.id === id)
		return group ? `${group.name} · ${activityOf(group).label} · ${groupTypes(group)}` : 'Select a device'
	}

	return (
		<div className="flex-none border-b border-line-100 p-3">
			<Select
				options={options}
				value={selected?.id ?? NONE}
				format={format}
				onChange={(id) => {
					const group = groups.find((g) => g.id === id)
					if (group) onSelect(group)
				}}
			/>
		</div>
	)
}
