import { Chip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { RotatorMolecule } from '@/molecules/indi/rotator'
import { ConnectButton } from './ConnectButton'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Rotator = memo(() => {
	const rotator = useMolecule(RotatorMolecule)

	return (
		<Modal header={<Header />} id={`rotator-${rotator.scope.rotator.name}`} maxWidth='256px' onHide={rotator.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const rotator = useMolecule(RotatorMolecule)
	const { connecting, connected } = useSnapshot(rotator.state.rotator)

	return (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} loading={connecting} onPointerUp={rotator.connect} />
				<IndiPanelControlButton device={rotator.scope.rotator.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Rotator</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{rotator.scope.rotator.name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Status />
			<CurrentAngle />
			<TargetAngle />
			<Options />
		</div>
	)
})

const Status = memo(() => {
	const rotator = useMolecule(RotatorMolecule)
	const { moving } = useSnapshot(rotator.state.rotator)

	return (
		<div className='col-span-3 flex flex-row items-center justify-start'>
			<Chip color='primary'>{moving ? 'moving' : 'idle'}</Chip>
		</div>
	)
})

const CurrentAngle = memo(() => {
	const rotator = useMolecule(RotatorMolecule)
	const { connected, moving, angle, canAbort } = useSnapshot(rotator.state.rotator)

	return (
		<div className='col-span-9 flex flex-row items-center justify-end gap-2'>
			<NumberInput className='flex-1' label='Angle (°)' readOnly value={angle.value} />
			<IconButton color='danger' disabled={!connected || !canAbort || !moving} icon={Icons.Stop} onPointerUp={rotator.stop} tooltipContent='Stop' />
		</div>
	)
})

const TargetAngle = memo(() => {
	const rotator = useMolecule(RotatorMolecule)
	const { connected, moving, angle, canSync } = useSnapshot(rotator.state.rotator)
	const { angle: targetAngle } = useSnapshot(rotator.state)

	return (
		<div className='col-span-full flex flex-row items-center justify-between gap-2'>
			<IconButton color='primary' disabled={!connected || !canSync || moving} icon={Icons.Sync} onPointerUp={rotator.sync} tooltipContent='Sync' />
			<NumberInput className='flex-1' disabled={!connected} label='Move (°)' maxValue={angle.max} minValue={angle.min} onValueChange={(value) => rotator.update('angle', value)} value={targetAngle} />
			<IconButton color='success' disabled={!connected || moving || targetAngle === angle.value} icon={Icons.Check} onPointerUp={rotator.moveTo} tooltipContent='Move' />
		</div>
	)
})

const Options = memo(() => {
	const rotator = useMolecule(RotatorMolecule)
	const { connected, canReverse, reversed } = useSnapshot(rotator.state.rotator)

	return <Checkbox className='col-span-full mt-1' disabled={!connected || !canReverse} label='Reversed' onValueChange={rotator.reverse} value={reversed} />
})
