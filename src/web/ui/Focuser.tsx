import { Checkbox, Chip, NumberInput, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FocuserMolecule } from '@/molecules/indi/focuser'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Focuser = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connecting, connected, moving, position, canAbort, canSync, canAbsoluteMove, canRelativeMove, canReverse, reversed } = useSnapshot(focuser.state.focuser)
	const { relative, absolute } = useSnapshot(focuser.state.request)

	const Header = (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={focuser.connect} />
				<IndiPanelControlButton device={focuser.scope.focuser.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Focuser</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{focuser.scope.focuser.name}</span>
			</div>
		</div>
	)

	return (
		<Modal header={Header} id={`focuser-${focuser.scope.focuser.name}`} maxWidth='256px' onHide={focuser.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-3 flex flex-row items-center justify-start'>
					<Chip color='primary' size='sm'>
						{moving ? 'moving' : 'idle'}
					</Chip>
				</div>
				<div className='col-span-9 flex flex-row items-center justify-end gap-2'>
					<NumberInput className='flex-1' formatOptions={INTEGER_NUMBER_FORMAT} hideStepper isReadOnly label='Position' size='sm' value={position.value} />
					<Tooltip content='Stop' placement='bottom' showArrow>
						<IconButton color='danger' icon={Icons.Stop} isDisabled={!connected || !canAbort || !moving} onPointerUp={focuser.stop} />
					</Tooltip>
				</div>
				<div className='col-span-full flex flex-row items-center justify-between gap-2'>
					<Tooltip content='Move In' placement='bottom' showArrow>
						<IconButton color='secondary' icon={Icons.ArrowLeft} isDisabled={!connected || !canRelativeMove || moving || relative === 0} onPointerUp={focuser.moveIn} />
					</Tooltip>
					<NumberInput className='flex-1' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || !canRelativeMove || moving} label='Relative' maxValue={position.max} minValue={1} onValueChange={(value) => focuser.update('relative', value)} size='sm' value={relative} />
					<Tooltip content='Move Out' placement='bottom' showArrow>
						<IconButton color='secondary' icon={Icons.ArrowRight} isDisabled={!connected || !canRelativeMove || moving || relative === 0} onPointerUp={focuser.moveOut} />
					</Tooltip>
				</div>
				<div className='col-span-full flex flex-row items-center justify-between gap-2'>
					<Tooltip content='Sync' placement='bottom' showArrow>
						<IconButton color='primary' icon={Icons.Sync} isDisabled={!connected || !canSync || moving} onPointerUp={focuser.sync} />
					</Tooltip>
					<NumberInput className='flex-1' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!connected || !canAbsoluteMove || moving} label='Absolute' maxValue={position.max} minValue={0} onValueChange={(value) => focuser.update('absolute', value)} size='sm' value={absolute} />
					<Tooltip content='Move' placement='bottom' showArrow>
						<IconButton color='success' icon={Icons.Check} isDisabled={!connected || !canAbsoluteMove || moving || absolute === position.value} onPointerUp={focuser.moveTo} />
					</Tooltip>
				</div>
				<Checkbox className='col-span-full mt-1' isDisabled={!connected || !canReverse} isSelected={reversed} onValueChange={focuser.reverse}>
					Reversed
				</Checkbox>
			</div>
		</Modal>
	)
})
