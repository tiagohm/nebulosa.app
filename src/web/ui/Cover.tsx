import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { CoverMolecule } from '@/molecules/indi/cover'
import { Chip } from './components/Chip'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Cover = memo(() => {
	const cover = useMolecule(CoverMolecule)

	return (
		<Modal header={<Header />} id={`cover-${cover.scope.cover.name}`} maxWidth="256px" onHide={cover.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const cover = useMolecule(CoverMolecule)
	const { connecting, connected } = useSnapshot(cover.state.cover)

	return (
		<div className="flex w-full flex-row items-center justify-between">
			<div className="flex flex-row items-center gap-1">
				<ConnectButton isConnected={connected} loading={connecting} onPointerUp={cover.connect} />
				<IndiPanelControlButton device={cover.scope.cover.name} />
			</div>
			<div className="flex flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Cover</span>
				<span className="max-w-full text-xs font-normal text-gray-400">{cover.scope.cover.name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => {
	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<Status />
			<OpenAndClose />
		</div>
	)
})

const Status = memo(() => {
	const cover = useMolecule(CoverMolecule)
	const { connected, parking, parked } = useSnapshot(cover.state.cover)

	return (
		<div className="col-span-full flex flex-row items-center justify-between">
			<Chip color="primary">{!connected ? 'idle' : parking ? 'moving' : parked ? 'closed' : 'open'}</Chip>
		</div>
	)
})

const OpenAndClose = memo(() => {
	const cover = useMolecule(CoverMolecule)
	const { connected, parking, parked, canPark } = useSnapshot(cover.state.cover)

	return (
		<div className="col-span-full flex flex-row items-center justify-center">
			<IconButton color={parked ? 'success' : 'danger'} disabled={!connected || !canPark || parking} icon={parked ? Icons.Lock : Icons.LockOpen} onPointerUp={parked ? cover.unpark : cover.park} size="lg" tooltipContent={parked ? 'Open' : 'Close'} />
		</div>
	)
})
