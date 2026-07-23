import { IndiPanelControlStoreContext } from '@shared/context'
import { activityMode } from '@ui/../shared/util'
import { Button } from '@ui/components/Button'
import { FilterableList } from '@ui/components/FilterableList'
import { IconButton } from '@ui/components/IconButton'
import { ListItem } from '@ui/components/List'
import { NumberInput } from '@ui/components/NumberInput'
import { Select } from '@ui/components/Select'
import { Tab, TabPanel, Tabs } from '@ui/components/Tabs'
import { TextInput } from '@ui/components/TextInput'
import { Icons } from '@ui/Icon'
import type { Device, DeviceProperty } from 'nebulosa/src/devices/indi/device'
import type { DefElement, Message, NewVector, SwitchRule } from 'nebulosa/src/devices/indi/types'
import { Activity, memo, useContext, useRef, useState } from 'react'
import { useStore } from 'src/web/hooks/store.hook'
import { indiPanelControlStore } from 'src/web/stores/indi.panelcontrol.store'
import { useSnapshot } from 'valtio'

function FilterMessage(item: Message, text: string) {
	return item.message.toLowerCase().includes(text)
}

function propertyLabel(property: DeviceProperty) {
	return property.label || property.name
}

function propertyStateColor(state: DeviceProperty['state']) {
	if (state === 'Idle') return 'var(--color-neutral-500)'
	if (state === 'Busy') return 'var(--warning)'
	if (state === 'Ok') return 'var(--success)'
	return 'var(--danger)'
}

export interface IndiPanelControlProps {
	readonly device: Device
}

export const IndiPanelControl = memo(({ device }: IndiPanelControlProps) => {
	const panel = useStore(() => indiPanelControlStore(device), [device])

	return (
		<IndiPanelControlStoreContext value={panel}>
			<Body />
		</IndiPanelControlStoreContext>
	)
})

const Body = memo(() => {
	const panel = useContext(IndiPanelControlStoreContext)
	const { tab } = useSnapshot(panel.state)

	return (
		<Tabs className="w-full" value={tab} onValueChange={(value) => (panel.state.tab = value)}>
			<Tab id="property">Properties</Tab>
			<Tab id="message">Messages</Tab>
			<TabPanel id="property">
				<DeviceAndGroup />
				<GroupList />
			</TabPanel>
			<TabPanel id="message">
				<Messages />
			</TabPanel>
		</Tabs>
	)
})

function GroupItem(group: string) {
	return <span>{group}</span>
}

const DeviceAndGroup = memo(() => {
	const panel = useContext(IndiPanelControlStoreContext)
	const { groups, group } = useSnapshot(panel.state)

	return (
		<>
			<Select className="col-span-full min-w-0" disabled={groups.length === 0} fullWidth items={groups} label="Group" onValueChange={panel.selectGroup} value={group}>
				{GroupItem}
			</Select>
		</>
	)
})

const GroupList = memo(() => {
	const panel = useContext(IndiPanelControlStoreContext)
	const { group, groups } = useSnapshot(panel.state)
	const selectedGroup = groups.includes(group) ? group : undefined

	return <div className="col-span-full flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-1">{selectedGroup === undefined ? <div className="px-2 py-3 text-sm text-neutral-500">No properties</div> : <PropertyList group={selectedGroup} />}</div>
})

function DevicePropertyComparator(a: DeviceProperty, b: DeviceProperty) {
	return propertyLabel(a).localeCompare(propertyLabel(b))
}

const PropertyList = memo(({ group }: Readonly<{ group: string }>) => {
	const panel = useContext(IndiPanelControlStoreContext)
	const properties = useSnapshot(panel.state.properties[group])
	const entries = Object.values(properties ?? {}).sort(DevicePropertyComparator)

	return (
		<>
			{entries.map((e) => (
				<Property key={e.name} onSend={panel.send} property={e} />
			))}
		</>
	)
})

function MessageItem(item: Message) {
	return <ListItem description={item.timestamp} label={item.message} />
}

const Messages = memo(() => {
	const panel = useContext(IndiPanelControlStoreContext)
	const { tab, messages } = useSnapshot(panel.state)

	return (
		<Activity mode={activityMode(tab === 'message')}>
			<FilterableList className="col-span-full min-w-0" emptyContent="No messages" filter={FilterMessage} itemHeight={36} items={messages}>
				{MessageItem}
			</FilterableList>
			<div className="col-span-full flex flex-row items-center justify-center gap-2">
				<Button color="danger" disabled={messages.length === 0} label="Clear" onClick={panel.clear} startContent={<Icons.Broom />} />
			</div>
		</Activity>
	)
})

interface PropertyProps {
	readonly property: DeviceProperty
	readonly onSend: (property: DeviceProperty, message: NewVector) => void
}

const Property = memo(({ property, onSend }: PropertyProps) => {
	const edited = useRef<Record<string, unknown>>(Object.create(null))
	const isReadonly = 'permission' in property && property.permission === 'ro'
	const label = propertyLabel(property)

	function handleValueChange(element: DefElement, value: unknown) {
		if (property.type === 'SWITCH') {
			onSend(property, { device: property.device, name: property.name, elements: { [element.name]: value as boolean } })
		} else {
			edited.current[element.name] = value
		}
	}

	function handleClick() {
		if (property.type === 'SWITCH') return

		const elements = Object.create(null)

		for (const element of Object.values(property.elements) as DefElement[]) {
			console.info(element)
			if (element.value !== undefined) elements[element.name] = element.value
		}

		for (const [name, value] of Object.entries(edited.current)) {
			if (value !== undefined) elements[name] = value
		}

		onSend(property, { device: property.device, name: property.name, elements })
	}

	return (
		<div className="content flex min-w-0 flex-col gap-2">
			<div className="flex items-center justify-between gap-1">
				<div className="flex min-w-0 items-center justify-start gap-1">
					<Icons.Circle color={propertyStateColor(property.state)} />
					<div className="flex min-w-0 flex-col">
						<span className="min-w-0 truncate">{label}</span>
						<span className="mt-[-4px] text-[0.6rem] text-neutral-400">{property.name}</span>
					</div>
				</div>
				{!isReadonly && property.type !== 'SWITCH' && <IconButton color="primary" icon={Icons.Send} onClick={handleClick} tooltipContent="Send" tooltipPlacement="start" />}
			</div>
			<div className="flex flex-col gap-1">
				{property.type === 'TEXT' && Object.entries(property.elements).map(([key, element]) => <TextElement isReadonly={isReadonly} key={key} label={element.label} onValueChange={(value) => handleValueChange(element, value)} value={element.value} />)}
				{property.type === 'NUMBER' && Object.entries(property.elements).map(([key, element]) => <NumberElement isReadonly={isReadonly} key={key} label={element.label} max={element.max} min={element.min} onValueChange={(value) => handleValueChange(element, value)} value={element.value} />)}
				{property.type === 'SWITCH' && (
					<div className="flex flex-row flex-wrap items-center gap-1">
						{Object.entries(property.elements).map(([key, element]) => (
							<SwitchElement isReadonly={isReadonly} key={key} label={element.label} onValueChange={(value) => handleValueChange(element, value)} rule={property.rule} value={element.value} />
						))}
					</div>
				)}
			</div>
		</div>
	)
})

interface TextElementProps {
	readonly label?: string
	readonly value: string
	readonly isReadonly: boolean
	readonly onValueChange: (value: string) => void
}

function TextElement({ label, value, isReadonly, onValueChange }: TextElementProps) {
	const [editValue, setEditValue] = useState(value)

	function handleValueChange(value: string) {
		setEditValue(value)
		onValueChange(value)
	}

	return (
		<div className="grid grid-cols-12 gap-1">
			<TextInput className={isReadonly ? 'col-span-full min-w-0' : 'col-span-6 min-w-0'} label={label} readOnly value={value} />
			{!isReadonly && <TextInput className="col-span-6 min-w-0" label={label} onValueChange={handleValueChange} value={editValue} />}
		</div>
	)
}

interface NumberElementProps {
	readonly label?: string
	readonly min: number
	readonly max: number
	readonly value: number
	readonly isReadonly: boolean
	readonly onValueChange: (value: number) => void
}

function NumberElement({ label, value, isReadonly, min, max, onValueChange }: NumberElementProps) {
	const [editValue, setEditValue] = useState(value)

	function handleValueChange(value: number) {
		setEditValue(value)
		onValueChange(value)
	}

	return (
		<div className="grid grid-cols-12 gap-1">
			<TextInput className={isReadonly ? 'col-span-full min-w-0' : 'col-span-6 min-w-0'} label={label} readOnly value={value.toString()} />
			{!isReadonly && <NumberInput className="col-span-6 min-w-0" fractionDigits={8} label={label} maxValue={max} minValue={min} onValueChange={handleValueChange} value={editValue} />}
		</div>
	)
}

interface SwitchElementProps {
	readonly label?: string
	readonly value: boolean
	readonly isReadonly: boolean
	readonly rule: SwitchRule
	readonly onValueChange: (value: boolean) => void
}

function SwitchElement({ label, value, rule, isReadonly, onValueChange }: SwitchElementProps) {
	function handleValueChange() {
		if (rule === 'AnyOfMany') {
			onValueChange(!value)
		} else {
			onValueChange(true)
		}
	}

	return <Button color={value ? 'success' : rule === 'AnyOfMany' ? 'danger' : 'secondary'} disabled={isReadonly} label={label} onClick={handleValueChange} />
}
