import { useDevice } from '@hooks/device.hook'
import { RotatorStoreContext } from '@shared/context'
import { rotatorStore } from '@stores/rotator.store'
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

export const Rotator = memo(({ params }: IDockviewPanelProps<Device>) => {
	const rotator = useDevice('rotator', params.id, rotatorStore)

	if (!rotator) return <div className="flex h-full w-full items-center justify-center">Not available</div>

	return (
		<RotatorStoreContext value={rotator.store}>
			<Tabs className="p-3" startContent={<TabStartContent />}>
				<Tab id="main">rotator</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="main">
					<Main />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={rotator.device} />
				</TabPanel>
			</Tabs>
		</RotatorStoreContext>
	)
})

const TabStartContent = memo(() => {
	const rotator = useContext(RotatorStoreContext)
	const { connected, connecting } = useSnapshot(rotator.state.rotator)

	return <ConnectButton connected={connected} loading={connecting} onClick={rotator.connect} />
})

const Main = memo(() => (
	<div className="grid grid-cols-12 gap-2">
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
			<Chip color="primary" size="sm">
				{moving ? 'moving' : 'idle'}
			</Chip>
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
			<NumberInput className="flex-1" disabled={!connected || moving} label="Move (°)" maxValue={angle.max} minValue={angle.min} onValueChange={rotator.setAngle} value={targetAngle} />
			<IconButton color="success" disabled={!canMove} icon={Icons.Check} onClick={rotator.moveTo} tooltipContent="Move" />
		</div>
	)
})

const Options = memo(() => {
	const rotator = useContext(RotatorStoreContext)
	const { connected, moving, canReverse, reversed } = useSnapshot(rotator.state.rotator)

	return <Checkbox className="col-span-full mt-1" disabled={!connected || moving || !canReverse} label="Reversed" onValueChange={rotator.reverse} value={reversed} />
})

function hasAngleChanged(targetAngle: number, currentAngle: number) {
	return Number.isFinite(targetAngle) && Math.abs(targetAngle - currentAngle) > 1e-6
}
