import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { coverStore } from '@/stores/cover.store'
import { useStore } from '../hooks/store.hook'
import { CoverDeviceContext, CoverStoreContext } from '../shared/context'
import { Chip } from './components/Chip'
import { IconButton } from './components/IconButton'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Cover = memo(() => {
	const device = useContext(CoverDeviceContext)
	const cover = useStore(() => coverStore(device), [device])

	return (
		<CoverStoreContext value={cover}>
			<Modal header={<Header />} id={`cover-${device.id}`} initialWidth="256px" onHide={cover.hide}>
				<Body />
			</Modal>
		</CoverStoreContext>
	)
})

const Header = memo(() => {
	const cover = useContext(CoverStoreContext)
	const { connecting, connected, name } = useSnapshot(cover.state.cover)

	return (
		<div className="flex w-full min-w-0 flex-row items-center justify-between gap-2">
			<div className="flex shrink-0 flex-row items-center gap-1">
				<ConnectButton connected={connected} loading={connecting} onClick={cover.connect} />
				<IndiPanelControlButton device={cover.state.cover} />
			</div>
			<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Cover</span>
				<span className="max-w-full truncate text-xs font-normal text-neutral-400">{name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<Status />
		<OpenAndClose />
	</div>
))

function coverStatus(connected: boolean, canPark: boolean, parking: boolean, parked: boolean) {
	if (!connected) return { color: 'default', label: 'disconnected' } as const
	if (!canPark) return { color: 'warning', label: 'unsupported' } as const
	if (parking) return { color: 'warning', label: 'moving' } as const
	if (parked) return { color: 'success', label: 'closed' } as const
	return { color: 'primary', label: 'open' } as const
}

const Status = memo(() => {
	const cover = useContext(CoverStoreContext)
	const { connected, canPark, parking, parked } = useSnapshot(cover.state.cover)
	const { color, label } = coverStatus(connected, canPark, parking, parked)

	return (
		<div className="col-span-full flex flex-row items-center justify-between">
			<Chip color={color} label={label} size="sm" />
		</div>
	)
})

const OpenAndClose = memo(() => {
	const cover = useContext(CoverStoreContext)
	const { connected, parking, parked, canPark, canAbort } = useSnapshot(cover.state.cover)
	const canMove = connected && canPark && !parking

	return (
		<div className="col-span-full flex flex-row items-center justify-center gap-2">
			<IconButton color={parked ? 'primary' : 'success'} disabled={!canMove} icon={parked ? Icons.LockOpen : Icons.Lock} onClick={parked ? cover.unpark : cover.park} size="lg" tooltipContent={parked ? 'Open' : 'Close'} />
			{canAbort && <IconButton color="danger" disabled={!connected || !parking} icon={Icons.Stop} onClick={cover.stop} size="lg" tooltipContent="Stop" />}
		</div>
	)
})
