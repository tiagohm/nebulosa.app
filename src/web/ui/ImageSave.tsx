import { ButtonGroup, Checkbox } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSaveMolecule } from '@/molecules/image/save'
import { FilePickerInput } from './FilePickerInput'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageSave = memo(() => {
	const save = useMolecule(ImageSaveMolecule)
	const { loading, format, transformed } = useSnapshot(save.state)
	const { path } = useSnapshot(save.state, { sync: true })

	const Footer = (
		<>
			<TextButton color='primary' isLoading={loading} label='Download' onPointerUp={save.download} startContent={<Icons.ArrowDown />} />
			<TextButton color='success' isDisabled={!path} isLoading={loading} label='Save' onPointerUp={save.save} startContent={<Icons.Save />} />
		</>
	)

	return (
		<Modal footer={Footer} header='Save' id={`save-${save.viewer.storageKey}`} maxWidth='288px' onHide={save.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<FilePickerInput className='col-span-full' id={`save-${save.viewer.storageKey}`} isReadOnly={false} mode='save' onValueChange={(value) => value !== undefined && save.update('path', value)} placeholder='Path' size='md' value={path} />
				<ButtonGroup className='col-span-full'>
					<TextButton color='secondary' label='FITS' onPointerUp={() => save.update('format', 'fits')} size='sm' variant={format === 'fits' ? 'flat' : 'light'} />
					<TextButton color='secondary' label='XISF' onPointerUp={() => save.update('format', 'xisf')} size='sm' variant={format === 'xisf' ? 'flat' : 'light'} />
					<TextButton color='secondary' label='JPEG' onPointerUp={() => save.update('format', 'jpeg')} size='sm' variant={format === 'jpeg' ? 'flat' : 'light'} />
				</ButtonGroup>
				<Checkbox className='col-span-full' isSelected={transformed} onValueChange={(value) => save.update('transformed', value)}>
					Apply transformation
				</Checkbox>
			</div>
		</Modal>
	)
})
