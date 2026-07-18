import { useDevice } from '@hooks/device.hook'
import { FocuserStoreContext } from '@shared/context'
import { focuserStore } from '@stores/focuser.store'
import { Checkbox } from '@ui/components/Checkbox'
import { Chip } from '@ui/components/Chip'
import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Tab, TabPanel, Tabs } from '@ui/components/Tabs'
import { ConnectButton } from '@ui/ConnectButton'
import { Icons } from '@ui/Icon'
import { IndiPanelControl } from '@ui/IndiPanelControl'
import type { IDockviewPanelProps } from 'dockview-react'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

export const Focuser = memo(({ params }: IDockviewPanelProps<Device>) => {
	const focuser = useDevice('focuser', params.id, focuserStore)

	if (!focuser) return <div className="flex h-full w-full items-center justify-center">Not available</div>

	return (
		<FocuserStoreContext value={focuser.store}>
			<Tabs className="p-3" startContent={<TabStartContent />}>
				<Tab id="main">Filter Wheel</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="main">
					<Main />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={focuser.device} />
				</TabPanel>
			</Tabs>
		</FocuserStoreContext>
	)
})

const TabStartContent = memo(() => {
	const focuser = useContext(FocuserStoreContext)
	const { connected, connecting } = useSnapshot(focuser.state.focuser)

	return <ConnectButton connected={connected} loading={connecting} onClick={focuser.connect} />
})

const Main = memo(() => (
	<div className="grid grid-cols-12 items-center gap-2 p-3">
		<Status />
		<Position />
		<RelativePosition />
		<AbsolutePosition />
		<Misc />
	</div>
))

const Status = memo(() => {
	const focuser = useContext(FocuserStoreContext)
	const { moving } = useSnapshot(focuser.state.focuser)

	return (
		<div className="col-span-3 flex flex-row items-center justify-start">
			<Chip color={moving ? 'warning' : 'default'} size="sm">
				{moving ? 'moving' : 'idle'}
			</Chip>
		</div>
	)
})

const Position = memo(() => {
	const focuser = useContext(FocuserStoreContext)
	const { connected, moving, position, canAbort } = useSnapshot(focuser.state.focuser)

	return (
		<div className="col-span-9 flex min-w-0 flex-row items-center justify-end gap-2">
			<NumberInput className="min-w-0 flex-1" label="Position" readOnly value={position.value} />
			<IconButton color="danger" disabled={!connected || !canAbort || !moving} icon={Icons.Stop} onClick={focuser.stop} tooltipContent="Stop" />
		</div>
	)
})

const RelativePosition = memo(() => {
	const focuser = useContext(FocuserStoreContext)
	const { connected, moving, position, canRelativeMove } = useSnapshot(focuser.state.focuser)
	const { relative } = useSnapshot(focuser.state.request)
	const canMoveRelative = connected && !moving && Number.isFinite(relative) && relative > 0

	if (!canRelativeMove) return null

	return (
		<div className="col-span-6 flex flex-row items-center justify-between gap-2">
			<IconButton color="secondary" disabled={!canMoveRelative} icon={Icons.ArrowLeft} onClick={focuser.moveIn} tooltipContent="Move In" />
			<NumberInput className="min-w-0 flex-1" disabled={!connected || moving} label="Relative" maxValue={position.max} minValue={1} onValueChange={(value) => focuser.update('relative', value)} value={relative} />
			<IconButton color="secondary" disabled={!canMoveRelative} icon={Icons.ArrowRight} onClick={focuser.moveOut} tooltipContent="Move Out" />
		</div>
	)
})

const AbsolutePosition = memo(() => {
	const focuser = useContext(FocuserStoreContext)
	const { connected, moving, position, canSync, canAbsoluteMove } = useSnapshot(focuser.state.focuser)
	const { absolute } = useSnapshot(focuser.state.request)
	const canUseAbsolute = connected && !moving && Number.isFinite(absolute)

	if (!canAbsoluteMove) return null

	return (
		<div className="col-span-6 flex flex-row items-center justify-between gap-2">
			<IconButton color="primary" disabled={!canUseAbsolute || !canSync} icon={Icons.Sync} onClick={focuser.sync} tooltipContent="Sync" />
			<NumberInput className="min-w-0 flex-1" disabled={!connected || moving} label="Absolute" maxValue={position.max} minValue={0} onValueChange={(value) => focuser.update('absolute', value)} value={absolute} />
			<IconButton color="success" disabled={!canUseAbsolute || absolute === position.value} icon={Icons.Check} onClick={focuser.moveTo} tooltipContent="Move" />
		</div>
	)
})

const Misc = memo(() => {
	const focuser = useContext(FocuserStoreContext)
	const { connected, moving, canReverse, reversed } = useSnapshot(focuser.state.focuser)

	return (
		<div className="col-span-full flex flex-row items-center justify-between gap-2">
			<Checkbox className="col-span-full mt-1" disabled={!connected || moving || !canReverse} label="Reversed" onValueChange={focuser.reverse} value={reversed} />
		</div>
	)
})
