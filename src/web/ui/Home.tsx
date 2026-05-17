import { ScopeProvider } from 'bunshi/react'
import { Activity, memo, useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { CameraScope } from '@/molecules/indi/camera'
import { CoverScope } from '@/molecules/indi/cover'
import { DewHeaterScope } from '@/molecules/indi/dewheater'
import { FlatPanelScope } from '@/molecules/indi/flatpanel'
import { FocuserScope } from '@/molecules/indi/focuser'
import { GuideOutputScope } from '@/molecules/indi/guideoutput'
import { MountScope } from '@/molecules/indi/mount'
import { RotatorScope } from '@/molecules/indi/rotator'
import { WheelScope } from '@/molecules/indi/wheel'
import { activityMode } from '../shared/util'
import { equipment } from '../store/equipment.store'
import { ws } from '../store/ws.store'
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
import { Thermometer, ThermometerDeviceContext } from './Thermometer'
import { Wheel } from './Wheel'

export const Home = memo(() => {
	// Mounts the websocket lifecycle once the home screen is active.
	useEffect(ws.mount, [])

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
	const camera = equipment.state.camera[index]
	const { show } = useSnapshot(camera)

	return (
		<Activity mode={activityMode(show)}>
			<ScopeProvider scope={CameraScope} value={{ camera }}>
				<Camera />
			</ScopeProvider>
		</Activity>
	)
}

function MountItem({ index }: DeviceItemProps) {
	const mount = equipment.state.mount[index]
	const { show } = useSnapshot(mount)

	return (
		<Activity mode={activityMode(show)}>
			<ScopeProvider scope={MountScope} value={{ mount }}>
				<Mount />
			</ScopeProvider>
		</Activity>
	)
}

function FocuserItem({ index }: DeviceItemProps) {
	const focuser = equipment.state.focuser[index]
	const { show } = useSnapshot(focuser)

	return (
		<Activity mode={activityMode(show)}>
			<ScopeProvider scope={FocuserScope} value={{ focuser }}>
				<Focuser />
			</ScopeProvider>
		</Activity>
	)
}

function WheelItem({ index }: DeviceItemProps) {
	const wheel = equipment.state.wheel[index]
	const { show } = useSnapshot(wheel)

	return (
		<Activity mode={activityMode(show)}>
			<ScopeProvider scope={WheelScope} value={{ wheel }}>
				<Wheel />
			</ScopeProvider>
		</Activity>
	)
}

function GuideOutputItem({ index }: DeviceItemProps) {
	const guideOutput = equipment.state.guideOutput[index]
	const { show } = useSnapshot(guideOutput)

	return (
		<Activity mode={activityMode(show)}>
			<ScopeProvider scope={GuideOutputScope} value={{ guideOutput }}>
				<GuideOutput />
			</ScopeProvider>
		</Activity>
	)
}

function ThermometerItem({ index }: DeviceItemProps) {
	const thermometer = equipment.state.thermometer[index]
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
	const cover = equipment.state.cover[index]
	const { show } = useSnapshot(cover)

	return (
		<Activity mode={activityMode(show)}>
			<ScopeProvider scope={CoverScope} value={{ cover }}>
				<Cover />
			</ScopeProvider>
		</Activity>
	)
}

function FlatPanelItem({ index }: DeviceItemProps) {
	const flatPanel = equipment.state.flatPanel[index]
	const { show } = useSnapshot(flatPanel)

	return (
		<Activity mode={activityMode(show)}>
			<ScopeProvider scope={FlatPanelScope} value={{ flatPanel }}>
				<FlatPanel />
			</ScopeProvider>
		</Activity>
	)
}

function DewHeaterItem({ index }: DeviceItemProps) {
	const dewHeater = equipment.state.dewHeater[index]
	const { show } = useSnapshot(dewHeater)

	return (
		<Activity mode={activityMode(show)}>
			<ScopeProvider scope={DewHeaterScope} value={{ dewHeater }}>
				<DewHeater />
			</ScopeProvider>
		</Activity>
	)
}

function RotatorItem({ index }: DeviceItemProps) {
	const rotator = equipment.state.rotator[index]
	const { show } = useSnapshot(rotator)

	return (
		<Activity mode={activityMode(show)}>
			<ScopeProvider scope={RotatorScope} value={{ rotator }}>
				<Rotator />
			</ScopeProvider>
		</Activity>
	)
}

export const CameraList = memo(() => {
	const { length } = useSnapshot(equipment.state.camera)

	const devices = useMemo(() => makeDevices(length, (i) => <CameraItem key={equipment.state.camera[i].id} index={i} />), [length])

	return devices
})

export const MountList = memo(() => {
	const { length } = useSnapshot(equipment.state.mount)

	const devices = useMemo(() => makeDevices(length, (i) => <MountItem key={equipment.state.mount[i].id} index={i} />), [length])

	return devices
})

export const FocuserList = memo(() => {
	const { length } = useSnapshot(equipment.state.focuser)

	const devices = useMemo(() => makeDevices(length, (i) => <FocuserItem key={equipment.state.focuser[i].id} index={i} />), [length])

	return devices
})

export const WheelList = memo(() => {
	const { length } = useSnapshot(equipment.state.wheel)

	const devices = useMemo(() => makeDevices(length, (i) => <WheelItem key={equipment.state.wheel[i].id} index={i} />), [length])

	return devices
})

export const GuideOutputList = memo(() => {
	const { length } = useSnapshot(equipment.state.guideOutput)

	const devices = useMemo(() => makeDevices(length, (i) => <GuideOutputItem key={equipment.state.guideOutput[i].id} index={i} />), [length])

	return devices
})

export const ThermometerList = memo(() => {
	const { length } = useSnapshot(equipment.state.thermometer)

	const devices = useMemo(() => makeDevices(length, (i) => <ThermometerItem key={equipment.state.thermometer[i].id} index={i} />), [length])

	return devices
})

export const CoverList = memo(() => {
	const { length } = useSnapshot(equipment.state.cover)

	const devices = useMemo(() => makeDevices(length, (i) => <CoverItem key={equipment.state.cover[i].id} index={i} />), [length])

	return devices
})

export const FlatPanelList = memo(() => {
	const { length } = useSnapshot(equipment.state.flatPanel)

	const devices = useMemo(() => makeDevices(length, (i) => <FlatPanelItem key={equipment.state.flatPanel[i].id} index={i} />), [length])

	return devices
})

export const DewHeaterList = memo(() => {
	const { length } = useSnapshot(equipment.state.dewHeater)

	const devices = useMemo(() => makeDevices(length, (i) => <DewHeaterItem key={equipment.state.dewHeater[i].id} index={i} />), [length])

	return devices
})

export const RotatorList = memo(() => {
	const { length } = useSnapshot(equipment.state.rotator)

	const devices = useMemo(() => makeDevices(length, (i) => <RotatorItem key={equipment.state.rotator[i].id} index={i} />), [length])

	return devices
})
