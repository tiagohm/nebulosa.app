import { ImageViewerStoreContext } from '@shared/context'
import type { Image } from '@shared/types'
import { AnnotatedStars } from '@ui/AnnotatedStars'
import { CoordinateGrid } from '@ui/CoordinateGrid'
import { CoordinateOnMouse } from '@ui/CoordinateOnMouse'
import { Crosshair } from '@ui/Crosshair'
import { DetectedStars } from '@ui/DetectedStars'
import { Fov } from '@ui/Fov'
import { ImageInfo } from '@ui/ImageInfo'
import { ImageRoi } from '@ui/ImageRoi'
import { ImageToolBar } from '@ui/ImageToolBar'
import { Interactable } from '@ui/Interactable'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useContext, useEffect, useLayoutEffect, useRef } from 'react'

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
			void viewer.load() // First load, opens the image.path
		}
	}, [imgRef.current])

	return (
		<>
			<ImageToolBar />
			<ImageInfo />
			<Interactable onGesture={viewer.mouseCoordinate.handleGesture} onMouseMove={viewer.mouseCoordinate.handleMouseMove} onClick={viewer.mouseCoordinate.handleClick} onTap={viewer.select} ref={viewer.attachInteractable} zIndex={1}>
				<img className="image pointer-events-none max-w-none touch-none rounded-sm select-none" draggable={false} id={params.id} onLoad={viewer.handleLoad} ref={imgRef} />
				<InteractableOverlay />
			</Interactable>
		</>
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
		<ImageRoi />
	</>
))
