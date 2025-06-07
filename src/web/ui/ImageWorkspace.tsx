import { useRef } from 'react'
import type { Image } from './Home'
import { ImageViewer } from './ImageViewer'

export interface ImageWorkspaceProps {
	readonly images: Readonly<Image>[]
	readonly onClose?: (image: Image) => void
}

export function ImageWorkspace({ images, onClose }: ImageWorkspaceProps) {
	const owner = useRef<HTMLDivElement>(null)

	function handleImageViewerPointerUp(e: React.PointerEvent<HTMLImageElement>) {
		const target = (e.target as HTMLImageElement).closest('div.wrapper') as HTMLDivElement
		const wrappers = owner.current?.querySelectorAll('div.wrapper') ?? []
		const newZIndex = wrappers.length - 1

		// Already at the top, no need to change z-index
		if (parseInt(target.style.zIndex) === newZIndex) {
			return
		}

		// Find the wrapper with the same z-index as newZIndex
		// and set it to the z-index of the clicked image viewer
		// and bring the clicked image viewer to the front
		// by setting its z-index to newZIndex
		for (const wrapper of wrappers) {
			const div = wrapper as HTMLDivElement
			const zIndex = parseInt(div.style.zIndex)

			if (zIndex === newZIndex) {
				// Bring the clicked image viewer to the front
				div.style.zIndex = target.style.zIndex
				target.style.zIndex = newZIndex.toFixed(0)
				break
			}
		}
	}

	function handleClose(image: Image) {
		onClose?.(image)
	}

	return (
		<div ref={owner} className='relative h-full w-full'>
			{images.map((image) => (
				<ImageViewer key={image.key} image={image} owner={owner.current!} onPointerUp={handleImageViewerPointerUp} onClose={() => handleClose(image)} />
			))}
		</div>
	)
}
