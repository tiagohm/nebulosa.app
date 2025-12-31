import { Chip, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { CoverMolecule } from '@/molecules/indi/cover'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Cover = memo(() => {
	const cover = useMolecule(CoverMolecule)
	const { connecting, connected, parking, parked, canPark } = useSnapshot(cover.state.cover)

	const Header = (
		<div className='flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={cover.connect} />
				<IndiPanelControlButton device={cover.scope.cover.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='leading-5'>Cover</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{cover.scope.cover.name}</span>
			</div>
		</div>
	)

	return (
		<Modal header={Header} id={`cover-${cover.scope.cover.name}`} maxWidth='260px' onHide={cover.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-full flex flex-row items-center justify-between'>
					<Chip color='primary' size='sm'>
						{!connected ? 'idle' : parking ? 'moving' : parked ? 'closed' : 'open'}
					</Chip>
				</div>
				<div className='col-span-full flex flex-row items-center justify-center'>
					<Tooltip content={parked ? 'Open' : 'Close'} placement='bottom' showArrow>
						<IconButton color={parked ? 'success' : 'danger'} icon={parked ? Icons.Lock : Icons.LockOpen} isDisabled={!connected || !canPark || parking} onPointerUp={parked ? cover.unpark : cover.park} size='lg' />
					</Tooltip>
				</div>
			</div>
		</Modal>
	)
})
