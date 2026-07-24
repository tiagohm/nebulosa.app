import { homeStore } from '@stores/home.store'
import { IconButton } from '@ui/components/IconButton'
import { Popover } from '@ui/components/Popover'
import type { PopoverMethods } from '@ui/components/Popover'
import { FilePicker } from '@ui/FilePicker'
import { Icons } from '@ui/Icon'
import { memo, useRef } from 'react'

const IMAGE_FILE_FILTER = '*.{fits,fit,xisf}'

export const ImagePickerButton = memo(() => {
	const popoverRef = useRef<PopoverMethods | null>(null)

	function handleChoose(paths: string[] = []) {
		if (paths.length > 0) {
			for (const path of paths) {
				homeStore.addImage(path, 'file')
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
