import { Chip, Popover, PopoverContent, PopoverTrigger, SelectItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { WheelMolecule } from '@/molecules/indi/wheel'
import { DEFAULT_POPOVER_PROPS } from '@/shared/constants'
import { ConnectButton } from './ConnectButton'
import { Button } from './components/Button'
import { TextInput } from './components/TextInput'
import { EnumSelect } from './EnumSelect'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Wheel = memo(() => {
	const wheel = useMolecule(WheelMolecule)

	return (
		<Modal header={<Header />} id={`wheel-${wheel.scope.wheel.name}`} maxWidth='256px' onHide={wheel.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { connecting, connected } = useSnapshot(wheel.state.wheel)

	return (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} loading={connecting} onPointerUp={wheel.connect} />
				<IndiPanelControlButton device={wheel.scope.wheel.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Filter Wheel</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{wheel.scope.wheel.name}</span>
			</div>
		</div>
	)
})

const SlotItem = (slot: string, index: number) => <SelectItem key={index}>{slot}</SelectItem>

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Status />
			<Slot />
		</div>
	)
})

const Status = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { moving, position, names } = useSnapshot(wheel.state.wheel)

	return (
		<div className='col-span-3 flex flex-row items-center gap-2 justify-start'>
			<Chip color='primary'>{moving ? 'moving' : 'idle'}</Chip>
			<Chip color='warning'>POSITION: {position}</Chip>
			<Chip color='success'>FILTER: {names[position]}</Chip>
		</div>
	)
})

const Slot = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { selected } = useSnapshot(wheel.state)
	const { connected, moving, position, names } = useSnapshot(wheel.state.wheel)

	return (
		<div className='col-span-full flex flex-row items-center justify-end gap-2'>
			<EnumSelect className='flex-1' endContent={<SlotPopover />} isDisabled={!connected || moving || names.length === 0} label='Slot' onValueChange={(value) => wheel.update('position', +value)} value={selected.position.toFixed(0)}>
				{names.map(SlotItem)}
			</EnumSelect>
			<Button color='success' disabled={!connected || selected.position === position || names.length === 0} label='Move' loading={moving} onPointerUp={wheel.moveTo} startContent={<Icons.Check />} variant='ghost' />
		</div>
	)
})

const SlotPopover = memo(() => {
	return (
		<Popover className='max-w-80' {...DEFAULT_POPOVER_PROPS}>
			<PopoverTrigger>
				<IconButton icon={Icons.Cog} />
			</PopoverTrigger>
			<PopoverContent>
				<SlotPopoverContent />
			</PopoverContent>
		</Popover>
	)
})

const SlotPopoverContent = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { canSetNames } = useSnapshot(wheel.state.wheel)
	const { name } = useSnapshot(wheel.state.selected, { sync: true })

	return (
		<div className='grid grid-cols-12 gap-2 p-4'>
			<p className='col-span-full font-bold'>SLOT OPTIONS</p>
			<TextInput className='col-span-10' disabled={!canSetNames} label='Name' onValueChange={(value) => value && wheel.update('name', value)} value={name} />
			<div className='col-span-2 flex flex-row justify-center items-center'>
				<IconButton color='success' disabled={!canSetNames || !name.length} icon={Icons.Check} onPointerUp={wheel.apply} tooltipContent='Apply' />
			</div>
		</div>
	)
})
