import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { CameraMolecule } from '@/molecules/indi/camera'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { useModal } from '@/shared/hooks'
import { ConnectButton } from './ConnectButton'

export function Camera() {
	const equipment = useMolecule(EquipmentMolecule)
	const camera = useMolecule(CameraMolecule)
	// biome-ignore format: too long
	const { camera: { connected }, connecting, capturing } = useSnapshot(camera.state)
	const modal = useModal(() => equipment.closeModal('CAMERA', camera.scope.camera))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[230px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-row gap-0'>
							<div className='flex flex-col gap-0'>
								<span>Camera</span>
								<span className='text-xs font-normal text-gray-400'>{camera.scope.camera.name}</span>
							</div>
							<div className='flex flex-row items-center gap-2 ml-auto'>
								<ConnectButton isConnected={connected} isLoading={connecting} />
							</div>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'></div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='danger' isDisabled={!capturing} onPointerUp={camera.stop} startContent={<Tabler.IconPlayerStopFilled />} variant='flat'>
								Stop
							</Button>
							<Button color='success' isLoading={capturing} onPointerUp={camera.start} startContent={<Lucide.Play />} variant='flat'>
								Start
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
