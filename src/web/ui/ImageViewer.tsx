import { ScopeProvider, useMolecule } from 'bunshi/react'
import { memo, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { ModalScope } from '@/molecules/modal'
import { Crosshair } from './Crosshair'
import { DetectedStars } from './DetectedStars'
import { FITSHeader } from './FITSHeader'
import { ImageAdjustment } from './ImageAdjustment'
import { ImageFilter } from './ImageFilter'
import { ImageInfo } from './ImageInfo'
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
	const { crosshair, starDetection, stretch, plateSolver, fitsHeader, scnr, adjustment, filter, settings } = useSnapshot(viewer.state)
	const { selected } = useSnapshot(workspace.state)

	useEffect(() => {
		if (ref.current) {
			viewer.load(false, ref.current)
			viewer.select()
		}

		return () => {
			viewer.detach()
		}
	}, [ref.current])

	function handleGesture({ scale }: InteractTransform) {
		viewer.state.scale = scale
	}

	return (
		<>
			{selected?.key === image.key && <ImageToolBar />}
			{selected?.key === image.key && <ImageInfo />}
			<Interactable onGesture={handleGesture} onTap={() => viewer.select()} zIndex={image.index}>
				<img className='image select-none touch-none pointer-events-none max-w-none shadow-[0_0_80px_black]' draggable={false} id={image.key} onContextMenu={(e) => e.preventDefault()} ref={ref} />
				{crosshair && <Crosshair />}
				{starDetection.show && <DetectedStars />}
			</Interactable>
			{/* <div className='inline-block absolute wrapper' style={{ zIndex: image.index }}></div> */}
			{stretch.showModal && (
				<ScopeProvider scope={ModalScope} value={{ name: `stretch-${image.key}` }}>
					<ImageStretch />
				</ScopeProvider>
			)}
			{plateSolver.showModal && (
				<ScopeProvider scope={ModalScope} value={{ name: `plate-solver-${image.key}` }}>
					<PlateSolver />
				</ScopeProvider>
			)}
			{scnr.showModal && (
				<ScopeProvider scope={ModalScope} value={{ name: `scnr-${image.key}` }}>
					<ImageScnr />
				</ScopeProvider>
			)}
			{adjustment.showModal && (
				<ScopeProvider scope={ModalScope} value={{ name: `adjustment-${image.key}` }}>
					<ImageAdjustment />
				</ScopeProvider>
			)}
			{filter.showModal && (
				<ScopeProvider scope={ModalScope} value={{ name: `filter-${image.key}` }}>
					<ImageFilter />
				</ScopeProvider>
			)}
			{starDetection.showModal && (
				<ScopeProvider scope={ModalScope} value={{ name: `star-detection-${image.key}` }}>
					<StarDetection />
				</ScopeProvider>
			)}
			{fitsHeader.showModal && (
				<ScopeProvider scope={ModalScope} value={{ name: `fits-header-${image.key}` }}>
					<FITSHeader />
				</ScopeProvider>
			)}
			{settings.showModal && (
				<ScopeProvider scope={ModalScope} value={{ name: `fits-header-${image.key}` }}>
					<ImageSettings />
				</ScopeProvider>
			)}
		</>
	)
})
