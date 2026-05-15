import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FocuserMolecule } from '@/molecules/indi/focuser'
import { Checkbox } from './components/Checkbox'
import { Chip } from './components/Chip'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Focuser = memo(() => {
	const focuser = useMolecule(FocuserMolecule)

	return (
		<Modal header={<Header />} id={`focuser-${focuser.scope.focuser.id}`} maxWidth="256px" onHide={focuser.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connecting, connected, name } = useSnapshot(focuser.state.focuser)

	return (
		<div className="flex w-full min-w-0 flex-row items-center justify-between gap-2">
			<div className="flex shrink-0 flex-row items-center gap-1">
				<ConnectButton connected={connected} loading={connecting} onClick={focuser.connect} />
				<IndiPanelControlButton device={focuser.scope.focuser} />
			</div>
			<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Focuser</span>
				<span className="max-w-full truncate text-xs font-normal text-neutral-400">{name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<Status />
		<Position />
		<RelativePosition />
		<AbsolutePosition />
		<Options />
	</div>
))

const Status = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
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
	const focuser = useMolecule(FocuserMolecule)
	const { connected, moving, position, canAbort } = useSnapshot(focuser.state.focuser)

	return (
		<div className="col-span-9 flex min-w-0 flex-row items-center justify-end gap-2">
			<NumberInput className="min-w-0 flex-1" label="Position" readOnly value={position.value} />
			<IconButton color="danger" disabled={!connected || !canAbort || !moving} icon={Icons.Stop} onClick={focuser.stop} tooltipContent="Stop" />
		</div>
	)
})

const RelativePosition = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connected, moving, position, canRelativeMove } = useSnapshot(focuser.state.focuser)
	const { relative } = useSnapshot(focuser.state.request)
	const canMoveRelative = connected && !moving && Number.isFinite(relative) && relative > 0

	if (!canRelativeMove) return null

	return (
		<div className="col-span-full flex flex-row items-center justify-between gap-2">
			<IconButton color="secondary" disabled={!canMoveRelative} icon={Icons.ArrowLeft} onClick={focuser.moveIn} tooltipContent="Move In" />
			<NumberInput className="min-w-0 flex-1" disabled={!connected || moving} label="Relative" maxValue={position.max} minValue={1} onValueChange={(value) => focuser.update('relative', value)} value={relative} />
			<IconButton color="secondary" disabled={!canMoveRelative} icon={Icons.ArrowRight} onClick={focuser.moveOut} tooltipContent="Move Out" />
		</div>
	)
})

const AbsolutePosition = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connected, moving, position, canSync, canAbsoluteMove } = useSnapshot(focuser.state.focuser)
	const { absolute } = useSnapshot(focuser.state.request)
	const canUseAbsolute = connected && !moving && Number.isFinite(absolute)

	if (!canAbsoluteMove) return null

	return (
		<div className="col-span-full flex flex-row items-center justify-between gap-2">
			<IconButton color="primary" disabled={!canUseAbsolute || !canSync} icon={Icons.Sync} onClick={focuser.sync} tooltipContent="Sync" />
			<NumberInput className="min-w-0 flex-1" disabled={!connected || moving} label="Absolute" maxValue={position.max} minValue={0} onValueChange={(value) => focuser.update('absolute', value)} value={absolute} />
			<IconButton color="success" disabled={!canUseAbsolute || absolute === position.value} icon={Icons.Check} onClick={focuser.moveTo} tooltipContent="Move" />
		</div>
	)
})

const Options = memo(() => {
	const focuser = useMolecule(FocuserMolecule)
	const { connected, moving, canReverse, reversed } = useSnapshot(focuser.state.focuser)

	return (
		<div className="col-span-full flex flex-row items-center justify-between gap-2">
			<Checkbox className="col-span-full mt-1" disabled={!connected || moving || !canReverse} label="Reversed" onValueChange={focuser.reverse} value={reversed} />
		</div>
	)
})
