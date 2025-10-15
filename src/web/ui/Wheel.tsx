import { Chip, Input, Popover, PopoverContent, PopoverTrigger, SelectItem, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { WheelMolecule } from '@/molecules/indi/wheel'
import { ConnectButton } from './ConnectButton'
import { EnumSelect } from './EnumSelect'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const Wheel = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { connecting, connected, moving, position, slots } = useSnapshot(wheel.state.wheel)
	const selected = useSnapshot(wheel.state.selected, { sync: true })

	const Header = (
		<div className='flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={wheel.connect} />
				<IndiPanelControlButton device={wheel.scope.wheel.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='leading-5'>Filter Wheel</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{wheel.scope.wheel.name}</span>
			</div>
		</div>
	)

	return (
		<Modal header={Header} id={`wheel-${wheel.scope.wheel.name}`} maxWidth='260px' onHide={wheel.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-3 flex flex-row items-center gap-2 justify-start'>
					<Chip color='primary' size='sm'>
						{moving ? 'moving' : 'idle'}
					</Chip>
					<Chip color='warning' size='sm'>
						POSITION: {position}
					</Chip>
					<Chip color='success' size='sm'>
						FILTER: {slots[position] ?? 'None'}
					</Chip>
				</div>
				<div className='col-span-full flex flex-row items-center justify-end gap-2'>
					<EnumSelect
						className='flex-1'
						endContent={<SlotPopover key={slots[selected.slot] ?? 'none'} name={slots[selected.slot]} onNameChange={(name) => wheel.update('name', name)} />}
						isDisabled={moving || slots.length === 0}
						label='Slot'
						onValueChange={(value) => wheel.update('slot', +value)}
						value={selected.slot.toFixed(0)}>
						{slots.map((slot, index) => (
							<SelectItem key={index}>{slot}</SelectItem>
						))}
					</EnumSelect>
					<TextButton color='success' isDisabled={selected.slot === position} isLoading={moving} label='Move' onPointerUp={wheel.moveTo} startContent={<Icons.Check />} variant='light' />
				</div>
			</div>
		</Modal>
	)
})

export interface SlotPopoverProps extends Omit<IconButtonProps, 'icon'> {
	readonly name: string
	readonly onNameChange: (name: string) => void
}

export function SlotPopover({ name, onNameChange, ...props }: SlotPopoverProps) {
	const [editName, setEditName] = useState(name ?? '')

	return (
		<Popover className='max-w-80' placement='bottom' showArrow>
			<PopoverTrigger>
				<IconButton {...props} icon={Icons.Cog} />
			</PopoverTrigger>
			<PopoverContent>
				<div className='grid grid-cols-12 gap-2 p-4'>
					<p className='col-span-full font-bold'>SLOT OPTIONS: {name}</p>
					<Input className='col-span-10' label='Name' onValueChange={setEditName} size='sm' value={editName} />
					<div className='col-span-2 flex flex-row justify-center items-center'>
						<Tooltip content='Apply' placement='bottom' showArrow>
							<IconButton color='success' icon={Icons.Check} isDisabled={!editName?.length} onPointerUp={() => onNameChange(editName)} />
						</Tooltip>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
