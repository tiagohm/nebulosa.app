import { useMolecule } from 'bunshi/react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
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
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { AnnotatedStars } from './AnnotatedStars'
import { CoordinateOnMouse } from './CoordinateOnMouse'
import { Crosshair } from './Crosshair'
import { DetectedStars } from './DetectedStars'
import { FITSHeader } from './FITSHeader'
import { Fov } from './Fov'
import { ImageAdjustment } from './ImageAdjustment'
import { ImageAnnotation } from './ImageAnnotation'
import { ImageCalibration } from './ImageCalibration'
import { ImageFilter } from './ImageFilter'
import { ImageFov } from './ImageFov'
import { ImageInfo } from './ImageInfo'
import { ImageSave } from './ImageSave'
import { ImageScnr } from './ImageScnr'
import { ImageSettings } from './ImageSettings'
import { ImageSolver } from './ImageSolver'
import { ImageStatistics } from './ImageStatistics'
import { ImageStretch } from './ImageStretch'
import { ImageToolBar } from './ImageToolBar'
import { Interactable, type InteractableProps } from './Interactable'
import { StarDetection } from './StarDetection'

function hasScaledSolution(solution: { readonly scale?: number } | undefined) {
	return solution?.scale !== undefined && Number.isFinite(solution.scale) && solution.scale > 0
}

export const ImageViewer = memo(() => {
	const imgRef = useRef<HTMLImageElement>(null)

	const viewer = useMolecule(ImageViewerMolecule)
	const { image } = viewer.scope

	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { selected } = useSnapshot(workspace.state)

	const starDetection = useMolecule(StarDetectionMolecule)
	const { show: showStarDetection } = useSnapshot(starDetection.state)

	const solver = useMolecule(ImageSolverMolecule)
	const { show: showPlateSolver, solution } = useSnapshot(solver.state)

	const annotation = useMolecule(ImageAnnotationMolecule)
	const { show: showAnnotation } = useSnapshot(annotation.state)

	const stretch = useMolecule(ImageStretchMolecule)
	const { show: showStretch } = useSnapshot(stretch.state)

	const scnr = useMolecule(ImageScnrMolecule)
	const { show: showScnr } = useSnapshot(scnr.state)

	const adjustment = useMolecule(ImageAdjustmentMolecule)
	const { show: showAdjustment } = useSnapshot(adjustment.state)

	const filter = useMolecule(ImageFilterMolecule)
	const { show: showFilter } = useSnapshot(filter.state)

	const calibration = useMolecule(ImageCalibrationMolecule)
	const { show: showCalibration } = useSnapshot(calibration.state)

	const settings = useMolecule(ImageSettingsMolecule)
	const { show: showSettings } = useSnapshot(settings.state)

	const save = useMolecule(ImageSaveMolecule)
	const { show: showSave } = useSnapshot(save.state)

	const statistics = useMolecule(ImageStatisticsMolecule)
	const { show: showStatistics } = useSnapshot(statistics.state)

	const header = useMolecule(ImageHeaderMolecule)
	const { show: showHeader } = useSnapshot(header.state)

	const fov = useMolecule(ImageFovMolecule)
	const { show: showFov } = useSnapshot(fov.state)

	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)
	const isSelected = selected?.key === image.key
	const hasSolution = solution !== undefined
	const hasSolutionScale = hasScaledSolution(solution)

	// Attaches the image element before the first paint so interactions can bind to it.
	useLayoutEffect(() => {
		if (imgRef.current) {
			viewer.attachImage(imgRef.current)
			workspace.link(image, viewer)
		}

		return () => {
			viewer.detach()
		}
	}, [])

	// Loads after layout so the image node is already available for cached/object URLs.
	useEffect(() => {
		if (imgRef.current) {
			void viewer.load(false)
		}
	}, [])

	const handleGesture = useCallback<NonNullable<InteractableProps['onGesture']>>(
		({ scale, angle }) => {
			if (viewer.state.scale !== scale) viewer.state.scale = scale
			if (viewer.state.angle !== angle) viewer.state.angle = angle
		},
		[viewer],
	)

	const handleClick = useCallback<NonNullable<InteractableProps['onClick']>>(
		({ event, dragging, pinching }) => {
			if (!mouseCoordinate.state.visible || dragging || pinching) return
			mouseCoordinate.handleInterpolatedCoordinate(event.offsetX, event.offsetY, true)
		},
		[mouseCoordinate],
	)

	const handleMouseMove = useCallback<NonNullable<InteractableProps['onMouseMove']>>(
		({ event, dragging, pinching }) => {
			if (!mouseCoordinate.state.visible || dragging || pinching) return
			mouseCoordinate.handleInterpolatedCoordinate(event.offsetX, event.offsetY, false)
		},
		[mouseCoordinate],
	)

	return (
		<>
			{isSelected && <ImageToolBar />}
			{isSelected && <ImageInfo />}
			<Interactable onGesture={handleGesture} onMouseMove={handleMouseMove} onClick={handleClick} onTap={viewer.select} ref={viewer.attachInteractable} zIndex={image.position}>
				<img className="image pointer-events-none max-w-none touch-none rounded-sm outline-8 outline-black/25 outline-solid select-none" draggable={false} id={image.key} onLoad={viewer.handleOnLoad} ref={imgRef} />
				<InteractableOverlay />
			</Interactable>
			{showStretch && <ImageStretch />}
			{showPlateSolver && <ImageSolver />}
			{showScnr && <ImageScnr />}
			{showAdjustment && <ImageAdjustment />}
			{showFilter && <ImageFilter />}
			{showCalibration && <ImageCalibration />}
			{showStarDetection && <StarDetection />}
			{showHeader && <FITSHeader />}
			{showSettings && <ImageSettings />}
			{showAnnotation && hasSolution && <ImageAnnotation />}
			{showSave && <ImageSave />}
			{showStatistics && <ImageStatistics />}
			{showFov && hasSolutionScale && <ImageFov />}
		</>
	)
})

const InteractableOverlay = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { crosshair } = useSnapshot(viewer.state)

	const starDetection = useMolecule(StarDetectionMolecule)
	const { visible: isDetectedStarsVisible } = useSnapshot(starDetection.state)

	const annotation = useMolecule(ImageAnnotationMolecule)
	const { visible: isAnnotatedStarsVisible } = useSnapshot(annotation.state)

	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)
	const { interpolator, visible: isMouseCoordinateVisible } = useSnapshot(mouseCoordinate.state)

	const fov = useMolecule(ImageFovMolecule)
	const { show: isFovVisible } = useSnapshot(fov.state)

	const solver = useMolecule(ImageSolverMolecule)
	const { solution } = useSnapshot(solver.state)
	const hasSolutionScale = hasScaledSolution(solution)

	return (
		<>
			{crosshair && <Crosshair />}
			{isDetectedStarsVisible && <DetectedStars />}
			{isAnnotatedStarsVisible && <AnnotatedStars />}
			{isMouseCoordinateVisible && interpolator !== undefined && <CoordinateOnMouse />}
			{isFovVisible && hasSolutionScale && <Fov />}
		</>
	)
})
