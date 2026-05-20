import { memo, useContext, useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { WheelDeviceContext, WheelStoreContext } from '../shared/context'
import { wheelStore } from '../store/wheel.store'
import { Button } from './components/Button'
import { Chip } from './components/Chip'
import { IconButton } from './components/IconButton'
import { Popover } from './components/Popover'
import { Select } from './components/Select'
import { TextInput } from './components/TextInput'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Wheel = memo(() => {
	const device = useContext(WheelDeviceContext)
	const wheel = useMemo(() => wheelStore(device), [device])
	useEffect(wheel.mount, [wheel])

	return (
		<WheelStoreContext value={wheel}>
			<Modal header={<Header />} id={`wheel-${device.id}`} maxWidth="256px" onHide={wheel.hide}>
				<Body />
			</Modal>
		</WheelStoreContext>
	)
})

const Header = memo(() => {
	const wheel = useContext(WheelStoreContext)
	const { connecting, connected, name } = useSnapshot(wheel.state.wheel)

	return (
		<div className="flex w-full min-w-0 flex-row items-center justify-between gap-2">
			<div className="flex shrink-0 flex-row items-center gap-1">
				<ConnectButton connected={connected} loading={connecting} onClick={wheel.connect} />
				<IndiPanelControlButton device={wheel.state.wheel} />
			</div>
			<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Filter Wheel</span>
				<span className="max-w-full truncate text-xs font-normal text-neutral-400">{name}</span>
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

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
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
