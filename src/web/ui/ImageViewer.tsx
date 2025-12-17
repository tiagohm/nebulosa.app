import { useMolecule } from 'bunshi/react'
import { Activity, memo, useCallback, useLayoutEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { AnnotatedStars } from './AnnotatedStars'
import { CoordinateOnMouse } from './CoordinateOnMouse'
import { Crosshair } from './Crosshair'
import { DetectedStars } from './DetectedStars'
import { FITSHeader } from './FITSHeader'
import { ImageAdjustment } from './ImageAdjustment'
import { ImageAnnotation } from './ImageAnnotation'
import { ImageFilter } from './ImageFilter'
import { ImageInfo } from './ImageInfo'
import { ImageSave } from './ImageSave'
import { ImageScnr } from './ImageScnr'
import { ImageSettings } from './ImageSettings'
import { ImageStatistics } from './ImageStatistics'
import { ImageStretch } from './ImageStretch'
import { ImageToolBar } from './ImageToolBar'
import { Interactable, type InteractableMethods, type InteractableProps } from './Interactable'
import { PlateSolver } from './PlateSolver'
import { StarDetection } from './StarDetection'

export const ImageViewer = memo(() => {
	const imgRef = useRef<HTMLImageElement>(null)
	const interactableRef = useRef<InteractableMethods>(null)
	const viewer = useMolecule(ImageViewerMolecule)
	const { image } = viewer.scope
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { starDetection, stretch, solver, fitsHeader, scnr, adjustment, filter, settings, annotation, save, mouseCoordinate, statistics } = useSnapshot(viewer.state)
	const { selected } = useSnapshot(workspace.state)

	useLayoutEffect(() => {
		if (imgRef.current) {
			viewer.attachImage(imgRef.current)
			workspace.link(image, viewer)
		}

		if (interactableRef.current) {
			viewer.attachInteractable(interactableRef.current)
		}

		return () => {
			viewer.detach()
		}
	}, [])

	const handleGesture = useCallback<Exclude<InteractableProps['onGesture'], undefined>>(({ scale, angle }) => {
		viewer.state.scale = scale
		viewer.state.angle = angle
	}, [])

	const handlePointerUp = useCallback<Exclude<InteractableProps['onPointerUp'], undefined>>(({ event, dragging, pinching }) => {
		if (!mouseCoordinate.visible || dragging || pinching) return
		viewer.handleInterpolatedCoordinate(event.offsetX, event.offsetY, true)
	}, [])

	const handleMouseMove = useCallback<Exclude<InteractableProps['onMouseMove'], undefined>>(({ event, dragging, pinching }) => {
		if (!mouseCoordinate.visible || dragging || pinching) return
		viewer.handleInterpolatedCoordinate(event.offsetX, event.offsetY, false)
	}, [])

	return (
		<>
			{selected?.key === image.key && <ImageToolBar />}
			{selected?.key === image.key && <ImageInfo />}
			<Interactable onGesture={handleGesture} onMouseMove={handleMouseMove} onPointerUp={handlePointerUp} onTap={viewer.select} ref={interactableRef} zIndex={image.position}>
				<img className='image select-none touch-none pointer-events-none max-w-none shadow-[0_0_80px_black]' draggable={false} id={image.key} onLoad={viewer.handleOnLoad} ref={imgRef} />
				<InteractableOverlay />
			</Interactable>
			{stretch.show && <ImageStretch />}
			{solver.show && <PlateSolver />}
			{scnr.show && <ImageScnr />}
			{adjustment.show && <ImageAdjustment />}
			{filter.show && <ImageFilter />}
			{starDetection.show && <StarDetection />}
			{fitsHeader.show && <FITSHeader />}
			{settings.show && <ImageSettings />}
			{annotation.show && <ImageAnnotation />}
			{save.show && <ImageSave />}
			{statistics.show && <ImageStatistics />}
		</>
	)
})

const InteractableOverlay = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { crosshair, starDetection, annotation, mouseCoordinate } = useSnapshot(viewer.state)

	return (
		<>
			<Activity mode={crosshair ? 'visible' : 'hidden'}>
				<Crosshair />
			</Activity>
			<Activity mode={starDetection.visible ? 'visible' : 'hidden'}>
				<DetectedStars />
			</Activity>
			<Activity mode={annotation.visible ? 'visible' : 'hidden'}>
				<AnnotatedStars />
			</Activity>
			<Activity mode={mouseCoordinate.visible ? 'visible' : 'hidden'}>
				<CoordinateOnMouse />
			</Activity>
		</>
	)
})
