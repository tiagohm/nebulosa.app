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
import { IconButton } from './components/IconButton'
import { Popover } from './components/Popover'
import { Slider } from './components/Slider'
import { Switch } from './components/Switch'
import { ToggleButton } from './components/ToggleButton'
import { Icons } from './Icon'

const TOOLTIP_PLACEMENT = 'top'
const POPOVER_PANEL_CLASS = 'max-w-[calc(100vw-1rem)] overflow-x-auto'

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
		<div className="pointer-events-none fixed bottom-0 z-99999 mb-1 w-full p-1">
			<div className="no-scrollbar pointer-events-auto mx-auto flex w-fit max-w-full flex-row items-center justify-start gap-2 overflow-x-auto overflow-y-hidden rounded-xl bg-black px-2 py-1.5">
				<IconButton color="secondary" icon={Icons.Save} onClick={save.show} tooltipContent="Save" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
				<IconButton color="secondary" icon={Icons.Sigma} onClick={solver.show} tooltipContent="Plate Solver" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
				<IconButton color="secondary" icon={Icons.Tune} onClick={stretch.show} tooltipContent="Stretch" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
				<ToggleButton color="primary" icon={Icons.WandSparkles} onClick={stretch.toggle} tooltipContent="Auto Stretch" tooltipPlacement={TOOLTIP_PLACEMENT} value={transformation.stretch.auto} />
				<Activity mode={info?.metadata.bayer ? 'visible' : 'hidden'}>
					<ToggleButton color="primary" icon={Icons.Grid} onClick={viewer.toggleDebayer} tooltipContent="Debayer" tooltipPlacement={TOOLTIP_PLACEMENT} value={transformation.debayer} />
				</Activity>
				<RotatePopover />
				<TransformationPopover />
				<OverlayPopover />
				<IconButton color="secondary" icon={Icons.Histogram} onClick={statistics.show} tooltipContent="Statistics" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
				<IconButton color="secondary" icon={Icons.Text} onClick={header.show} tooltipContent="FITS Header" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
				<IconButton color="secondary" icon={Icons.Cog} onClick={settings.show} tooltipContent="Settings" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
				<IconButton className="ms-2" color="danger" icon={Icons.Close} onClick={viewer.remove} tooltipContent="Close" tooltipPlacement={TOOLTIP_PLACEMENT} variant="solid" />
			</div>
		</div>
	)
})

const RotatePopover = memo(() => (
	<Popover placement={TOOLTIP_PLACEMENT} trigger={<IconButton color="success" icon={Icons.RotateRight} tooltipContent="Rotate" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />}>
		<RotatePopoverContent />
	</Popover>
))

const RotatePopoverContent = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { angle } = useSnapshot(viewer.state)

	return (
		<div className={`${POPOVER_PANEL_CLASS} flex w-110 min-w-0 flex-row items-center justify-center gap-2 p-2`}>
			<span className="w-12 shrink-0 text-center font-bold">{angle.toFixed(1)}°</span>
			<Slider className="min-w-38 flex-1" maxValue={359.9} minValue={0} onValueChange={viewer.rotateTo} step={0.1} value={angle} />
			<IconButton color="primary" icon={Icons.RotateLeft} onClick={viewer.rotateLeft} tooltipContent="Rotate Left" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
			<IconButton color="primary" icon={Icons.RotateRight} onClick={viewer.rotateRight} tooltipContent="Rotate Right" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
			<IconButton color="danger" icon={Icons.Restore} onClick={viewer.rotateToZero} tooltipContent="Reset" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
		</div>
	)
})

const OverlayPopover = memo(() => (
	<Popover placement={TOOLTIP_PLACEMENT} trigger={<IconButton color="success" icon={Icons.BringToFront} tooltipContent="Overlay" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />}>
		<OverlayPopoverContent />
	</Popover>
))

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
	const hasAnnotatedStars = annotatedStars.length > 0
	const hasDetectedStars = detectedStars.length > 0
	const hasSolvedScale = solution?.scale !== undefined && Number.isFinite(solution.scale) && solution.scale > 0

	return (
		<div className={`${POPOVER_PANEL_CLASS} flex flex-row items-start justify-center gap-2 p-2`}>
			<ToggleButton color="primary" icon={Icons.Crosshair} onClick={viewer.toggleCrosshair} tooltipContent="Crosshair" tooltipPlacement={TOOLTIP_PLACEMENT} value={crosshair} />
			<div className="flex flex-col justify-center gap-2">
				<IconButton color="secondary" disabled={!solution} icon={Icons.Pen} onClick={annotation.show} tooltipContent="Annotation" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
				<Activity mode={hasAnnotatedStars ? 'visible' : 'hidden'}>
					<Switch onValueChange={annotation.toggle} value={isAnnotatedStarsVisible} />
				</Activity>
			</div>
			<div className="flex flex-col justify-center gap-2">
				<IconButton color="secondary" icon={Icons.Stars} onClick={starDetection.show} tooltipContent="Star Detection" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
				<Activity mode={hasDetectedStars ? 'visible' : 'hidden'}>
					<Switch onValueChange={starDetection.toggle} value={isDetectedStarsVisible} />
				</Activity>
			</div>
			<IconButton color="secondary" disabled icon={Icons.Box} tooltipContent="ROI" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
			<Activity mode={hasSolvedScale ? 'visible' : 'hidden'}>
				<IconButton color="secondary" icon={Icons.FocusField} onClick={fov.show} tooltipContent="FOV" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
				<ToggleButton color="primary" icon={Icons.MousePointerClick} onClick={mouseCoordinate.toggle} tooltipContent="Mouse Coordinate" tooltipPlacement={TOOLTIP_PLACEMENT} value={isMouseCoordinateVisible} />
			</Activity>
		</div>
	)
})

const TransformationPopover = memo(() => (
	<Popover placement={TOOLTIP_PLACEMENT} trigger={<IconButton color="success" icon={Icons.Palette} tooltipContent="Transformation" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />}>
		<TransformationPopoverContent />
	</Popover>
))

const TransformationPopoverContent = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const scnr = useMolecule(ImageScnrMolecule)
	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const filter = useMolecule(ImageFilterMolecule)
	const calibration = useMolecule(ImageCalibrationMolecule)
	const { transformation, info } = useSnapshot(viewer.state)

	return (
		<div className={`${POPOVER_PANEL_CLASS} flex flex-row items-center justify-center gap-2 p-2`}>
			<IconButton color="secondary" icon={Icons.Image} onClick={calibration.show} tooltipContent="Calibration" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
			<Activity mode={info && !info.mono ? 'visible' : 'hidden'}>
				<IconButton color="secondary" icon={Icons.Swatch} onClick={scnr.show} tooltipContent="SCNR" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
			</Activity>
			<IconButton color="secondary" icon={Icons.ImageEdit} onClick={adjustment.show} tooltipContent="Adjustment" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
			<IconButton color="secondary" icon={Icons.Brush} onClick={filter.show} tooltipContent="Filter" tooltipPlacement={TOOLTIP_PLACEMENT} variant="flat" />
			<ToggleButton color="primary" icon={Icons.FlipHorizontal} onClick={viewer.toggleHorizontalMirror} tooltipContent="Horizontal mirror" tooltipPlacement={TOOLTIP_PLACEMENT} value={transformation.horizontalMirror} />
			<ToggleButton color="primary" icon={Icons.FlipVertical} onClick={viewer.toggleVerticalMirror} tooltipContent="Vertical Mirror" tooltipPlacement={TOOLTIP_PLACEMENT} value={transformation.verticalMirror} />
			<ToggleButton color="primary" icon={Icons.InvertColor} onClick={viewer.toggleInvert} tooltipContent="Invert" tooltipPlacement={TOOLTIP_PLACEMENT} value={transformation.invert} />
		</div>
	)
})
