import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { FilePickerInput } from './FilePickerInput'
import { Icons } from './Icon'
import { ImageFormatButtonGroup } from './ImageFormatButtonGroup'
import { Modal } from './Modal'

function hasSavePath(path: string) {
	return path.trim().length > 0
}

export const ImageSave = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { save } = viewer
	const { show } = useSnapshot(save.state)

	if (!show) return null

	return (
		<Modal footer={<Footer />} header="Save" id={`save-${viewer.image.id}`} initialWidth="288px" onHide={save.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const { save } = useContext(ImageViewerStoreContext)
	const { format, loading, path, transformed } = useSnapshot(save.state)

	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<FilePickerInput fullWidth className="col-span-full min-w-0" disabled={loading} id={`save-${save.viewer.key}`} mode="save" onValueChange={save.setPath} placeholder="Path" size="md" value={path} />
			<ImageFormatButtonGroup fullWidth className="col-span-full min-w-0" disabled={loading} onValueChange={(value) => save.update('format', value)} value={format} />
			<Checkbox className="col-span-full min-w-0" disabled={loading} label="Apply transformation" onValueChange={(value) => save.update('transformed', value)} value={transformed} />
		</div>
	)
})

const Footer = memo(() => {
	const { save } = useContext(ImageViewerStoreContext)
	const { loading, path } = useSnapshot(save.state)
	const canSave = hasSavePath(path)

	return (
		<>
			<Button color="primary" label="Download" loading={loading} onClick={save.download} startContent={<Icons.ArrowDown />} />
			<Button color="success" disabled={!canSave} label="Save" loading={loading} onClick={save.save} startContent={<Icons.Save />} />
		</>
	)
})
