import { ScopeProvider, useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { CameraScope } from '@/molecules/indi/camera'
import { CoverScope } from '@/molecules/indi/cover'
import { DewHeaterScope } from '@/molecules/indi/dewheater'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { FlatPanelScope } from '@/molecules/indi/flatpanel'
import { FocuserScope } from '@/molecules/indi/focuser'
import { GuideOutputScope } from '@/molecules/indi/guideoutput'
import { MountScope } from '@/molecules/indi/mount'
import { RotatorScope } from '@/molecules/indi/rotator'
import { ThermometerScope } from '@/molecules/indi/thermometer'
import { WheelScope } from '@/molecules/indi/wheel'
import { WebSocketMolecule } from '@/molecules/ws'
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
	const webSocket = useMolecule(WebSocketMolecule)

	return (
		<div className='w-full h-full flex flex-col'>
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

export const CameraList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const camera = useSnapshot(equipment.state.CAMERA)

	return camera.map((camera) => (
		<Activity key={camera.name} mode={camera.show ? 'visible' : 'hidden'}>
			<ScopeProvider scope={CameraScope} value={{ camera }}>
				<Camera />
			</ScopeProvider>
		</Activity>
	))
})

export const MountList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const mount = useSnapshot(equipment.state.MOUNT)

	return mount.map((mount) => (
		<Activity key={mount.name} mode={mount.show ? 'visible' : 'hidden'}>
			<ScopeProvider key={mount.name} scope={MountScope} value={{ mount }}>
				<Mount />
			</ScopeProvider>
		</Activity>
	))
})

export const FocuserList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const focuser = useSnapshot(equipment.state.FOCUSER)

	return focuser.map((focuser) => (
		<Activity key={focuser.name} mode={focuser.show ? 'visible' : 'hidden'}>
			<ScopeProvider key={focuser.name} scope={FocuserScope} value={{ focuser }}>
				<Focuser />
			</ScopeProvider>
		</Activity>
	))
})

export const WheelList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const wheel = useSnapshot(equipment.state.WHEEL)

	return wheel.map((wheel) => (
		<Activity key={wheel.name} mode={wheel.show ? 'visible' : 'hidden'}>
			<ScopeProvider scope={WheelScope} value={{ wheel }}>
				<Wheel />
			</ScopeProvider>
		</Activity>
	))
})

export const GuideOutputList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const guideOutput = useSnapshot(equipment.state.GUIDE_OUTPUT)

	return guideOutput.map((guideOutput) => (
		<Activity key={guideOutput.name} mode={guideOutput.show ? 'visible' : 'hidden'}>
			<ScopeProvider scope={GuideOutputScope} value={{ guideOutput }}>
				<GuideOutput />
			</ScopeProvider>
		</Activity>
	))
})

export const ThermometerList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const thermometer = useSnapshot(equipment.state.THERMOMETER)

	return thermometer.map((thermometer) => (
		<Activity key={thermometer.name} mode={thermometer.show ? 'visible' : 'hidden'}>
			<ScopeProvider scope={ThermometerScope} value={{ thermometer }}>
				<Thermometer />
			</ScopeProvider>
		</Activity>
	))
})

export const CoverList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const cover = useSnapshot(equipment.state.COVER)

	return cover.map((cover) => (
		<Activity key={cover.name} mode={cover.show ? 'visible' : 'hidden'}>
			<ScopeProvider scope={CoverScope} value={{ cover }}>
				<Cover />
			</ScopeProvider>
		</Activity>
	))
})

export const FlatPanelList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const flatPanel = useSnapshot(equipment.state.FLAT_PANEL)

	return flatPanel.map((flatPanel) => (
		<Activity key={flatPanel.name} mode={flatPanel.show ? 'visible' : 'hidden'}>
			<ScopeProvider scope={FlatPanelScope} value={{ flatPanel }}>
				<FlatPanel />
			</ScopeProvider>
		</Activity>
	))
})

export const DewHeaterList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const dewHeater = useSnapshot(equipment.state.DEW_HEATER)

	return dewHeater.map((dewHeater) => (
		<Activity key={dewHeater.name} mode={dewHeater.show ? 'visible' : 'hidden'}>
			<ScopeProvider scope={DewHeaterScope} value={{ dewHeater }}>
				<DewHeater />
			</ScopeProvider>
		</Activity>
	))
})

export const RotatorList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const rotator = useSnapshot(equipment.state.ROTATOR)

	return rotator.map((rotator) => (
		<Activity key={rotator.name} mode={rotator.show ? 'visible' : 'hidden'}>
			<ScopeProvider scope={RotatorScope} value={{ rotator }}>
				<Rotator />
			</ScopeProvider>
		</Activity>
	))
})
