import { coverStore, type CoverStore } from '@stores/cover.store'
import { Chip } from '@ui/components/Chip'
import { IconButton } from '@ui/components/IconButton'
import { Tab, Tabs, TabPanel } from '@ui/components/Tabs'
import { ConnectButton } from '@ui/ConnectButton'
import { Icons } from '@ui/Icon'
import { IndiPanelControl } from '@ui/IndiPanelControl'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useContext, useEffect, useRef } from 'react'
import { CoverStoreContext } from 'src/web/shared/context'
import { equipmentStore } from 'src/web/stores/equipment.store'
import type { DevicePanelParams } from 'src/web/stores/home.store'
import { useSnapshot } from 'valtio'

export const Cover = memo(({ params }: IDockviewPanelProps<DevicePanelParams>) => {
	const storeRef = useRef<CoverStore | undefined>(undefined)

	useEffect(() => storeRef.current?.mount(), [])

	const { length } = useSnapshot(equipmentStore.state.cover) // used only to rerender this component
	const cover = length > 0 && equipmentStore.state.cover.find((e) => e.id === params.id)

	if (!cover) {
		storeRef.current?.unmount()
		storeRef.current = undefined
		return <div className="flex h-full w-full items-center justify-center">Not available</div>
	}

	const store = storeRef.current ?? coverStore(cover)
	storeRef.current = store

	return (
		<CoverStoreContext value={store}>
			<Tabs className="px-3">
				<Tab id="control">Cover</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="control">
					<Control />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={cover} />
				</TabPanel>
			</Tabs>
		</CoverStoreContext>
	)
})

const Control = memo(() => (
	<div className="grid grid-cols-12 gap-2">
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
	const { connecting, connected, canPark, parking, parked } = useSnapshot(cover.state.cover)
	const { color, label } = coverStatus(connected, canPark, parking, parked)

	return (
		<div className="col-span-full flex flex-row items-center gap-2">
			<ConnectButton connected={connected} loading={connecting} onClick={cover.connect} />
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
