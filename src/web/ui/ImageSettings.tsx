import { Button, Checkbox } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSettingsMolecule } from '@/molecules/image/settings'
import { Icons } from './Icon'
import { ImageFormatSelect } from './ImageFormatSelect'
import { Modal } from './Modal'

export const ImageSettings = memo(() => {
	const settings = useMolecule(ImageSettingsMolecule)
	const { viewer } = settings
	const { pixelated } = useSnapshot(settings.state)
	const { info, transformation } = useSnapshot(viewer.state)

	return (
		<Modal
			footer={
				<Button color='danger' onPointerUp={settings.reset} startContent={<Icons.Restore />} variant='flat'>
					Reset
				</Button>
			}
			header={
				<div className='w-full flex flex-col justify-center gap-0'>
					<span>Settings</span>
					<span className='text-xs font-normal text-gray-400 max-w-full'>{info.originalPath}</span>
				</div>
			}
			maxWidth='200px'
			name={`settings-${settings.scope.image.key}`}
			onClose={() => viewer.close('settings')}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<ImageFormatSelect className='col-span-full' onValueChange={(value) => settings.updateFormat(value)} value={transformation.format} />
				<Checkbox isSelected={pixelated} onValueChange={(value) => settings.update('pixelated', value)}>
					Pixelated
				</Checkbox>
			</div>
		</Modal>
	)
})
