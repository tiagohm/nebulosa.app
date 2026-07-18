import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { FilePickerInput } from '@ui/FilePickerInput'
import { Icons } from '@ui/Icon'
import { ImageFormatButtonGroup } from '@ui/ImageFormatButtonGroup'
import { memo, useContext, useEffect } from 'react'
import { ImageViewerStoreContext } from 'src/web/shared/context'
import { useSnapshot } from 'valtio'

export const ImageSave = memo(() => {
	const { save } = useContext(ImageViewerStoreContext)
	const { format, loading, path, transformed } = useSnapshot(save.state)

	useEffect(save.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<FilePickerInput fullWidth className="col-span-full min-w-0" disabled={loading} id={`save-${save.viewer.key}`} mode="save" onValueChange={save.setPath} placeholder="Path" size="md" value={path} />
			<ImageFormatButtonGroup fullWidth className="col-span-full min-w-0" disabled={loading} onValueChange={(value) => save.update('format', value)} value={format} />
			<Checkbox className="col-span-full min-w-0" disabled={loading} label="Apply transformation" onValueChange={(value) => save.update('transformed', value)} value={transformed} />
			<Footer />
		</div>
	)
})

const Footer = memo(() => {
	const { save } = useContext(ImageViewerStoreContext)
	const { loading, path } = useSnapshot(save.state)
	const canSave = path.trim().length > 0

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="primary" label="Download" loading={loading} onClick={save.download} startContent={<Icons.ArrowDown />} />
			<Button color="success" disabled={!canSave} label="Save" loading={loading} onClick={save.save} startContent={<Icons.Save />} />
		</div>
	)
})
