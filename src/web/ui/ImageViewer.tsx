import { useMolecule } from 'bunshi/react'
import { memo, useLayoutEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { AnnotatedStars } from './AnnotatedStars'
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
import { ImageStretch } from './ImageStretch'
import { ImageToolBar } from './ImageToolBar'
import { Interactable, type InteractTransform } from './Interactable'
import { PlateSolver } from './PlateSolver'
import { StarDetection } from './StarDetection'

export const ImageViewer = memo(() => {
	const ref = useRef<HTMLImageElement>(null)
	const viewer = useMolecule(ImageViewerMolecule)
	const { image } = viewer.scope
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { crosshair, starDetection, stretch, solver, fitsHeader, scnr, adjustment, filter, settings, annotation, save } = useSnapshot(viewer.state)
	const { selected } = useSnapshot(workspace.state)

	useLayoutEffect(() => {
		if (ref.current) {
			viewer.attach(ref.current)
			workspace.link(image, viewer)
		}

		return () => {
			viewer.detach()
		}
	}, [])

	function handleGesture({ scale }: InteractTransform) {
		viewer.state.scale = scale
	}

	return (
		<>
			{selected?.key === image.key && <ImageToolBar />}
			{selected?.key === image.key && <ImageInfo />}
			<Interactable onGesture={handleGesture} onTap={viewer.select} zIndex={image.position}>
				<img className='image select-none touch-none pointer-events-none max-w-none shadow-[0_0_80px_black]' draggable={false} id={image.key} onContextMenu={(e) => e.preventDefault()} ref={ref} />
				{crosshair && <Crosshair />}
				{starDetection.visible && <DetectedStars />}
				{annotation.visible && <AnnotatedStars />}
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
		</>
	)
})
