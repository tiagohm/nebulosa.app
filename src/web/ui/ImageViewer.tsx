import { memo, useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { imageViewerStore } from '@/stores/image.viewer.store'
import { imageWorkspaceStore } from '@/stores/image.workspace.store'
import { useStore } from '../hooks/store.hook'
import { ImageContext, ImageViewerStoreContext } from '../shared/context'
import { AnnotatedStars } from './AnnotatedStars'
import { CoordinateGrid } from './CoordinateGrid'
import { CoordinateOnMouse } from './CoordinateOnMouse'
import { Crosshair } from './Crosshair'
import { DetectedStars } from './DetectedStars'
import { Fov } from './Fov'
import { ImageAdjustment } from './ImageAdjustment'
import { ImageAnnotation } from './ImageAnnotation'
import { ImageCalibration } from './ImageCalibration'
import { ImageFilter } from './ImageFilter'
import { ImageFov } from './ImageFov'
import { ImageHeader } from './ImageHeader'
import { ImageInfo } from './ImageInfo'
import { ImageRoi } from './ImageRoi'
import { ImageSave } from './ImageSave'
import { ImageScnr } from './ImageScnr'
import { ImageSettings } from './ImageSettings'
import { ImageSolver } from './ImageSolver'
import { ImageStarDetection } from './ImageStarDetection'
import { ImageStatistics } from './ImageStatistics'
import { ImageStretch } from './ImageStretch'
import { ImageToolBar } from './ImageToolBar'
import { Interactable } from './Interactable'

export const ImageViewer = memo(() => {
	const imgRef = useRef<HTMLImageElement>(null)
	const image = useContext(ImageContext)
	const viewer = useStore(() => imageViewerStore(image), [image])

	// Attaches the image element before the first paint so interactions can bind to it.
	useLayoutEffect(() => {
		if (imgRef.current) {
			viewer.attachImage(imgRef.current)
			imageWorkspaceStore.link(image, viewer)
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
		<ImageViewerStoreContext value={viewer}>
			<ImageToolBar />
			<ImageInfo />
			<Interactable onGesture={viewer.mouseCoordinate.handleGesture} onMouseMove={viewer.mouseCoordinate.handleMouseMove} onClick={viewer.mouseCoordinate.handleClick} onTap={viewer.select} ref={viewer.attachInteractable} zIndex={image.position}>
				<img className="image pointer-events-none max-w-none touch-none rounded-sm outline-8 outline-black/25 outline-solid select-none" draggable={false} id={image.id} onLoad={viewer.handleLoad} ref={imgRef} />
				<InteractableOverlay />
			</Interactable>
			<ImageStretch />
			<ImageSolver />
			<ImageScnr />
			<ImageAdjustment />
			<ImageFilter />
			<ImageCalibration />
			<ImageStarDetection />
			<ImageHeader />
			<ImageSettings />
			<ImageAnnotation />
			<ImageSave />
			<ImageStatistics />
			<ImageFov />
		</ImageViewerStoreContext>
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
