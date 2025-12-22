import { Checkbox, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSettingsMolecule } from '@/molecules/image/settings'
import { ChrominanceSubsamplingSelect } from './ChrominanceSubsamplingSelect'
import { Icons } from './Icon'
import { ImageFormatSelect } from './ImageFormatSelect'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageSettings = memo(() => {
	const settings = useMolecule(ImageSettingsMolecule)
	const { pixelated, format } = useSnapshot(settings.state)

	const Footer = <TextButton color='danger' label='Reset' onPointerUp={settings.reset} startContent={<Icons.Restore />} />

	return (
		<Modal footer={Footer} header='Settings' id={`settings-${settings.scope.image.key}`} maxWidth='200px' onHide={settings.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<ImageFormatSelect className='col-span-full' onValueChange={(value) => settings.update('format', value)} value={format} />
				<Activity mode={format === 'jpeg' ? 'visible' : 'hidden'}>
					<JpegFormatSettings />
				</Activity>
				<Checkbox isSelected={pixelated} onValueChange={(value) => settings.update('pixelated', value)}>
					Pixelated
				</Checkbox>
			</div>
		</Modal>
	)
})

const JpegFormatSettings = memo(() => {
	const settings = useMolecule(ImageSettingsMolecule)
	const { quality, chrominanceSubsampling } = useSnapshot(settings.state.formatOptions.jpeg)

	return (
		<div className='col-span-full flex flex-col gap-2'>
			<NumberInput label='Quality' maxValue={100} minValue={0} onValueChange={(value) => settings.updateFormatOptions('jpeg', 'quality', value)} size='sm' value={quality} />
			<ChrominanceSubsamplingSelect onValueChange={(value) => settings.updateFormatOptions('jpeg', 'chrominanceSubsampling', value)} value={chrominanceSubsampling} />
		</div>
	)
})
