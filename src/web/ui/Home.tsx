import { Activity, memo, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { equipmentStore } from '@/stores/equipment.store'
import { wsStore } from '@/stores/ws.store'
import { useStore } from '../hooks/store.hook'
import { FocuserDeviceContext, GuideOutputDeviceContext, FlatPanelDeviceContext, DewHeaterDeviceContext, RotatorDeviceContext } from '../shared/context'
import { activityMode } from '../shared/util'
import { DewHeater } from './DewHeater'
import { FlatPanel } from './FlatPanel'
import { Focuser } from './Focuser'
import { GuideOutput } from './GuideOutput'
import { HomeNavBar } from './HomeNavBar'
import { Rotator } from './Rotator'

export const Home = memo(() => {
	useStore(wsStore, [])

	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-col">
			<HomeNavBar />
			<FocuserList />
			<GuideOutputList />
			<FlatPanelList />
			<DewHeaterList />
			<RotatorList />
		</div>
	)
})

function makeDevices(length: number, callback: (index: number) => React.ReactNode) {
	const devices = new Array(length)
	for (let i = 0; i < length; i++) devices[i] = callback(i)
	return devices
}

interface DeviceItemProps {
	readonly index: number
}

function FocuserItem({ index }: DeviceItemProps) {
	const focuser = equipmentStore.state.focuser[index]
	const { show } = useSnapshot(focuser)

	return (
		<>
			<Activity mode={activityMode(show)}>
				<FocuserDeviceContext value={focuser}>
					<Focuser key={focuser.id} />
				</FocuserDeviceContext>
			</Activity>
		</>
	)
}

function GuideOutputItem({ index }: DeviceItemProps) {
	const guideOutput = equipmentStore.state.guideOutput[index]
	const { show } = useSnapshot(guideOutput)

	return (
		<>
			<Activity mode={activityMode(show)}>
				<GuideOutputDeviceContext value={guideOutput}>
					<GuideOutput key={guideOutput.id} />
				</GuideOutputDeviceContext>
			</Activity>
		</>
	)
}

function FlatPanelItem({ index }: DeviceItemProps) {
	const flatPanel = equipmentStore.state.flatPanel[index]
	const { show } = useSnapshot(flatPanel)

	return (
		<>
			<Activity mode={activityMode(show)}>
				<FlatPanelDeviceContext value={flatPanel}>
					<FlatPanel key={flatPanel.id} />
				</FlatPanelDeviceContext>
			</Activity>
		</>
	)
}

function DewHeaterItem({ index }: DeviceItemProps) {
	const dewHeater = equipmentStore.state.dewHeater[index]
	const { show } = useSnapshot(dewHeater)

	return (
		<>
			<Activity mode={activityMode(show)}>
				<DewHeaterDeviceContext value={dewHeater}>
					<DewHeater key={dewHeater.id} />
				</DewHeaterDeviceContext>
			</Activity>
		</>
	)
}

function RotatorItem({ index }: DeviceItemProps) {
	const rotator = equipmentStore.state.rotator[index]
	const { show } = useSnapshot(rotator)

	return (
		<>
			<Activity mode={activityMode(show)}>
				<RotatorDeviceContext value={rotator}>
					<Rotator key={rotator.id} />
				</RotatorDeviceContext>
			</Activity>
		</>
	)
}

export const FocuserList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.focuser)
	const devices = useMemo(() => makeDevices(length, (i) => <FocuserItem key={equipmentStore.state.focuser[i].id} index={i} />), [length])
	return devices
})

export const GuideOutputList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.guideOutput)
	const devices = useMemo(() => makeDevices(length, (i) => <GuideOutputItem key={equipmentStore.state.guideOutput[i].id} index={i} />), [length])
	return devices
})

export const FlatPanelList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.flatPanel)
	const devices = useMemo(() => makeDevices(length, (i) => <FlatPanelItem key={equipmentStore.state.flatPanel[i].id} index={i} />), [length])
	return devices
})

export const DewHeaterList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.dewHeater)
	const devices = useMemo(() => makeDevices(length, (i) => <DewHeaterItem key={equipmentStore.state.dewHeater[i].id} index={i} />), [length])
	return devices
})

export const RotatorList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.rotator)
	const devices = useMemo(() => makeDevices(length, (i) => <RotatorItem key={equipmentStore.state.rotator[i].id} index={i} />), [length])
	return devices
})
