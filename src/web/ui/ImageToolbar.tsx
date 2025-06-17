import { Button, Popover, PopoverContent, PopoverTrigger, Switch, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { useDraggableModal } from '@/shared/hooks'
import { ImageViewerMolecule } from '@/shared/molecules'
import { FITSHeader } from './FITSHeader'
import { PlateSolver } from './PlateSolver'
import { SCNR } from './SCNR'
import { StarDetection } from './StarDetection'
import { Stretch } from './Stretch'
import { ToggleButton } from './ToggleButton'

export type ImageToolbarButtonType = 'stretch' | 'scnr' | 'plate-solver' | 'fits-header' | 'star-detection'

export interface ImageToolbarProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ImageToolbar(props: ImageToolbarProps) {
	const viewer = useMolecule(ImageViewerMolecule)
	const { transformation, crosshair, info, starDetection } = useSnapshot(viewer.state)
	const { image } = viewer.scope

	const stretchModal = useDraggableModal({ name: `stretch-${image.key}` })
	const scnrModal = useDraggableModal({ name: `scnr-${image.key}` })
	const plateSolverModal = useDraggableModal({ name: `plate-solver-${image.key}` })
	const starDetectionModal = useDraggableModal({ name: `star-detection-${image.key}` })
	const fitsHeaderModal = useDraggableModal({ name: `fits-header-${image.key}` })

	return (
		<>
			<div {...props}>
				<div className='flex flex-row items-center justify-center gap-2 p-2 mx-auto w-fit rounded-xl bg-black/20'>
					<Tooltip content='Save' placement='top'>
						<Button color='secondary' isIconOnly variant='flat'>
							<Lucide.Save />
						</Button>
					</Tooltip>
					<Tooltip content='Plate Solver' placement='top'>
						<Button color='secondary' isIconOnly onPointerUp={() => plateSolverModal.show()} variant='flat'>
							<Lucide.Sigma />
						</Button>
					</Tooltip>
					<Tooltip content='Stretch' placement='top'>
						<Button color='secondary' isIconOnly onPointerUp={() => stretchModal.show()} variant='flat'>
							<Lucide.SquareDashedKanban transform='rotate(180)' />
						</Button>
					</Tooltip>
					<Tooltip content='Auto Stretch' placement='top'>
						<ToggleButton color='primary' isSelected={transformation.stretch.auto} onPointerUp={() => viewer.toggleAutoStretch()}>
							<Lucide.WandSparkles />
						</ToggleButton>
					</Tooltip>
					{!info?.mono && (
						<Tooltip content='SCNR' placement='top'>
							<Button color='secondary' isIconOnly onPointerUp={() => scnrModal.show()} variant='flat'>
								<Lucide.Blend />
							</Button>
						</Tooltip>
					)}
					{info?.metadata.bayer && info?.metadata.channels === 1 && (
						<Tooltip content='Debayer' placement='top'>
							<ToggleButton color='primary' isSelected={transformation.debayer} onPointerUp={() => viewer.toggleDebayer()}>
								<Lucide.Grid3X3 />
							</ToggleButton>
						</Tooltip>
					)}
					<Tooltip content='Rotate' placement='top'>
						<Button color='secondary' isIconOnly variant='flat'>
							<Lucide.RotateCw />
						</Button>
					</Tooltip>
					<Popover placement='bottom' showArrow>
						<PopoverTrigger>
							<Button color='success' isIconOnly variant='flat'>
								<Lucide.Palette />
							</Button>
						</PopoverTrigger>
						<PopoverContent>
							<div className='flex flex-row items-center justify-center gap-2 p-2'>
								<Tooltip content='Adjustment' placement='top'>
									<Button color='secondary' isIconOnly variant='flat'>
										<Lucide.Wand />
									</Button>
								</Tooltip>
								<Tooltip content='Horizontal mirror' placement='top'>
									<ToggleButton color='primary' isSelected={transformation.horizontalMirror} onPointerUp={() => viewer.toggleHorizontalMirror()}>
										<Lucide.FlipHorizontal />
									</ToggleButton>
								</Tooltip>
								<Tooltip content='Vertical Mirror' placement='top'>
									<ToggleButton color='primary' isSelected={transformation.verticalMirror} onPointerUp={() => viewer.toggleVerticalMirror()}>
										<Lucide.FlipVertical />
									</ToggleButton>
								</Tooltip>
								<Tooltip content='Invert' placement='top'>
									<ToggleButton color='primary' isSelected={transformation.invert} onPointerUp={() => viewer.toggleInvert()}>
										<Lucide.Image />
									</ToggleButton>
								</Tooltip>
							</div>
						</PopoverContent>
					</Popover>
					<Popover placement='bottom' showArrow>
						<PopoverTrigger>
							<Button color='success' isIconOnly variant='flat'>
								<Lucide.BringToFront />
							</Button>
						</PopoverTrigger>
						<PopoverContent>
							<div className='flex flex-row justify-center items-start gap-2 p-2'>
								<Tooltip content='Crosshair' placement='top'>
									<ToggleButton color='primary' isSelected={crosshair} onPointerUp={() => viewer.toggleCrosshair()}>
										<Lucide.Crosshair />
									</ToggleButton>
								</Tooltip>
								<Tooltip content='Annotatation' placement='top'>
									<Button color='secondary' isIconOnly variant='flat'>
										<Lucide.Pen />
									</Button>
								</Tooltip>
								<div className='flex flex-col gap-2 justify-center'>
									<Tooltip content='Star Detection' placement='top'>
										<Button color='secondary' isIconOnly onPress={() => starDetectionModal.show()} variant='flat'>
											<Lucide.Stars />
										</Button>
									</Tooltip>
									{starDetection.stars.length > 0 && <Switch isSelected={starDetection.show} onValueChange={(value) => (viewer.state.starDetection.show = value)} size='sm' />}
								</div>
								<Tooltip content='ROI' placement='top'>
									<Button color='secondary' isIconOnly variant='flat'>
										<Lucide.Crop />
									</Button>
								</Tooltip>
								<Tooltip content='FOV' placement='top'>
									<Button color='secondary' isIconOnly variant='flat'>
										<Lucide.Scan />
									</Button>
								</Tooltip>
							</div>
						</PopoverContent>
					</Popover>
					<Tooltip content='Statistics' placement='top'>
						<Button color='secondary' isIconOnly variant='flat'>
							<Lucide.ChartNoAxesColumnIncreasing />
						</Button>
					</Tooltip>
					<Tooltip content='FITS Header' placement='top'>
						<Button color='secondary' isIconOnly onPress={() => fitsHeaderModal.show()} variant='flat'>
							<Lucide.List />
						</Button>
					</Tooltip>
					<Tooltip content='Mouse Coordinate' placement='top'>
						<Button color='secondary' isIconOnly variant='flat'>
							<Lucide.MousePointerClick />
						</Button>
					</Tooltip>
					<Tooltip content='Close' placement='top'>
						<Button className='ms-2' color='danger' isIconOnly onPointerUp={() => viewer.remove()} variant='solid'>
							<Lucide.X />
						</Button>
					</Tooltip>
				</div>
			</div>
			{stretchModal.isOpen && <Stretch draggable={stretchModal} />}
			{plateSolverModal.isOpen && <PlateSolver draggable={plateSolverModal} />}
			{scnrModal.isOpen && <SCNR draggable={scnrModal} />}
			{starDetectionModal.isOpen && <StarDetection draggable={starDetectionModal} />}
			{fitsHeaderModal.isOpen && <FITSHeader draggable={fitsHeaderModal} />}
		</>
	)
}
