import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSaveMolecule } from '@/molecules/image/save'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { FilePickerInput } from './FilePickerInput'
import { Icons } from './Icon'
import { ImageFormatButtonGroup } from './ImageFormatButtonGroup'
import { Modal } from './Modal'

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
			<FilePickerInput className='col-span-full' id={`save-${save.viewer.storageKey}`} mode='save' onValueChange={save.updatePath} placeholder='Path' readOnly={false} size='md' value={path} />
			<ImageFormatButtonGroup className='col-span-full' onValueChange={(value) => save.update('format', value)} value={format} />
			<Checkbox className='col-span-full' label='Apply transformation' onValueChange={(value) => save.update('transformed', value)} value={transformed} />
		</div>
	)
})

const Footer = memo(() => {
	const save = useMolecule(ImageSaveMolecule)
	const { loading, path } = useSnapshot(save.state)

	return (
		<>
			<Button color='primary' label='Download' loading={loading} onPointerUp={save.download} startContent={<Icons.ArrowDown />} />
			<Button color='success' disabled={!path} label='Save' loading={loading} onPointerUp={save.save} startContent={<Icons.Save />} />
		</>
	)
})
