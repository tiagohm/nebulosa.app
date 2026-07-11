import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { ImageViewerStoreContext } from '../shared/context'
import type { Image } from '../shared/types'
import { AnnotatedStars } from './AnnotatedStars'
import { CoordinateGrid } from './CoordinateGrid'
import { CoordinateOnMouse } from './CoordinateOnMouse'
import { Crosshair } from './Crosshair'
import { DetectedStars } from './DetectedStars'
import { Fov } from './Fov'
import { ImageInfo } from './ImageInfo'
import { ImageRoi } from './ImageRoi'
import { ImageToolBar } from './ImageToolBar'
import { Interactable } from './Interactable'

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
