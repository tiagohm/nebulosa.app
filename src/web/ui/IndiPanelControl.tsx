import { Input, ListboxItem, SelectItem, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import type { DeviceProperty } from 'nebulosa/src/indi.device'
import type { DefElement, DefTextVector, Message, NewVector, SwitchRule } from 'nebulosa/src/indi.types'
import { Activity, memo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { IndiPanelControlMolecule } from '@/molecules/indi/panelcontrol'
import { Button } from './components/Button'
import { NumberInput } from './components/NumberInput'
import { EnumSelect } from './EnumSelect'
import { FilterableListbox } from './FilterableListBox'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'
import { ToggleButton } from './ToggleButton'

const MessageFilter = (item: Message, text: string) => item.message.toLowerCase().includes(text)

export const IndiPanelControl = memo(() => {
	const control = useMolecule(IndiPanelControlMolecule)

	return (
		<Modal header={<Header />} id='indi-panel-control' maxWidth='400px' onHide={control.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const control = useMolecule(IndiPanelControlMolecule)
	const { tab } = useSnapshot(control.state)

	return (
		<div className='flex flex-row justify-start items-center gap-2'>
			<span className='me-3'>INDI Panel Control</span>
			<Tooltip content='Properties' placement='bottom' showArrow>
				<ToggleButton color='secondary' icon={Icons.ViewList} isSelected={tab === 'property'} onPointerUp={() => (control.state.tab = 'property')} />
			</Tooltip>
			<Tooltip content='Messages' placement='bottom' showArrow>
				<ToggleButton color='secondary' icon={Icons.Message} isSelected={tab === 'message'} onPointerUp={() => (control.state.tab = 'message')} />
			</Tooltip>
		</div>
	)
})

const Body = memo(() => {
	const control = useMolecule(IndiPanelControlMolecule)
	const { device, tab } = useSnapshot(control.state)

	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Activity mode={tab === 'property' ? 'visible' : 'hidden'}>
				<DeviceAndGroup />
				<GroupList key={device} />
			</Activity>
			<Messages />
		</div>
	)
})

const DeviceItem = (device: string) => <SelectItem key={device}>{device}</SelectItem>

const GroupItem = (group: string) => <SelectItem key={group}>{group}</SelectItem>

const DeviceAndGroup = memo(() => {
	const control = useMolecule(IndiPanelControlMolecule)
	const { devices, device, groups, group } = useSnapshot(control.state)

	return (
		<>
			<EnumSelect className='col-span-6' label='Device' onValueChange={control.changeDevice} value={device}>
				{devices.map(DeviceItem)}
			</EnumSelect>
			<EnumSelect className='col-span-6' label='Group' onValueChange={control.changeGroup} value={group}>
				{groups.map(GroupItem)}
			</EnumSelect>
		</>
	)
})

const GroupList = memo(() => {
	const control = useMolecule(IndiPanelControlMolecule)
	const { device, group, groups } = useSnapshot(control.state)

	return (
		<div className='col-span-full flex flex-col gap-4 max-h-100 overflow-y-auto p-1'>
			{groups.map((e) => (
				<Activity key={`${device}-${e}`} mode={e === group ? 'visible' : 'hidden'}>
					<PropertyList group={e} />
				</Activity>
			))}
		</div>
	)
})

const DevicePropertyComparator = (a: DeviceProperty, b: DeviceProperty) => a.label!.localeCompare(b.label!)

const PropertyList = memo(({ group }: Readonly<{ group: string }>) => {
	const control = useMolecule(IndiPanelControlMolecule)
	const properties = useSnapshot(control.state.properties[group])
	const entries = Object.values(properties ?? {}).sort(DevicePropertyComparator)

	return (
		<>
			{entries.map((e) => (
				<Property key={e.name} onSend={control.send} property={e} />
			))}
		</>
	)
})

const MessageItem = (item: Message) => (
	<ListboxItem description={item.timestamp} key={item.id}>
		{item.message}
	</ListboxItem>
)

const Messages = memo(() => {
	const control = useMolecule(IndiPanelControlMolecule)
	const { tab, messages } = useSnapshot(control.state)

	return (
		<Activity mode={tab === 'message' ? 'visible' : 'hidden'}>
			<FilterableListbox
				className='col-span-full'
				classNames={{ list: 'max-h-[200px] overflow-scroll', base: 'min-w-80' }}
				filter={MessageFilter}
				isVirtualized
				items={messages}
				minLengthToSearch={1}
				selectionMode='none'
				variant='flat'
				virtualization={{
					maxListboxHeight: 200,
					itemHeight: 36,
				}}>
				{MessageItem}
			</FilterableListbox>
			<div className='col-span-full flex flex-row justify-center items-center gap-2'>
				<Button color='danger' disabled={messages.length === 0} label='Clear' onPointerUp={control.clearMessages} startContent={<Icons.Broom />} />
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
	const isReadonly = (property as DefTextVector).permission === 'ro'

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
		<div className='flex flex-col gap-2 content'>
			<div className='flex items-center justify-between gap-1'>
				<div className='flex items-center justify-start gap-1'>
					<Icons.Circle color={property.state === 'Idle' ? '#FAFAFA' : property.state === 'Busy' ? '#FFC107' : property.state === 'Ok' ? '#4CAF50' : '#F44336'} />
					<div className='flex flex-col'>
						<span>{property.label}</span>
						<span className='text-[0.6rem] mt-[-4px] text-neutral-400'>{property.name}</span>
					</div>
				</div>
				{!isReadonly && property.type !== 'SWITCH' && <IconButton color='primary' icon={Icons.Send} onPointerUp={handlePointerUp} tooltipContent='Send' tooltipPlacement='start' />}
			</div>
			<div className='flex flex-col gap-1'>
				{property.type === 'TEXT' && Object.entries(property.elements).map(([key, element]) => <TextElement isReadonly={isReadonly} key={key} label={element.label} onValueChange={(value) => handleValueChange(element, value)} value={element.value} />)}
				{property.type === 'NUMBER' && Object.entries(property.elements).map(([key, element]) => <NumberElement isReadonly={isReadonly} key={key} label={element.label} max={element.max} min={element.min} onValueChange={(value) => handleValueChange(element, value)} value={element.value} />)}
				{property.type === 'SWITCH' && (
					<div className='flex flex-row flex-wrap gap-1 items-center'>
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

	function handleValueChange(value: string) {
		setText(value)
		onValueChange(value)
	}

	return (
		<div className='grid grid-cols-12 gap-1'>
			<Input className={isReadonly ? 'col-span-full' : 'col-span-6'} isDisabled label={label} size='sm' value={value} />
			{!isReadonly && <Input className='col-span-6' label={label} onValueChange={handleValueChange} size='sm' value={text} />}
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

	function handleValueChange(value: number) {
		setNumber(value)
		onValueChange(value)
	}

	return (
		<div className='grid grid-cols-12 gap-1'>
			<Input className={isReadonly ? 'col-span-full' : 'col-span-6'} isDisabled label={label} size='sm' value={value.toString()} />
			{!isReadonly && <NumberInput className='col-span-6' fractionDigits={8} label={label} maxValue={max} minValue={min} onValueChange={handleValueChange} value={number} />}
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

	return <Button color={rule === 'AtMostOne' ? 'secondary' : value ? 'success' : 'danger'} disabled={isReadonly} label={label!} onPointerUp={handleValueChange} />
}
