import { Chip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FocuserMolecule } from '@/molecules/indi/focuser'
import { ConnectButton } from './ConnectButton'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Focuser = memo(() => {
	const focuser = useMolecule(FocuserMolecule)

	return (
		<Modal header={<Header />} id={`focuser-${focuser.scope.focuser.name}`} maxWidth='256px' onHide={focuser.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connecting, connected } = useSnapshot(focuser.state.focuser)

	return (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} loading={connecting} onPointerUp={focuser.connect} />
				<IndiPanelControlButton device={focuser.scope.focuser.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Focuser</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{focuser.scope.focuser.name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Status />
			<Position />
			<RelativePosition />
			<AbsolutePosition />
			<Options />
		</div>
	)
})

const Status = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { moving } = useSnapshot(focuser.state.focuser)

	return (
		<div className='col-span-3 flex flex-row items-center justify-start'>
			<Chip color='primary' size='sm'>
				{moving ? 'moving' : 'idle'}
			</Chip>
		</div>
	)
})

const Position = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connected, moving, position, canAbort } = useSnapshot(focuser.state.focuser)

	return (
		<div className='col-span-9 flex flex-row items-center justify-end gap-2'>
			<NumberInput className='flex-1' label='Position' readOnly value={position.value} />
			<IconButton color='danger' disabled={!connected || !canAbort || !moving} icon={Icons.Stop} onPointerUp={focuser.stop} tooltipContent='Stop' />
		</div>
	)
})

const RelativePosition = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connected, moving, position, canRelativeMove } = useSnapshot(focuser.state.focuser)
	const { relative } = useSnapshot(focuser.state.request)

	if (!canRelativeMove) return null

	return (
		<div className='col-span-full flex flex-row items-center justify-between gap-2'>
			<IconButton color='secondary' disabled={!connected || moving || relative === 0} icon={Icons.ArrowLeft} onPointerUp={focuser.moveIn} tooltipContent='Move In' />
			<NumberInput className='flex-1' disabled={!connected || moving} label='Relative' maxValue={position.max} minValue={1} onValueChange={(value) => focuser.update('relative', value)} value={relative} />
			<IconButton color='secondary' disabled={!connected || moving || relative === 0} icon={Icons.ArrowRight} onPointerUp={focuser.moveOut} tooltipContent='Move Out' />
		</div>
	)
})

const AbsolutePosition = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connected, moving, position, canSync, canAbsoluteMove } = useSnapshot(focuser.state.focuser)
	const { absolute } = useSnapshot(focuser.state.request)

	if (!canAbsoluteMove) return null

	return (
		<div className='col-span-full flex flex-row items-center justify-between gap-2'>
			<IconButton color='primary' disabled={!connected || !canSync || moving} icon={Icons.Sync} onPointerUp={focuser.sync} tooltipContent='Sync' />
			<NumberInput className='flex-1' disabled={!connected || moving} label='Absolute' maxValue={position.max} minValue={0} onValueChange={(value) => focuser.update('absolute', value)} value={absolute} />
			<IconButton color='success' disabled={!connected || moving || absolute === position.value} icon={Icons.Check} onPointerUp={focuser.moveTo} tooltipContent='Move' />
		</div>
	)
})

const Options = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connected, canReverse, reversed } = useSnapshot(focuser.state.focuser)

	return (
		<div className='col-span-full flex flex-row items-center justify-between gap-2'>
			<Checkbox className='col-span-full mt-1' disabled={!connected || !canReverse} label='Reversed' onValueChange={focuser.reverse} value={reversed} />
		</div>
	)
})
