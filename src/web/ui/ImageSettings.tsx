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
	const { pixelated, format } = useSnapshot(settings.state, { sync: true })

	const Footer = <TextButton color='danger' label='Reset' onPointerUp={settings.reset} startContent={<Icons.Restore />} />

	return (
		<Modal footer={Footer} header='Settings' id={`settings-${settings.scope.image.key}`} maxWidth='200px' onHide={settings.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<ImageFormatSelect className='col-span-full' onValueChange={settings.updateFormatType} value={format.type} />
				<Activity mode={format.type === 'jpeg' ? 'visible' : 'hidden'}>
					<JpegFormat />
				</Activity>
				<Checkbox isSelected={pixelated} onValueChange={(value) => settings.update('pixelated', value)}>
					Pixelated
				</Checkbox>
			</div>
		</Modal>
	)
})

const JpegFormat = memo(() => {
	const settings = useMolecule(ImageSettingsMolecule)
	const { quality, chrominanceSubsampling } = useSnapshot(settings.state.format.jpeg)

	return (
		<div className='col-span-full flex flex-col gap-2'>
			<NumberInput label='Quality' maxValue={100} minValue={0} onValueChange={(value) => settings.updateFormat('jpeg', 'quality', value)} size='sm' value={quality} />
			<ChrominanceSubsamplingSelect onValueChange={(value) => settings.updateFormat('jpeg', 'chrominanceSubsampling', value)} value={chrominanceSubsampling} />
		</div>
	)
})
