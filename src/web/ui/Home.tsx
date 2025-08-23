import { ScopeProvider, useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConfirmationMolecule } from '@/molecules/confirmation'
import { CameraScope } from '@/molecules/indi/camera'
import { CoverScope } from '@/molecules/indi/cover'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { GuideOutputScope } from '@/molecules/indi/guideoutput'
import { MountScope } from '@/molecules/indi/mount'
import { ThermometerScope } from '@/molecules/indi/thermometer'
import { WebSocketMolecule } from '@/molecules/ws'
import { Camera } from './Camera'
import { Confirmation } from './Confirmation'
import { Cover } from './Cover'
import { GuideOutput } from './GuideOutput'
import { HomeNavBar } from './HomeNavBar'
import { ImageWorkspace } from './ImageWorkspace'
import { Mount } from './Mount'
import { Thermometer } from './Thermometer'

export const Home = memo(() => {
	const webSocket = useMolecule(WebSocketMolecule)

	const confirmation = useMolecule(ConfirmationMolecule)
	const { show: showConfirmation } = useSnapshot(confirmation.state)

	return (
		<div className='w-full h-full flex flex-col'>
			<HomeNavBar />
			<ImageWorkspace />
			<CameraList />
			<MountList />
			<ThermometerList />
			<GuideOutputList />
			<CoverList />
			{showConfirmation && <Confirmation />}
		</div>
	)
})

export const CameraList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const { camera } = useSnapshot(equipment.state.devices)

	return camera.map(
		(camera) =>
			camera.show && (
				<ScopeProvider key={camera.name} scope={CameraScope} value={{ camera: camera as never }}>
					<Camera />
				</ScopeProvider>
			),
	)
})

export const MountList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const { mount } = useSnapshot(equipment.state.devices)

	return mount.map(
		(mount) =>
			mount.show && (
				<ScopeProvider key={mount.name} scope={MountScope} value={{ mount: mount as never }}>
					<Mount />
				</ScopeProvider>
			),
	)
})

export const GuideOutputList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const { guideOutput } = useSnapshot(equipment.state.devices)

	return guideOutput.map(
		(guideOutput) =>
			guideOutput.show && (
				<ScopeProvider key={guideOutput.name} scope={GuideOutputScope} value={{ guideOutput: guideOutput as never }}>
					<GuideOutput />
				</ScopeProvider>
			),
	)
})

export const ThermometerList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const { thermometer } = useSnapshot(equipment.state.devices)

	return thermometer.map(
		(thermometer) =>
			thermometer.show && (
				<ScopeProvider key={thermometer.name} scope={ThermometerScope} value={{ thermometer: thermometer as never }}>
					<Thermometer />
				</ScopeProvider>
			),
	)
})

export const CoverList = memo(() => {
	const equipment = useMolecule(EquipmentMolecule)
	const { cover } = useSnapshot(equipment.state.devices)

	return cover.map(
		(cover) =>
			cover.show && (
				<ScopeProvider key={cover.name} scope={CoverScope} value={{ cover: cover as never }}>
					<Cover />
				</ScopeProvider>
			),
	)
})
