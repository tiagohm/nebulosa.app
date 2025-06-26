import { Button, Checkbox, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSettingsMolecule } from '@/molecules/image/settings'
import { useModal } from '@/shared/hooks'
import { ImageFormatSelect } from './ImageFormatSelect'

export const ImageSettings = memo(() => {
	const settings = useMolecule(ImageSettingsMolecule)
	const { viewer } = settings
	const { pixelated } = useSnapshot(settings.state)
	const { info, transformation } = useSnapshot(viewer.state)
	const modal = useModal(() => viewer.closeModal('settings'))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[230px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-col gap-0'>
							<span>Settings</span>
							<span className='text-xs font-normal text-gray-400'>{info.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'>
								<ImageFormatSelect className='col-span-full' onValueChange={(value) => settings.updateFormat(value)} value={transformation.format} />
								<Checkbox isSelected={pixelated} onValueChange={(value) => settings.update('pixelated', value)}>
									Pixelated
								</Checkbox>
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='danger' onPointerUp={settings.reset} startContent={<Tabler.IconRestore />} variant='flat'>
								Reset
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
