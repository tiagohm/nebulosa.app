import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { useStore } from '../hooks/store.hook'
import { RotatorDeviceContext, RotatorStoreContext } from '../shared/context'
import { rotatorStore } from '../store/rotator.store'
import { Checkbox } from './components/Checkbox'
import { Chip } from './components/Chip'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

function hasAngleChanged(targetAngle: number, currentAngle: number) {
	return Number.isFinite(targetAngle) && Math.abs(targetAngle - currentAngle) > 1e-6
}

export const Rotator = memo(() => {
	const device = useContext(RotatorDeviceContext)
	const rotator = useStore(() => rotatorStore(device), [device])

	return (
		<RotatorStoreContext value={rotator}>
			<Modal header={<Header />} id={`rotator-${device.id}`} maxWidth="256px" onHide={rotator.hide}>
				<Body />
			</Modal>
		</RotatorStoreContext>
	)
})

const Header = memo(() => {
	const rotator = useContext(RotatorStoreContext)
	const { connecting, connected, name } = useSnapshot(rotator.state.rotator)

	return (
		<div className="flex w-full flex-row items-center justify-between">
			<div className="flex flex-row items-center gap-1">
				<ConnectButton connected={connected} loading={connecting} onClick={rotator.connect} />
				<IndiPanelControlButton device={rotator.state.rotator} />
			</div>
			<div className="flex flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Rotator</span>
				<span className="max-w-full text-xs font-normal text-gray-400">{name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<Status />
		<CurrentAngle />
		<TargetAngle />
		<Options />
	</div>
))

const Status = memo(() => {
	const rotator = useContext(RotatorStoreContext)
	const { moving } = useSnapshot(rotator.state.rotator)

	return (
		<div className="col-span-3 flex flex-row items-center justify-start">
			<Chip color="primary">{moving ? 'moving' : 'idle'}</Chip>
		</div>
	)
})

const CurrentAngle = memo(() => {
	const rotator = useContext(RotatorStoreContext)
	const { connected, moving, angle, canAbort, canHome } = useSnapshot(rotator.state.rotator)

	return (
		<div className="col-span-9 flex flex-row items-center justify-end gap-2">
			<NumberInput className="flex-1" label="Angle (°)" readOnly value={angle.value} />
			<IconButton color="primary" disabled={!connected || !canHome || moving} icon={Icons.Home} onClick={rotator.home} tooltipContent="Home" />
			<IconButton color="danger" disabled={!connected || !canAbort || !moving} icon={Icons.Stop} onClick={rotator.stop} tooltipContent="Stop" />
		</div>
	)
})

const TargetAngle = memo(() => {
	const rotator = useContext(RotatorStoreContext)
	const { connected, moving, angle, canSync } = useSnapshot(rotator.state.rotator)
	const { angle: targetAngle } = useSnapshot(rotator.state)
	const canMove = connected && !moving && hasAngleChanged(targetAngle, angle.value)

	return (
		<div className="col-span-full flex flex-row items-center justify-between gap-2">
			<IconButton color="primary" disabled={!connected || !canSync || moving} icon={Icons.Sync} onClick={rotator.sync} tooltipContent="Sync" />
			<NumberInput className="flex-1" disabled={!connected || moving} label="Move (°)" maxValue={angle.max} minValue={angle.min} onValueChange={(value) => rotator.update('angle', value)} value={targetAngle} />
			<IconButton color="success" disabled={!canMove} icon={Icons.Check} onClick={rotator.moveTo} tooltipContent="Move" />
		</div>
	)
})

const Options = memo(() => {
	const rotator = useContext(RotatorStoreContext)
	const { connected, moving, canReverse, reversed } = useSnapshot(rotator.state.rotator)

	return <Checkbox className="col-span-full mt-1" disabled={!connected || moving || !canReverse} label="Reversed" onValueChange={rotator.reverse} value={reversed} />
})
