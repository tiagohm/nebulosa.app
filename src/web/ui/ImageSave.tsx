import { Checkbox } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSaveMolecule } from '@/molecules/image/save'
import { FilePickerInput } from './FilePickerInput'
import { Icons } from './Icon'
import { ImageFormatButtonGroup } from './ImageFormatButtonGroup'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageSave = memo(() => {
	const save = useMolecule(ImageSaveMolecule)

	return (
		<Modal footer={<Footer />} header='Save' id={`save-${save.viewer.storageKey}`} maxWidth='288px' onHide={save.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const save = useMolecule(ImageSaveMolecule)
	const { format, transformed } = useSnapshot(save.state)
	const { path } = useSnapshot(save.state, { sync: true })

	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<FilePickerInput className='col-span-full' id={`save-${save.viewer.storageKey}`} isReadOnly={false} mode='save' onValueChange={save.updatePath} placeholder='Path' size='md' value={path} />
			<ImageFormatButtonGroup onValueChange={(value) => save.update('format', value)} value={format} />
			<Checkbox className='col-span-full' isSelected={transformed} onValueChange={(value) => save.update('transformed', value)}>
				Apply transformation
			</Checkbox>
		</div>
	)
})

const Footer = memo(() => {
	const save = useMolecule(ImageSaveMolecule)
	const { loading } = useSnapshot(save.state)
	const { path } = useSnapshot(save.state)

	return (
		<>
			<TextButton color='primary' isLoading={loading} label='Download' onPointerUp={save.download} startContent={<Icons.ArrowDown />} />
			<TextButton color='success' isDisabled={!path} isLoading={loading} label='Save' onPointerUp={save.save} startContent={<Icons.Save />} />
		</>
	)
})
