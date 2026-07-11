import { memo, useRef } from 'react'
import { workspaceStore } from '../stores/workspace.store'
import { IconButton } from './components/IconButton'
import { Popover, type PopoverMethods } from './components/Popover'
import { FilePicker } from './FilePicker'
import { Icons } from './Icon'

const IMAGE_FILE_FILTER = '*.{fits,fit,xisf}'

export const ImagePickerButton = memo(() => {
	const popoverRef = useRef<PopoverMethods | null>(null)

	function handleChoose(paths: string[] = []) {
		if (paths.length > 0) {
			for (const path of paths) {
				workspaceStore.addImage(path, 'file')
			}
		}

		popoverRef.current?.hide()
	}

	return (
		<Popover ref={popoverRef} trigger={<IconButton color="secondary" icon={Icons.ImagePlus} onClick={() => popoverRef.current?.show()} tooltipContent="Open Image" variant="ghost" />}>
			<FilePicker title="Open Image" onChoose={handleChoose} filter={IMAGE_FILE_FILTER} multiple />
		</Popover>
	)
})
