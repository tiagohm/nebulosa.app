import { useDraggableModal } from '@/shared/hooks'
import { ImageViewerMolecule, ImageWorkspaceMolecule } from '@/shared/molecules'
import { stopPropagation } from '@/shared/utils'
import { Spacer, Switch, cn } from '@heroui/react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@radix-ui/react-context-menu'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { Crosshair } from './Crosshair'
import { DetectedStars } from './DetectedStars'
import { FITSHeader } from './FITSHeader'
import { StarDetection } from './StarDetection'

export function ImageViewer() {
	const ref = useRef<HTMLImageElement>(null)
	const viewer = useMolecule(ImageViewerMolecule)
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { crosshair, transformation, starDetection } = useSnapshot(viewer.state)
	const { image } = viewer.scope

	const starDetectionModal = useDraggableModal()
	const fitsHeaderModal = useDraggableModal()

	useEffect(() => {
		if (ref.current) viewer.load(false, ref.current)

		return () => {
			viewer.detach()
		}
	}, [ref])

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger className='block' onContextMenu={(e) => console.info(e, e.nativeEvent.offsetX)}>
					<div className='inline-block absolute wrapper' style={{ zIndex: image.index }}>
						<img ref={ref} id={image.key} onLoad={(e) => viewer.attach(e.currentTarget)} className='image select-none shadow-md max-w-none border-dashed border-white' onPointerUp={(e) => viewer.bringToFront(e.currentTarget)} />
						{crosshair && <Crosshair />}
						{starDetection.show && <DetectedStars rotation={0} stars={starDetection.stars} />}
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem>
						<Lucide.Save size={16} /> Save...
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem>
						<Lucide.Sigma size={16} /> Plate Solver
					</ContextMenuItem>
					<ContextMenuItem>
						<Lucide.ChartColumnDecreasing size={16} /> Stretch
					</ContextMenuItem>
					<ContextMenuItem className={cn({ selected: transformation.stretch.auto })} onPointerUp={() => viewer.toggleAutoStretch()}>
						<Lucide.WandSparkles size={16} /> Auto Stretch
					</ContextMenuItem>
					<ContextMenuItem>
						<Lucide.Blend size={16} /> SCNR
					</ContextMenuItem>
					<ContextMenuItem className={cn({ selected: transformation.debayer })} onPointerUp={() => viewer.toggleDebayer()}>
						<Lucide.Grid3X3 size={16} /> Debayer
					</ContextMenuItem>
					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<Lucide.Palette size={16} /> Transformation
							<Lucide.ChevronRight size={16} />
						</ContextMenuSubTrigger>
						<ContextMenuPortal>
							<ContextMenuSubContent>
								<ContextMenuItem>
									<Lucide.Palette size={16} /> Adjustment
								</ContextMenuItem>
								<ContextMenuItem className={cn({ selected: transformation.horizontalMirror })} onPointerUp={() => viewer.toggleHorizontalMirror()}>
									<Lucide.FlipHorizontal size={16} /> Horizontal Mirror
								</ContextMenuItem>
								<ContextMenuItem className={cn({ selected: transformation.verticalMirror })} onPointerUp={() => viewer.toggleVerticalMirror()}>
									<Lucide.FlipVertical size={16} /> Vertical Mirror
								</ContextMenuItem>
								<ContextMenuItem className={cn({ selected: transformation.invert })} onPointerUp={() => viewer.toggleInvert()}>
									<Lucide.Image size={16} /> Invert
								</ContextMenuItem>
								<ContextMenuItem>
									<Lucide.RotateCw size={16} /> Rotate
								</ContextMenuItem>
							</ContextMenuSubContent>
						</ContextMenuPortal>
					</ContextMenuSub>
					<ContextMenuSeparator />
					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<Lucide.BringToFront size={16} /> Overlay
							<Lucide.ChevronRight size={16} />
						</ContextMenuSubTrigger>
						<ContextMenuPortal>
							<ContextMenuSubContent>
								<ContextMenuItem className={cn({ selected: crosshair })} onPointerUp={() => viewer.toggleCrosshair()}>
									<Lucide.Crosshair size={16} /> Crosshair
								</ContextMenuItem>
								<ContextMenuItem>
									<Lucide.Pen size={16} /> Annotation
									<Spacer className='flex-1' />
									<Switch size='sm' className='flex-1' onPointerUp={stopPropagation} />
								</ContextMenuItem>
								<ContextMenuItem onPointerUp={starDetectionModal.show}>
									<Lucide.Stars size={16} /> Star Detection
									<Spacer className='flex-1' />
									<Switch size='sm' className='flex-1' isDisabled={starDetection.stars.length === 0} isSelected={starDetection.show} onPointerUp={stopPropagation} onValueChange={(value) => viewer.toggleDetectedStars(value)} />
								</ContextMenuItem>
								<ContextMenuItem>
									<Lucide.Crop size={16} /> ROI
									<Spacer className='flex-1' />
									<Switch size='sm' className='flex-1' onPointerUp={stopPropagation} />
								</ContextMenuItem>
								<ContextMenuItem>
									<Lucide.Scan size={16} /> FOV
									<Spacer className='flex-1' />
									<Switch size='sm' className='flex-1' onPointerUp={stopPropagation} />
								</ContextMenuItem>
							</ContextMenuSubContent>
						</ContextMenuPortal>
					</ContextMenuSub>
					<ContextMenuItem>
						<Lucide.ChartNoAxesColumnIncreasing size={16} /> Statistics
					</ContextMenuItem>
					<ContextMenuItem onPointerUp={fitsHeaderModal.show}>
						<Lucide.List size={16} /> FITS Header
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem>
						<Lucide.Telescope size={16} /> Point mount here
					</ContextMenuItem>
					<ContextMenuItem>
						<Lucide.Frame size={16} /> Frame at this coordinate
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem className='danger' onPointerUp={() => viewer.remove(image)}>
						<Lucide.X size={16} /> Close
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<StarDetection draggable={starDetectionModal} />
			<FITSHeader draggable={fitsHeaderModal} />
		</>
	)
}
