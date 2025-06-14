import { useDraggableModal } from '@/shared/hooks'
import { ImageViewerMolecule, ImageWorkspaceMolecule } from '@/shared/molecules'
import { useMolecule } from 'bunshi/react'
import { useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { Crosshair } from './Crosshair'
import { DetectedStars } from './DetectedStars'
import { FITSHeader } from './FITSHeader'
import { ImageToolbar, type ImageToolbarButtonType } from './ImageToolbar'
import { StarDetection } from './StarDetection'

export function ImageViewer() {
	const ref = useRef<HTMLImageElement>(null)
	const viewer = useMolecule(ImageViewerMolecule)
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { crosshair, starDetection } = useSnapshot(viewer.state)
	const { image } = viewer.scope
	const { selected } = useSnapshot(workspace.state)

	const starDetectionModal = useDraggableModal()
	const fitsHeaderModal = useDraggableModal()

	useEffect(() => {
		if (ref.current) {
			viewer.load(false, ref.current)
			viewer.select(ref.current)
		}

		return () => {
			viewer.detach()
		}
	}, [ref])

	function handleImageToolbarButtonPress(type: ImageToolbarButtonType) {
		if (type === 'fits-header') fitsHeaderModal.show()
		else if (type === 'star-detection') starDetectionModal.show()
	}

	return (
		<>
			{selected?.key === image.key && <ImageToolbar onButtonPress={handleImageToolbarButtonPress} className='w-full fixed bottom-0 mb-1 p-1 z-[99999]' />}
			<div className='inline-block absolute wrapper' style={{ zIndex: image.index }}>
				<img ref={ref} id={image.key} onLoad={(e) => viewer.attach(e.currentTarget)} className='image select-none shadow-md max-w-none border-dashed border-white' onPointerUp={(e) => viewer.select(e.currentTarget)} />
				{crosshair && <Crosshair />}
				{starDetection.show && <DetectedStars rotation={0} stars={starDetection.stars} />}
			</div>
			<StarDetection draggable={starDetectionModal} />
			<FITSHeader draggable={fitsHeaderModal} />
		</>
	)
}
