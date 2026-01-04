import { Checkbox, Chip, NumberInput, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { RotatorMolecule } from '@/molecules/indi/rotator'
import { DECIMAL_NUMBER_FORMAT } from '@/shared/constants'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Rotator = memo(() => {
	const rotator = useMolecule(RotatorMolecule)
	const { connecting, connected, moving, angle, canAbort, canSync, canReverse, reversed } = useSnapshot(rotator.state.rotator)
	const { angle: value } = useSnapshot(rotator.state, { sync: true })

	const Header = (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={rotator.connect} />
				<IndiPanelControlButton device={rotator.scope.rotator.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Rotator</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{rotator.scope.rotator.name}</span>
			</div>
		</div>
	)

	return (
		<Modal header={Header} id={`rotator-${rotator.scope.rotator.name}`} maxWidth='260px' onHide={rotator.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-3 flex flex-row items-center justify-start'>
					<Chip color='primary' size='sm'>
						{moving ? 'moving' : 'idle'}
					</Chip>
				</div>
				<div className='col-span-9 flex flex-row items-center justify-end gap-2'>
					<NumberInput className='flex-1' formatOptions={DECIMAL_NUMBER_FORMAT} hideStepper isReadOnly label='Angle (°)' size='sm' value={angle.value} />
					<Tooltip content='Stop' placement='bottom' showArrow>
						<IconButton color='danger' icon={Icons.Stop} isDisabled={!connected || !canAbort || !moving} onPointerUp={rotator.stop} size='sm' />
					</Tooltip>
				</div>
				<div className='col-span-full flex flex-row items-center justify-between gap-2'>
					<Tooltip content='Sync' placement='bottom' showArrow>
						<IconButton color='primary' icon={Icons.Sync} isDisabled={!connected || !canSync || moving} onPointerUp={rotator.sync} />
					</Tooltip>
					<NumberInput className='flex-1' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!connected} label='Move (°)' maxValue={angle.max} minValue={angle.min} onValueChange={(value) => rotator.update('angle', value)} size='sm' value={value} />
					<Tooltip content='Move' placement='bottom' showArrow>
						<IconButton color='success' icon={Icons.Check} isDisabled={!connected || moving || value === angle.value} onPointerUp={rotator.moveTo} />
					</Tooltip>
				</div>
				<Checkbox className='col-span-full mt-1' isDisabled={!connected || !canReverse} isSelected={reversed} onValueChange={rotator.reverse}>
					Reversed
				</Checkbox>
			</div>
		</Modal>
	)
})
