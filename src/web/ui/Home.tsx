import { ScopeProvider, useMolecule } from 'bunshi/react'
import { useSnapshot } from 'valtio'
import { ConfirmationMolecule } from '@/molecules/confirmation'
import { CameraScope } from '@/molecules/indi/camera'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { ModalScope } from '@/molecules/modal'
import { WebSocketMolecule } from '@/molecules/ws'
import { Camera } from './Camera'
import { Confirmation } from './Confirmation'
import { HomeNavBar } from './HomeNavBar'
import { ImageWorkspace } from './ImageWorkspace'

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
			{devices.CAMERA.map(
				(camera) =>
					camera.show && (
						<ScopeProvider key={camera.name} scope={ModalScope} value={{ name: `camera-${camera.name}` }}>
							<ScopeProvider scope={CameraScope} value={{ camera: camera as never }}>
								<Camera />
							</ScopeProvider>
						</ScopeProvider>
					),
			)}
			{showConfirmation && (
				<ScopeProvider scope={ModalScope} value={{ name: 'confirmation' }}>
					<Confirmation />
				</ScopeProvider>
			)}
		</div>
	)
}
