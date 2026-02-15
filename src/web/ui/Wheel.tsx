import { Chip, Input, Popover, PopoverContent, PopoverTrigger, SelectItem, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { WheelMolecule } from '@/molecules/indi/wheel'
import { ConnectButton } from './ConnectButton'
import { EnumSelect } from './EnumSelect'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const Wheel = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { selected } = useSnapshot(wheel.state)
	const { connecting, connected, moving, position, names } = useSnapshot(wheel.state.wheel)

	const Header = (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={wheel.connect} />
				<IndiPanelControlButton device={wheel.scope.wheel.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Filter Wheel</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{wheel.scope.wheel.name}</span>
			</div>
		</div>
	)

	return (
		<Modal header={Header} id={`wheel-${wheel.scope.wheel.name}`} maxWidth='256px' onHide={wheel.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-3 flex flex-row items-center gap-2 justify-start'>
					<Chip color='primary' size='sm'>
						{moving ? 'moving' : 'idle'}
					</Chip>
					<Chip color='warning' size='sm'>
						POSITION: {position}
					</Chip>
					<Chip color='success' size='sm'>
						FILTER: {names[position]}
					</Chip>
				</div>
				<div className='col-span-full flex flex-row items-center justify-end gap-2'>
					<EnumSelect className='flex-1' endContent={<SlotPopover />} isDisabled={!connected || moving || names.length === 0} label='Slot' onValueChange={(value) => wheel.update('position', +value)} value={selected.position.toFixed(0)}>
						{names.map((slot, index) => (
							<SelectItem key={index}>{slot}</SelectItem>
						))}
					</EnumSelect>
					<TextButton color='success' isDisabled={!connected || selected.position === position || names.length === 0} isLoading={moving} label='Move' onPointerUp={wheel.moveTo} startContent={<Icons.Check />} variant='light' />
				</div>
			</div>
		</Modal>
	)
})

const SlotPopover = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { canSetNames } = useSnapshot(wheel.state.wheel)
	const { name } = useSnapshot(wheel.state.selected, { sync: true })

	return (
		<Popover className='max-w-80' placement='bottom' shouldCloseOnBlur={false} showArrow>
			<PopoverTrigger>
				<IconButton icon={Icons.Cog} />
			</PopoverTrigger>
			<PopoverContent>
				<div className='grid grid-cols-12 gap-2 p-4'>
					<p className='col-span-full font-bold'>SLOT OPTIONS</p>
					<Input className='col-span-10' isDisabled={!canSetNames} label='Name' onValueChange={(value) => value && wheel.update('name', value)} size='sm' value={name} />
					<div className='col-span-2 flex flex-row justify-center items-center'>
						<Tooltip content='Apply' placement='bottom' showArrow>
							<IconButton color='success' icon={Icons.Check} isDisabled={!canSetNames || !name.length} onPointerUp={wheel.apply} />
						</Tooltip>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
})
