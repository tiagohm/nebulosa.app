import { WheelStoreContext } from '@shared/context'
import { equipmentStore } from '@stores/equipment.store'
import { wheelStore, type WheelStore } from '@stores/wheel.store'
import { Button } from '@ui/components/Button'
import { Chip } from '@ui/components/Chip'
import { IconButton } from '@ui/components/IconButton'
import { Popover } from '@ui/components/Popover'
import { Select } from '@ui/components/Select'
import { Tabs, Tab, TabPanel } from '@ui/components/Tabs'
import { TextInput } from '@ui/components/TextInput'
import { ConnectButton } from '@ui/ConnectButton'
import { Icons } from '@ui/Icon'
import { IndiPanelControl } from '@ui/IndiPanelControl'
import type { IDockviewPanelProps } from 'dockview-react'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { memo, useContext, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'

export const Wheel = memo(({ params }: IDockviewPanelProps<Device>) => {
	const storeRef = useRef<WheelStore | undefined>(undefined)

	useEffect(() => storeRef.current?.mount(), [])

	const { length } = useSnapshot(equipmentStore.state.wheel) // used only to rerender this component
	const wheel = length > 0 && equipmentStore.state.wheel.find((e) => e.id === params.id)

	if (!wheel) {
		storeRef.current?.unmount()
		storeRef.current = undefined
		return <div className="flex h-full w-full items-center justify-center">Not available</div>
	}

	const store = storeRef.current ?? wheelStore(wheel)
	storeRef.current = store

	return (
		<WheelStoreContext value={store}>
			<Tabs className="p-3" startContent={<TabStartContent />}>
				<Tab id="control">Filter Wheel</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="control">
					<Main />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={wheel} />
				</TabPanel>
			</Tabs>
		</WheelStoreContext>
	)
})

const TabStartContent = memo(() => {
	const wheel = useContext(WheelStoreContext)
	const { connected, connecting } = useSnapshot(wheel.state.wheel)

	return <ConnectButton connected={connected} loading={connecting} onClick={wheel.connect} />
})

const Main = memo(() => (
	<div className="grid grid-cols-12 gap-2">
		<Status />
		<Slot />
	</div>
))

const Status = memo(() => {
	const wheel = useContext(WheelStoreContext)
	const { count, moving, position, names } = useSnapshot(wheel.state.wheel)

	return (
		<div className="col-span-full flex flex-row flex-wrap items-center justify-start gap-2">
			<Chip color={moving ? 'warning' : 'default'} size="sm">
				{moving ? 'moving' : 'idle'}
			</Chip>
			<Chip color="warning" size="sm">
				POSITION: {slotPosition(position, count, names)}
			</Chip>
			<Chip color="success" size="sm">
				FILTER: {slotPosition(position, count, names) === '--' ? '--' : slotName(names, position)}
			</Chip>
		</div>
	)
})

const Slot = memo(() => {
	const wheel = useContext(WheelStoreContext)
	const { selected } = useSnapshot(wheel.state)
	const { connected, count, moving, position, names } = useSnapshot(wheel.state.wheel)
	const positions = Array.from({ length: slotCount(count, names) }, (_, index) => index)
	const selectedPosition = positions.includes(selected.position) ? selected.position : null
	const canMove = connected && !moving && selectedPosition !== null && selected.position !== position

	function renderSlot(position: number) {
		return <span>{slotName(names, position)}</span>
	}

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Select className="flex-1" disabled={!connected || moving || positions.length === 0} endContent={<SlotPopover />} items={positions} label="Slot" onValueChange={(value) => wheel.update('position', value)} value={selectedPosition}>
				{renderSlot}
			</Select>
			<Button color="success" disabled={!canMove} label="Move" loading={moving} onClick={wheel.move} startContent={<Icons.Check />} variant="ghost" />
		</div>
	)
})

const SlotPopover = memo(() => {
	const wheel = useContext(WheelStoreContext)
	const { connected, count, moving, names } = useSnapshot(wheel.state.wheel)
	const disabled = !connected || moving || slotCount(count, names) === 0

	return (
		<Popover disabled={disabled} trigger={<IconButton disabled={disabled} icon={Icons.Cog} size="sm" />}>
			<SlotPopoverContent />
		</Popover>
	)
})

const SlotPopoverContent = memo(() => {
	const wheel = useContext(WheelStoreContext)
	const { canSetNames, connected, moving } = useSnapshot(wheel.state.wheel)
	const { name, position } = useSnapshot(wheel.state.selected)
	const disabled = !connected || moving || !canSetNames
	const canApply = !disabled && position >= 0 && name.length > 0

	return (
		<div className="grid grid-cols-12 gap-2 p-4">
			<p className="col-span-full font-bold">SLOT OPTIONS</p>
			<TextInput className="col-span-10" disabled={disabled} label="Name" onValueChange={(value) => wheel.update('name', value)} value={name} />
			<div className="col-span-2 flex flex-row items-center justify-center">
				<IconButton color="success" disabled={!canApply} icon={Icons.Check} onClick={wheel.apply} tooltipContent="Apply" />
			</div>
		</div>
	)
})

function slotCount(count: number, names: readonly string[]) {
	return Math.max(Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0, names.length)
}

function slotName(names: readonly string[], position: number) {
	return names[position] || `Slot ${position + 1}`
}

function slotPosition(position: number, count: number, names: readonly string[]) {
	return Number.isInteger(position) && position >= 0 && position < slotCount(count, names) ? position + 1 : '--'
}
