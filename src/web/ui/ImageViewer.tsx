import { ImageViewerStoreContext } from '@shared/context'
import { AnnotatedStars } from '@ui/AnnotatedStars'
import { CoordinateGrid } from '@ui/CoordinateGrid'
import { CoordinateOnMouse } from '@ui/CoordinateOnMouse'
import { Crosshair } from '@ui/Crosshair'
import { DetectedStars } from '@ui/DetectedStars'
import { Fov } from '@ui/Fov'
import { ImageInfo } from '@ui/ImageInfo'
import { Interactable } from '@ui/Interactable'
import { Roi } from '@ui/Roi'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useContext, useEffect, useLayoutEffect, useRef } from 'react'
import type { Image } from 'src/types/image'

export const ImageViewer = memo(({ params }: IDockviewPanelProps<Image>) => {
	const imgRef = useRef<HTMLImageElement>(null)
	const viewer = useContext(ImageViewerStoreContext)

	// Attaches the image element before the first paint so interactions can bind to it.
	useLayoutEffect(() => {
		if (imgRef.current) {
			viewer.attachImage(imgRef.current)
		}

		return viewer.detach
	}, [imgRef.current])

	// Loads after layout so the image node is already available.
	useEffect(() => {
		if (imgRef.current) {
			void viewer.load()
		}
	}, [imgRef.current])

	return (
		<div className="relative h-full w-full overflow-hidden">
			<ImageInfo />
			<Interactable className="z-1" onGesture={viewer.mouseCoordinate.handleGesture} onMouseMove={viewer.mouseCoordinate.handleMouseMove} onClick={viewer.mouseCoordinate.handleClick} onTap={viewer.select} ref={viewer.attachInteractable}>
				<img className="image pointer-events-none max-w-none touch-none rounded-sm select-none" draggable={false} id={params.id} onLoad={viewer.handleLoad} ref={imgRef} />
				<InteractableOverlay />
			</Interactable>
		</div>
	)
})

const InteractableOverlay = memo(() => (
	<>
		<CoordinateGrid />
		<Crosshair />
		<DetectedStars />
		<AnnotatedStars />
		<CoordinateOnMouse />
		<Fov />
		<Roi />
	</>
))
