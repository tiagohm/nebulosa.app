import { ScopeProvider, useMolecule } from 'bunshi/react'
import { useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule, ImageWorkspaceMolecule, ModalScope } from '@/shared/molecules'
import { Crosshair } from './Crosshair'
import { DetectedStars } from './DetectedStars'
import { FITSHeader } from './FITSHeader'
import { ImageAdjustment } from './ImageAdjustment'
import { ImageFilter } from './ImageFilter'
import { ImageScnr } from './ImageScnr'
import { ImageStretch } from './ImageStretch'
import { ImageToolbar } from './ImageToolbar'
import { PlateSolver } from './PlateSolver'
import { StarDetection } from './StarDetection'

export function ImageViewer() {
	const ref = useRef<HTMLImageElement>(null)
	const viewer = useMolecule(ImageViewerMolecule)
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { crosshair, starDetection, stretch, plateSolver, fitsHeader, scnr, adjustment, filter } = useSnapshot(viewer.state)
	const { image } = viewer.scope
	const { selected } = useSnapshot(workspace.state)

	useEffect(() => {
		if (ref.current) {
			viewer.load(false, ref.current)
			viewer.select(ref.current)
		}

		return () => {
			viewer.detach()
		}
	}, [ref.current])

	return (
		<>
			{selected?.key === image.key && <ImageToolbar className='w-full fixed bottom-0 mb-1 p-1 z-[99999]' />}
			<div className='inline-block absolute wrapper' style={{ zIndex: image.index }}>
				<img className='image select-none shadow-md max-w-none border-dashed border-white' id={image.key} onLoad={(e) => viewer.attach(e.currentTarget)} onPointerUp={(e) => viewer.select(e.currentTarget)} ref={ref} />
				{crosshair && <Crosshair />}
				{starDetection.show && <DetectedStars rotation={0} stars={starDetection.stars} />}
			</div>
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
		</>
	)
}
