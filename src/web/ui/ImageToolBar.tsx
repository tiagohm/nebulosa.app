import { Popover, PopoverContent, PopoverTrigger, Slider, Switch, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageAdjustmentMolecule } from '@/molecules/image/adjustment'
import { ImageAnnotationMolecule } from '@/molecules/image/annotation'
import { ImageCalibrationMolecule } from '@/molecules/image/calibration'
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
import { DEFAULT_POPOVER_PROPS } from '@/shared/constants'
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
				<IconButton color='secondary' icon={Icons.Save} onPointerUp={save.show} tooltipContent='Save' tooltipPlacement='top' variant='flat' />
				<IconButton color='secondary' icon={Icons.Sigma} onPointerUp={solver.show} tooltipContent='Plate Solver' tooltipPlacement='top' variant='flat' />
				<IconButton color='secondary' icon={Icons.Tune} onPointerUp={stretch.show} tooltipContent='Stretch' tooltipPlacement='top' variant='flat' />
				<Tooltip content='Auto Stretch' placement='top' showArrow>
					<ToggleButton color='primary' icon={Icons.WandSparkles} isSelected={transformation.stretch.auto} onPointerUp={stretch.toggle} />
				</Tooltip>
				<Activity mode={info?.metadata.bayer ? 'visible' : 'hidden'}>
					<Tooltip content='Debayer' placement='top' showArrow>
						<ToggleButton color='primary' icon={Icons.Grid} isSelected={transformation.debayer} onPointerUp={viewer.toggleDebayer} />
					</Tooltip>
				</Activity>
				<RotatePopover />
				<TransformationPopover />
				<OverlayPopover />
				<IconButton color='secondary' icon={Icons.Histogram} onPointerUp={statistics.show} tooltipContent='Statistics' tooltipPlacement='top' variant='flat' />
				<IconButton color='secondary' icon={Icons.Text} onPointerUp={header.show} tooltipContent='FITS Header' tooltipPlacement='top' variant='flat' />
				<IconButton color='secondary' icon={Icons.Cog} onPointerUp={settings.show} tooltipContent='Settings' tooltipPlacement='top' variant='flat' />
				<IconButton className='ms-2' color='danger' icon={Icons.Close} onPointerUp={viewer.remove} tooltipContent='Close' tooltipPlacement='top' variant='solid' />
			</div>
		</div>
	)
})

const RotatePopover = memo(() => {
	return (
		<Popover {...DEFAULT_POPOVER_PROPS}>
			<Tooltip content='Rotate' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton color='success' icon={Icons.RotateRight} variant='flat' />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<RotatePopoverContent />
			</PopoverContent>
		</Popover>
	)
})

const RotatePopoverContent = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { angle } = useSnapshot(viewer.state)

	return (
		<div className='min-w-110 flex flex-row items-center justify-center gap-2 p-2'>
			<span className='font-bold'>{angle.toFixed(1)}°</span>
			<Slider className='flex-1' disableThumbScale maxValue={359.9} minValue={0} onChange={(value) => viewer.rotateTo(value as number)} step={0.1} value={angle} />
			<IconButton color='primary' icon={Icons.RotateLeft} onPointerUp={viewer.rotateLeft} tooltipContent='Rotate Left' tooltipPlacement='top' variant='flat' />
			<IconButton color='primary' icon={Icons.RotateRight} onPointerUp={viewer.rotateRight} tooltipContent='Rotate Right' tooltipPlacement='top' variant='flat' />
			<IconButton color='danger' icon={Icons.Restore} onPointerUp={viewer.rotateToZero} tooltipContent='Reset' tooltipPlacement='top' variant='flat' />
		</div>
	)
})

const OverlayPopover = memo(() => {
	return (
		<Popover {...DEFAULT_POPOVER_PROPS}>
			<Tooltip content='Overlay' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton color='success' icon={Icons.BringToFront} variant='flat' />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<OverlayPopoverContent />
			</PopoverContent>
		</Popover>
	)
})

const OverlayPopoverContent = memo(() => {
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
		<div className='flex flex-row justify-center items-start gap-2 p-2'>
			<Tooltip content='Crosshair' placement='top' showArrow>
				<ToggleButton color='primary' icon={Icons.Crosshair} isSelected={crosshair} onPointerUp={viewer.toggleCrosshair} />
			</Tooltip>
			<div className='flex flex-col gap-2 justify-center'>
				<IconButton color='secondary' disabled={!solution} icon={Icons.Pen} onPointerUp={annotation.show} tooltipContent='Annotation' tooltipPlacement='top' variant='flat' />
				<Activity mode={annotatedStars.length > 0 ? 'visible' : 'hidden'}>
					<Switch isSelected={isAnnotatedStarsVisible} onValueChange={annotation.toggle} size='sm' />
				</Activity>
			</div>
			<div className='flex flex-col gap-2 justify-center'>
				<IconButton color='secondary' icon={Icons.Stars} onPointerUp={starDetection.show} tooltipContent='Star Detection' tooltipPlacement='top' variant='flat' />
				<Activity mode={detectedStars.length > 0 ? 'visible' : 'hidden'}>
					<Switch isSelected={isDetectedStarsVisible} onValueChange={starDetection.toggle} size='sm' />
				</Activity>
			</div>
			<IconButton color='secondary' icon={Icons.Box} tooltipContent='ROI' tooltipPlacement='top' variant='flat' />
			<Activity mode={solution?.scale ? 'visible' : 'hidden'}>
				<IconButton color='secondary' icon={Icons.FocusField} onPointerUp={fov.show} tooltipContent='FOV' tooltipPlacement='top' variant='flat' />
				<Tooltip content='Mouse Coordinate' placement='top' showArrow>
					<ToggleButton color='primary' icon={Icons.MousePointerClick} isSelected={isMouseCoordinateVisible} onPointerUp={mouseCoordinate.toggle} />
				</Tooltip>
			</Activity>
		</div>
	)
})

const TransformationPopover = memo(() => {
	return (
		<Popover {...DEFAULT_POPOVER_PROPS}>
			<Tooltip content='Transformation' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton color='success' icon={Icons.Palette} variant='flat' />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<TransformationPopoverContent />
			</PopoverContent>
		</Popover>
	)
})

const TransformationPopoverContent = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const scnr = useMolecule(ImageScnrMolecule)
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const filter = useMolecule(ImageFilterMolecule)
	const calibration = useMolecule(ImageCalibrationMolecule)
	const { transformation, info } = useSnapshot(viewer.state)

	return (
		<div className='flex flex-row items-center justify-center gap-2 p-2'>
			<IconButton color='secondary' icon={Icons.Image} onPointerUp={calibration.show} tooltipContent='Calibration' tooltipPlacement='top' variant='flat' />
			<Activity mode={info && !info.mono ? 'visible' : 'hidden'}>
				<IconButton color='secondary' icon={Icons.Swatch} onPointerUp={scnr.show} tooltipContent='SCNR' tooltipPlacement='top' variant='flat' />
			</Activity>
			<IconButton color='secondary' icon={Icons.ImageEdit} onPointerUp={adjustment.show} tooltipContent='Adjustment' tooltipPlacement='top' variant='flat' />
			<IconButton color='secondary' icon={Icons.Brush} onPointerUp={filter.show} tooltipContent='Filter' tooltipPlacement='top' variant='flat' />
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
	)
})
