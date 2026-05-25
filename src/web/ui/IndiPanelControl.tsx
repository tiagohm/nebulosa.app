import type { Device, DeviceProperty } from 'nebulosa/src/indi.device'
import type { DefElement, Message, NewVector, SwitchRule } from 'nebulosa/src/indi.types'
import { Activity, memo, useContext, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { IndiPanelControlStoreContext } from '../shared/context'
import { activityMode } from '../shared/util'
import { Button } from './components/Button'
import { FilterableList } from './components/FilterableList'
import { IconButton } from './components/IconButton'
import { ListItem } from './components/List'
import { NumberInput } from './components/NumberInput'
import { Select } from './components/Select'
import { TextInput } from './components/TextInput'
import { ToggleButton } from './components/ToggleButton'
import { Icons } from './Icon'
import { Modal } from './Modal'

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

export const IndiPanelControl = memo(() => {
	const panel = useContext(IndiPanelControlStoreContext)

	return (
		<Modal header={<Header />} id="indi-panel-control" maxWidth="400px" onHide={panel.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const panel = useContext(IndiPanelControlStoreContext)
	const { tab } = useSnapshot(panel.state)

	return (
		<div className="flex min-w-0 flex-row items-center justify-start gap-2">
			<span className="me-3 min-w-0 truncate">INDI Panel Control</span>
			<ToggleButton color="secondary" icon={Icons.ViewList} onClick={() => (panel.state.tab = 'property')} tooltipContent="Properties" value={tab === 'property'} />
			<ToggleButton color="secondary" icon={Icons.Message} onClick={() => (panel.state.tab = 'message')} tooltipContent="Messages" value={tab === 'message'} />
		</div>
	)
})

const Body = memo(() => {
	const panel = useContext(IndiPanelControlStoreContext)
	const { device, tab } = useSnapshot(panel.state)

	return (
		device && (
			<div className="mt-0 grid grid-cols-12 gap-2">
				<Activity mode={activityMode(tab === 'property')}>
					<DeviceAndGroup />
					<GroupList key={device.id} />
				</Activity>
				<Messages />
			</div>
		)
	)
})

function DeviceItem(device: Device) {
	return <span>{device.name}</span>
}

function GroupItem(group: string) {
	return <span>{group}</span>
}

const DeviceAndGroup = memo(() => {
	const panel = useContext(IndiPanelControlStoreContext)
	const { devices, device, groups, group } = useSnapshot(panel.state)

	return (
		<>
			<Select className="col-span-6 min-w-0" disabled={devices.length === 0} fullWidth items={devices} label="Device" onValueChange={panel.selectDevice} value={device}>
				{DeviceItem}
			</Select>
			<Select className="col-span-6 min-w-0" disabled={groups.length === 0} fullWidth items={groups} label="Group" onValueChange={panel.selectGroup} value={group}>
				{GroupItem}
			</Select>
		</>
	)
})

const GroupList = memo(() => {
	const panel = useContext(IndiPanelControlStoreContext)
	const { device, group, groups } = useSnapshot(panel.state)
	const selectedGroup = groups.includes(group) ? group : undefined

	return <div className="col-span-full flex max-h-100 min-w-0 flex-col gap-4 overflow-y-auto p-1">{device === undefined || selectedGroup === undefined ? <div className="px-2 py-3 text-sm text-neutral-500">No properties</div> : <PropertyList key={`${device.id}-${selectedGroup}`} group={selectedGroup} />}</div>
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
			<FilterableList className="col-span-full min-w-0" emptyContent="No messages" filter={FilterMessage} itemHeight={36} items={messages} minLengthToSearch={1}>
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
	const elements = useRef<NewVector['elements']>({})
	const isReadonly = 'permission' in property && property.permission === 'ro'
	const label = propertyLabel(property)

	function handleValueChange(element: DefElement, value: unknown) {
		if (property.type === 'SWITCH') {
			onSend(property, { device: property.device, name: property.name, elements: { [element.name]: value as boolean } })
		} else {
			elements.current[element.name] = value as never
		}
	}

	function handlePointerUp() {
		onSend(property, { device: property.device, name: property.name, elements: elements.current as never })
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
				{!isReadonly && property.type !== 'SWITCH' && <IconButton color="primary" icon={Icons.Send} onClick={handlePointerUp} tooltipContent="Send" tooltipPlacement="start" />}
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
	const [text, setText] = useState(value)

	useEffect(() => {
		setText(value)
	}, [value])

	function handleValueChange(value: string) {
		setText(value)
		onValueChange(value)
	}

	return (
		<div className="grid grid-cols-12 gap-1">
			<TextInput className={isReadonly ? 'col-span-full min-w-0' : 'col-span-6 min-w-0'} label={label} readOnly value={value} />
			{!isReadonly && <TextInput className="col-span-6 min-w-0" label={label} onValueChange={handleValueChange} value={text} />}
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
	const [number, setNumber] = useState(value)

	useEffect(() => {
		setNumber(value)
	}, [value])

	function handleValueChange(value: number) {
		setNumber(value)
		onValueChange(value)
	}

	return (
		<div className="grid grid-cols-12 gap-1">
			<TextInput className={isReadonly ? 'col-span-full min-w-0' : 'col-span-6 min-w-0'} label={label} readOnly value={value.toString()} />
			{!isReadonly && <NumberInput className="col-span-6 min-w-0" fractionDigits={8} label={label} maxValue={max} minValue={min} onValueChange={handleValueChange} value={number} />}
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
