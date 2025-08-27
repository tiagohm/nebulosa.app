import { Button, Checkbox, Chip, Input, NumberInput, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FocuserMolecule } from '@/molecules/indi/focuser'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Focuser = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connecting } = useSnapshot(focuser.state)
	const { connected, moving, position, canAbort, canSync, canAbsoluteMove, canRelativeMove, canReverse, reversed } = useSnapshot(focuser.state.focuser)
	const { relative, absolute } = useSnapshot(focuser.state.request, { sync: true })

	return (
		<Modal
			header={
				<div className='flex flex-row items-center justify-between'>
					<div className='flex flex-row items-center gap-1'>
						<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={focuser.connect} />
						<IndiPanelControlButton device={focuser.scope.focuser.name} />
					</div>
					<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
						<span className='leading-5'>Focuser</span>
						<span className='text-xs font-normal text-gray-400 max-w-full'>{focuser.scope.focuser.name}</span>
					</div>
				</div>
			}
			maxWidth='260px'
			name={`focuser-${focuser.scope.focuser.name}`}
			onClose={focuser.close}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-3 flex flex-row items-center justify-start'>
					<Chip color='primary' size='sm'>
						{moving ? 'moving' : 'idle'}
					</Chip>
				</div>
				<div className='col-span-9 flex flex-row items-center justify-end gap-2'>
					<Input className='flex-1' isReadOnly label={`Position (max: ${position.max})`} size='sm' value={position.value.toFixed(0)} />
					<Tooltip content='Stop' placement='bottom'>
						<Button color='danger' isDisabled={!canAbort || !moving} isIconOnly onPointerUp={focuser.stop} size='sm' variant='light'>
							<Icons.Stop />
						</Button>
					</Tooltip>
				</div>
				<div className='col-span-full flex flex-row items-center justify-between gap-2'>
					<Tooltip content='Move In' placement='bottom'>
						<Button color='secondary' isDisabled={!canRelativeMove || moving} isIconOnly onPointerUp={focuser.moveIn} size='sm' variant='light'>
							<Icons.ArrowLeft />
						</Button>
					</Tooltip>
					<NumberInput className='flex-1' formatOptions={INTEGER_NUMBER_FORMAT} label='Relative' maxValue={position.max} minValue={1} onValueChange={(value) => focuser.update('relative', value)} size='sm' value={relative} />
					<Tooltip content='Move Out' placement='bottom'>
						<Button color='secondary' isDisabled={!canRelativeMove || moving} isIconOnly onPointerUp={focuser.moveOut} size='sm' variant='light'>
							<Icons.ArrowRight />
						</Button>
					</Tooltip>
				</div>
				<div className='col-span-full flex flex-row items-center justify-between gap-2'>
					<Tooltip content='Sync' placement='bottom'>
						<Button color='primary' isDisabled={!canSync || moving} isIconOnly onPointerUp={focuser.sync} size='sm' variant='light'>
							<Icons.Sync />
						</Button>
					</Tooltip>
					<NumberInput className='flex-1' formatOptions={INTEGER_NUMBER_FORMAT} label='Absolute' maxValue={position.max} minValue={0} onValueChange={(value) => focuser.update('absolute', value)} size='sm' value={absolute} />
					<Tooltip content='Move To' placement='bottom'>
						<Button color='success' isDisabled={!canAbsoluteMove || moving} isIconOnly onPointerUp={focuser.moveTo} size='sm' variant='light'>
							<Icons.Check />
						</Button>
					</Tooltip>
				</div>
				{canReverse && (
					<Checkbox className='col-span-full mt-1' isSelected={reversed} onValueChange={focuser.reverse}>
						Reverse mode
					</Checkbox>
				)}
			</div>
		</Modal>
	)
})
