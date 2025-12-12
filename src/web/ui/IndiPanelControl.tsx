import { Button, Input, NumberInput, SelectItem, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import type { DefElement, DefTextVector, NewVector, SwitchRule } from 'nebulosa/src/indi'
import type { DeviceProperty } from 'nebulosa/src/indi.device'
import { memo, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { IndiPanelControlMolecule } from '@/molecules/indi/panelcontrol'
import { DECIMAL_NUMBER_FORMAT } from '@/shared/constants'
import { EnumSelect } from './EnumSelect'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const IndiPanelControl = memo(() => {
	const control = useMolecule(IndiPanelControlMolecule)
	const { devices, device, groups, group, properties } = useSnapshot(control.state)

	useEffect(() => {
		control.retrieveProperties(device)
	}, [device])

	return (
		<Modal header='INDI Panel Control' id='indi-panel-control' maxWidth='400px' onHide={control.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<EnumSelect className='col-span-6' label='Device' onValueChange={(value) => (control.state.device = value)} value={device}>
					{devices.map((e) => (
						<SelectItem key={e}>{e}</SelectItem>
					))}
				</EnumSelect>
				<EnumSelect className='col-span-6' label='Group' onValueChange={(value) => (control.state.group = value)} value={group}>
					{groups.map((e) => (
						<SelectItem key={e}>{e}</SelectItem>
					))}
				</EnumSelect>
				<div className='col-span-full flex flex-col gap-4 max-h-[300px] overflow-y-auto p-1'>
					{Object.entries(properties[group] ?? {})
						.sort((a, b) => a[1].label!.localeCompare(b[1].label!))
						.map(([name, p]) => (
							<Property key={name} onSend={control.send} property={p} />
						))}
				</div>
			</div>
		</Modal>
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
		<div className='flex flex-col gap-2'>
			<div className='flex items-center justify-between gap-1'>
				<div className='flex items-center justify-start gap-1'>
					<Icons.Circle color={property.state === 'Idle' ? '#FAFAFA' : property.state === 'Busy' ? '#FFC107' : property.state === 'Ok' ? '#4CAF50' : '#F44336'} />
					<div className='flex flex-col'>
						<span>{property.label}</span>
						<span className='text-[0.6rem] mt-[-4px] text-neutral-400'>{property.name}</span>
					</div>
				</div>
				{!isReadonly && property.type !== 'SWITCH' && (
					<Tooltip content='Send' placement='left' showArrow>
						<Button color='primary' isIconOnly onPointerUp={handlePointerUp} variant='light'>
							<Icons.Send />
						</Button>
					</Tooltip>
				)}
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
			{!isReadonly && <NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} label={label} maxValue={max} minValue={min} onValueChange={handleValueChange} size='sm' value={number} />}
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

	return <TextButton color={rule === 'AtMostOne' ? 'default' : value ? 'success' : 'danger'} isDisabled={isReadonly} label={label!} onPointerUp={handleValueChange} />
}
