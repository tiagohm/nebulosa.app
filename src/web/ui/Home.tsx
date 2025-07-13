import { ScopeProvider, useMolecule } from 'bunshi/react'
import { useSnapshot } from 'valtio'
import { ConfirmationMolecule } from '@/molecules/confirmation'
import { CameraScope } from '@/molecules/indi/camera'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { MountScope } from '@/molecules/indi/mount'
import { WebSocketMolecule } from '@/molecules/ws'
import { Camera } from './Camera'
import { Confirmation } from './Confirmation'
import { HomeNavBar } from './HomeNavBar'
import { ImageWorkspace } from './ImageWorkspace'
import { Mount } from './Mount'

export default function Home() {
	const webSocket = useMolecule(WebSocketMolecule)

	const equipment = useMolecule(EquipmentMolecule)
	const devices = useSnapshot(equipment.state)

	const confirmation = useMolecule(ConfirmationMolecule)
	const { show: showConfirmation } = useSnapshot(confirmation.state)

	return (
		<div className='w-full h-full flex flex-col'>
			<HomeNavBar />
			<ImageWorkspace />
			{devices.camera.map(
				(camera) =>
					camera.show && (
						<ScopeProvider key={camera.name} scope={CameraScope} value={{ camera: camera as never }}>
							<Camera />
						</ScopeProvider>
					),
			)}
			{devices.mount.map(
				(mount) =>
					mount.show && (
						<ScopeProvider key={mount.name} scope={MountScope} value={{ mount: mount as never }}>
							<Mount />
						</ScopeProvider>
					),
			)}
			{showConfirmation && <Confirmation />}
		</div>
	)
}
