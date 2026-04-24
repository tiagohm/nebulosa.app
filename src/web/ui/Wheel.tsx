import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { WheelMolecule } from '@/molecules/indi/wheel'
import { Button } from './components/Button'
import { Chip } from './components/Chip'
import { Popover } from './components/Popover'
import { Select } from './components/Select'
import { TextInput } from './components/TextInput'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Wheel = memo(() => {
	const wheel = useMolecule(WheelMolecule)

	return (
		<Modal header={<Header />} id={`wheel-${wheel.scope.wheel.name}`} maxWidth="256px" onHide={wheel.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { connecting, connected } = useSnapshot(wheel.state.wheel)

	return (
		<div className="flex w-full flex-row items-center justify-between">
			<div className="flex flex-row items-center gap-1">
				<ConnectButton isConnected={connected} loading={connecting} onPointerUp={wheel.connect} />
				<IndiPanelControlButton device={wheel.scope.wheel.name} />
			</div>
			<div className="flex flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Filter Wheel</span>
				<span className="max-w-full text-xs font-normal text-gray-400">{wheel.scope.wheel.name}</span>
			</div>
		</div>
	)
})

const SlotItem = (name: string) => <span>{name}</span>

const Body = memo(() => {
	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<Status />
			<Slot />
		</div>
	)
})

const Status = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { moving, position, names } = useSnapshot(wheel.state.wheel)

	return (
		<div className="col-span-3 flex flex-row items-center justify-start gap-2">
			<Chip color="primary">{moving ? 'moving' : 'idle'}</Chip>
			<Chip color="warning">POSITION: {position}</Chip>
			<Chip color="success">FILTER: {names[position]}</Chip>
		</div>
	)
})

const Slot = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { selected } = useSnapshot(wheel.state)
	const { connected, moving, position, names } = useSnapshot(wheel.state.wheel)

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Select className="flex-1" items={names} endContent={<SlotPopover />} disabled={!connected || moving || names.length === 0} label="Slot" onValueChange={(value) => wheel.update('position', names.indexOf(value))} value={names[selected.position]}>
				{SlotItem}
			</Select>
			<Button color="success" disabled={!connected || selected.position === position || names.length === 0} label="Move" loading={moving} onPointerUp={wheel.moveTo} startContent={<Icons.Check />} variant="ghost" />
		</div>
	)
})

const SlotPopover = memo(() => {
	return (
		<Popover trigger={<IconButton icon={Icons.Cog} />}>
			<SlotPopoverContent />
		</Popover>
	)
})

const SlotPopoverContent = memo(() => {
	const wheel = useMolecule(WheelMolecule)
	const { canSetNames } = useSnapshot(wheel.state.wheel)
	const { name } = useSnapshot(wheel.state.selected, { sync: true })

	return (
		<div className="grid grid-cols-12 gap-2 p-4">
			<p className="col-span-full font-bold">SLOT OPTIONS</p>
			<TextInput className="col-span-10" disabled={!canSetNames} label="Name" onValueChange={(value) => value && wheel.update('name', value)} value={name} />
			<div className="col-span-2 flex flex-row items-center justify-center">
				<IconButton color="success" disabled={!canSetNames || name.length === 0} icon={Icons.Check} onPointerUp={wheel.apply} tooltipContent="Apply" />
			</div>
		</div>
	)
})
