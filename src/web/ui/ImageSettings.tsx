import { Checkbox } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSettingsMolecule } from '@/molecules/image/settings'
import { Icons } from './Icon'
import { ImageFormatSelect } from './ImageFormatSelect'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageSettings = memo(() => {
	const settings = useMolecule(ImageSettingsMolecule)
	const { viewer } = settings
	const { pixelated } = useSnapshot(settings.state)
	const { transformation } = useSnapshot(viewer.state)

	const Footer = <TextButton color='danger' label='Reset' onPointerUp={settings.reset} startContent={<Icons.Restore />} />

	return (
		<Modal footer={Footer} header='Settings' maxWidth='200px' name={`settings-${settings.scope.image.key}`} onHide={settings.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<ImageFormatSelect className='col-span-full' onValueChange={settings.updateFormat} value={transformation.format} />
				<Checkbox isSelected={pixelated} onValueChange={(value) => settings.update('pixelated', value)}>
					Pixelated
				</Checkbox>
			</div>
		</Modal>
	)
})
