import { Activity, memo, useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { CameraDeviceContext, MountDeviceContext, FocuserDeviceContext, WheelDeviceContext, GuideOutputDeviceContext, ThermometerDeviceContext, CoverDeviceContext, FlatPanelDeviceContext, DewHeaterDeviceContext, RotatorDeviceContext } from '../shared/context'
import { activityMode } from '../shared/util'
import { equipmentStore } from '../store/equipment.store'
import { wsStore } from '../store/ws.store'
import { Camera } from './Camera'
import { Confirmation } from './Confirmation'
import { Cover } from './Cover'
import { DewHeater } from './DewHeater'
import { FlatPanel } from './FlatPanel'
import { Focuser } from './Focuser'
import { GuideOutput } from './GuideOutput'
import { HomeNavBar } from './HomeNavBar'
import { ImageWorkspace } from './ImageWorkspace'
import { Mount } from './Mount'
import { Rotator } from './Rotator'
import { Thermometer } from './Thermometer'
import { Wheel } from './Wheel'

export const Home = memo(() => {
	// Mounts the websocket lifecycle once the home screen is active.
	useEffect(wsStore.mount, [])

	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-col">
			<HomeNavBar />
			<ImageWorkspace />
			<CameraList />
			<MountList />
			<FocuserList />
			<WheelList />
			<ThermometerList />
			<GuideOutputList />
			<CoverList />
			<FlatPanelList />
			<DewHeaterList />
			<RotatorList />
			<Confirmation />
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

function CameraItem({ index }: DeviceItemProps) {
	const camera = equipmentStore.state.camera[index]
	const { show } = useSnapshot(camera)

	return (
		<Activity mode={activityMode(show)}>
			<CameraDeviceContext value={camera}>
				<Camera />
			</CameraDeviceContext>
		</Activity>
	)
}

function MountItem({ index }: DeviceItemProps) {
	const mount = equipmentStore.state.mount[index]
	const { show } = useSnapshot(mount)

	return (
		<Activity mode={activityMode(show)}>
			<MountDeviceContext value={mount}>
				<Mount />
			</MountDeviceContext>
		</Activity>
	)
}

function FocuserItem({ index }: DeviceItemProps) {
	const focuser = equipmentStore.state.focuser[index]
	const { show } = useSnapshot(focuser)

	return (
		<Activity mode={activityMode(show)}>
			<FocuserDeviceContext value={focuser}>
				<Focuser />
			</FocuserDeviceContext>
		</Activity>
	)
}

function WheelItem({ index }: DeviceItemProps) {
	const wheel = equipmentStore.state.wheel[index]
	const { show } = useSnapshot(wheel)

	return (
		<Activity mode={activityMode(show)}>
			<WheelDeviceContext value={wheel}>
				<Wheel />
			</WheelDeviceContext>
		</Activity>
	)
}

function GuideOutputItem({ index }: DeviceItemProps) {
	const guideOutput = equipmentStore.state.guideOutput[index]
	const { show } = useSnapshot(guideOutput)

	return (
		<Activity mode={activityMode(show)}>
			<GuideOutputDeviceContext value={guideOutput}>
				<GuideOutput />
			</GuideOutputDeviceContext>
		</Activity>
	)
}

function ThermometerItem({ index }: DeviceItemProps) {
	const thermometer = equipmentStore.state.thermometer[index]
	const { show } = useSnapshot(thermometer)

	return (
		<Activity mode={activityMode(show)}>
			<ThermometerDeviceContext value={thermometer}>
				<Thermometer />
			</ThermometerDeviceContext>
		</Activity>
	)
}

function CoverItem({ index }: DeviceItemProps) {
	const cover = equipmentStore.state.cover[index]
	const { show } = useSnapshot(cover)

	return (
		<Activity mode={activityMode(show)}>
			<CoverDeviceContext value={cover}>
				<Cover />
			</CoverDeviceContext>
		</Activity>
	)
}

function FlatPanelItem({ index }: DeviceItemProps) {
	const flatPanel = equipmentStore.state.flatPanel[index]
	const { show } = useSnapshot(flatPanel)

	return (
		<Activity mode={activityMode(show)}>
			<FlatPanelDeviceContext value={flatPanel}>
				<FlatPanel />
			</FlatPanelDeviceContext>
		</Activity>
	)
}

function DewHeaterItem({ index }: DeviceItemProps) {
	const dewHeater = equipmentStore.state.dewHeater[index]
	const { show } = useSnapshot(dewHeater)

	return (
		<Activity mode={activityMode(show)}>
			<DewHeaterDeviceContext value={dewHeater}>
				<DewHeater />
			</DewHeaterDeviceContext>
		</Activity>
	)
}

function RotatorItem({ index }: DeviceItemProps) {
	const rotator = equipmentStore.state.rotator[index]
	const { show } = useSnapshot(rotator)

	return (
		<Activity mode={activityMode(show)}>
			<RotatorDeviceContext value={rotator}>
				<Rotator />
			</RotatorDeviceContext>
		</Activity>
	)
}

export const CameraList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.camera)

	const devices = useMemo(() => makeDevices(length, (i) => <CameraItem key={equipmentStore.state.camera[i].id} index={i} />), [length])

	return devices
})

export const MountList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.mount)

	const devices = useMemo(() => makeDevices(length, (i) => <MountItem key={equipmentStore.state.mount[i].id} index={i} />), [length])

	return devices
})

export const FocuserList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.focuser)

	const devices = useMemo(() => makeDevices(length, (i) => <FocuserItem key={equipmentStore.state.focuser[i].id} index={i} />), [length])

	return devices
})

export const WheelList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.wheel)

	const devices = useMemo(() => makeDevices(length, (i) => <WheelItem key={equipmentStore.state.wheel[i].id} index={i} />), [length])

	return devices
})

export const GuideOutputList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.guideOutput)

	const devices = useMemo(() => makeDevices(length, (i) => <GuideOutputItem key={equipmentStore.state.guideOutput[i].id} index={i} />), [length])

	return devices
})

export const ThermometerList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.thermometer)

	const devices = useMemo(() => makeDevices(length, (i) => <ThermometerItem key={equipmentStore.state.thermometer[i].id} index={i} />), [length])

	return devices
})

export const CoverList = memo(() => {
	const { length } = useSnapshot(equipmentStore.state.cover)

	const devices = useMemo(() => makeDevices(length, (i) => <CoverItem key={equipmentStore.state.cover[i].id} index={i} />), [length])

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
