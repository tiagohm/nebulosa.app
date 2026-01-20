import { Popover, PopoverContent, PopoverTrigger, Slider, Switch, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageAdjustmentMolecule } from '@/molecules/image/adjustment'
import { ImageAnnotationMolecule } from '@/molecules/image/annotation'
import { ImageFilterMolecule } from '@/molecules/image/filter'
import { ImageFovMolecule } from '@/molecules/image/fov'
import { ImageHeaderMolecule } from '@/molecules/image/header'
import { ImageMouseCoordinateMolecule } from '@/molecules/image/mousecoordinate'
import { ImageSaveMolecule } from '@/molecules/image/save'
import { ImageScnrMolecule } from '@/molecules/image/scnr'
import { ImageSettingsMolecule } from '@/molecules/image/settings'
import { ImageSolverMolecule } from '@/molecules/image/solver'
import { StarDetectionMolecule } from '@/molecules/image/stardetection'
import { ImageStatisticsMolecule } from '@/molecules/image/statistics'
import { ImageStretchMolecule } from '@/molecules/image/stretch'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { ToggleButton } from './ToggleButton'

export const ImageToolBar = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { transformation, info } = useSnapshot(viewer.state)

	const save = useMolecule(ImageSaveMolecule)
	const solver = useMolecule(ImageSolverMolecule)
	const stretch = useMolecule(ImageStretchMolecule)
	const settings = useMolecule(ImageSettingsMolecule)
	const statistics = useMolecule(ImageStatisticsMolecule)
	const header = useMolecule(ImageHeaderMolecule)

	return (
		<div className='pointer-events-none w-full fixed bottom-0 mb-1 p-1 z-99999'>
			<div className='pointer-events-auto flex flex-row items-center justify-start gap-2 px-2 py-1.5 mx-auto w-fit rounded-xl bg-black max-w-full overflow-scroll no-scrollbar'>
				<Tooltip content='Save' placement='top' showArrow>
					<IconButton color='secondary' icon={Icons.Save} onPointerUp={save.show} variant='flat' />
				</Tooltip>
				<Tooltip content='Plate Solver' placement='top' showArrow>
					<IconButton color='secondary' icon={Icons.Sigma} onPointerUp={solver.show} variant='flat' />
				</Tooltip>
				<Tooltip content='Stretch' placement='top' showArrow>
					<IconButton color='secondary' icon={Icons.Tune} onPointerUp={stretch.show} variant='flat' />
				</Tooltip>
				<Tooltip content='Auto Stretch' placement='top' showArrow>
					<ToggleButton color='primary' icon={Icons.WandSparkles} isSelected={transformation.stretch.auto} onPointerUp={stretch.toggle} />
				</Tooltip>
				{info?.metadata.bayer && info.metadata.bayer && (
					<Tooltip content='Debayer' placement='top' showArrow>
						<ToggleButton color='primary' icon={Icons.Grid} isSelected={transformation.debayer} onPointerUp={viewer.toggleDebayer} />
					</Tooltip>
				)}
				<RotatePopover />
				<TransformationPopover />
				<OverlayPopover />
				<Tooltip content='Statistics' placement='top' showArrow>
					<IconButton color='secondary' icon={Icons.Histogram} onPointerUp={statistics.show} variant='flat' />
				</Tooltip>
				<Tooltip content='FITS Header' placement='top' showArrow>
					<IconButton color='secondary' icon={Icons.Text} onPointerUp={header.show} variant='flat' />
				</Tooltip>
				<Tooltip content='Settings' placement='top' showArrow>
					<IconButton color='secondary' icon={Icons.Cog} onPointerUp={settings.show} variant='flat' />
				</Tooltip>
				<Tooltip content='Close' placement='top' showArrow>
					<IconButton className='ms-2' color='danger' icon={Icons.Close} onPointerUp={viewer.remove} variant='solid' />
				</Tooltip>
			</div>
		</div>
	)
})

const RotatePopover = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { angle } = useSnapshot(viewer.state)

	return (
		<Popover placement='bottom' showArrow>
			<Tooltip content='Rotate' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton color='success' icon={Icons.RotateRight} variant='flat' />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<div className='min-w-110 flex flex-row items-center justify-center gap-2 p-2'>
					<span className='font-bold'>{angle.toFixed(1)}°</span>
					<Slider className='flex-1' disableThumbScale maxValue={359.9} minValue={0} onChange={(value) => viewer.rotateTo(value as number)} step={0.1} value={angle} />
					<Tooltip content='Rotate Left' placement='top'>
						<IconButton color='primary' icon={Icons.RotateLeft} onPointerUp={viewer.rotateLeft} variant='flat' />
					</Tooltip>
					<Tooltip content='Rotate Right' placement='top'>
						<IconButton color='primary' icon={Icons.RotateRight} onPointerUp={viewer.rotateRight} variant='flat' />
					</Tooltip>
					<Tooltip content='Reset' placement='top'>
						<IconButton color='danger' icon={Icons.Restore} onPointerUp={viewer.rotateToZero} variant='flat' />
					</Tooltip>
				</div>
			</PopoverContent>
		</Popover>
	)
})

const OverlayPopover = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { crosshair } = useSnapshot(viewer.state)

	const starDetection = useMolecule(StarDetectionMolecule)
	const { stars: detectedStars, visible: isDetectedStarsVisible } = useSnapshot(starDetection.state)

	const annotation = useMolecule(ImageAnnotationMolecule)
	const { stars: annotatedStars, visible: isAnnotatedStarsVisible } = useSnapshot(annotation.state)

	const solver = useMolecule(ImageSolverMolecule)
	const { solution } = useSnapshot(solver.state)

	const fov = useMolecule(ImageFovMolecule)

	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)
	const { visible: isMouseCoordinateVisible } = useSnapshot(mouseCoordinate.state)

	return (
		<Popover placement='bottom' showArrow>
			<Tooltip content='Overlay' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton color='success' icon={Icons.BringToFront} variant='flat' />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<div className='flex flex-row justify-center items-start gap-2 p-2'>
					<Tooltip content='Crosshair' placement='top' showArrow>
						<ToggleButton color='primary' icon={Icons.Crosshair} isSelected={crosshair} onPointerUp={viewer.toggleCrosshair} />
					</Tooltip>
					<div className='flex flex-col gap-2 justify-center'>
						<Tooltip content='Annotation' placement='top' showArrow>
							<IconButton color='secondary' icon={Icons.Pen} isDisabled={!solution} onPointerUp={annotation.show} variant='flat' />
						</Tooltip>
						{annotatedStars.length > 0 && <Switch isSelected={isAnnotatedStarsVisible} onValueChange={annotation.toggle} size='sm' />}
					</div>
					<div className='flex flex-col gap-2 justify-center'>
						<Tooltip content='Star Detection' placement='top' showArrow>
							<IconButton color='secondary' icon={Icons.Stars} onPointerUp={starDetection.show} variant='flat' />
						</Tooltip>
						{detectedStars.length > 0 && <Switch isSelected={isDetectedStarsVisible} onValueChange={starDetection.toggle} size='sm' />}
					</div>
					<Tooltip content='ROI' placement='top' showArrow>
						<IconButton color='secondary' icon={Icons.Box} variant='flat' />
					</Tooltip>
					<Activity mode={solution?.scale ? 'visible' : 'hidden'}>
						<Tooltip content='FOV' placement='top' showArrow>
							<IconButton color='secondary' icon={Icons.FocusField} onPointerUp={fov.show} variant='flat' />
						</Tooltip>
						<Tooltip content='Mouse Coordinate' placement='top' showArrow>
							<ToggleButton color='primary' icon={Icons.MousePointerClick} isSelected={isMouseCoordinateVisible} onPointerUp={mouseCoordinate.toggle} />
						</Tooltip>
					</Activity>
				</div>
			</PopoverContent>
		</Popover>
	)
})

const TransformationPopover = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const scnr = useMolecule(ImageScnrMolecule)
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const filter = useMolecule(ImageFilterMolecule)
	const { transformation, info } = useSnapshot(viewer.state)

	return (
		<Popover placement='bottom' showArrow>
			<Tooltip content='Transformation' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton color='success' icon={Icons.Palette} variant='flat' />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<div className='flex flex-row items-center justify-center gap-2 p-2'>
					{info && !info.mono && (
						<Tooltip content='SCNR' placement='top' showArrow>
							<IconButton color='secondary' icon={Icons.Swatch} onPointerUp={scnr.show} variant='flat' />
						</Tooltip>
					)}
					<Tooltip content='Adjustment' placement='top' showArrow>
						<IconButton color='secondary' icon={Icons.ImageEdit} onPointerUp={adjustment.show} variant='flat' />
					</Tooltip>
					<Tooltip content='Filter' placement='top' showArrow>
						<IconButton color='secondary' icon={Icons.Brush} onPointerUp={filter.show} variant='flat' />
					</Tooltip>
					<Tooltip content='Horizontal mirror' placement='top' showArrow>
						<ToggleButton color='primary' icon={Icons.FlipHorizontal} isSelected={transformation.horizontalMirror} onPointerUp={viewer.toggleHorizontalMirror} />
					</Tooltip>
					<Tooltip content='Vertical Mirror' placement='top' showArrow>
						<ToggleButton color='primary' icon={Icons.FlipVertical} isSelected={transformation.verticalMirror} onPointerUp={viewer.toggleVerticalMirror} />
					</Tooltip>
					<Tooltip content='Invert' placement='top' showArrow>
						<ToggleButton color='primary' icon={Icons.InvertColor} isSelected={transformation.invert} onPointerUp={viewer.toggleInvert} />
					</Tooltip>
				</div>
			</PopoverContent>
		</Popover>
	)
})
