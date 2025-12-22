import { useMolecule } from 'bunshi/react'
import { Activity, memo, useCallback, useLayoutEffect, useRef } from 'react'
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
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { AnnotatedStars } from './AnnotatedStars'
import { CoordinateOnMouse } from './CoordinateOnMouse'
import { Crosshair } from './Crosshair'
import { DetectedStars } from './DetectedStars'
import { FITSHeader } from './FITSHeader'
import { Fov } from './Fov'
import { ImageAdjustment } from './ImageAdjustment'
import { ImageAnnotation } from './ImageAnnotation'
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
import { Interactable, type InteractableMethods, type InteractableProps } from './Interactable'
import { StarDetection } from './StarDetection'

export const ImageViewer = memo(() => {
	const imgRef = useRef<HTMLImageElement>(null)
	const interactableRef = useRef<InteractableMethods>(null)

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

	useLayoutEffect(() => {
		if (imgRef.current) {
			viewer.attachImage(imgRef.current)
			workspace.link(image, viewer)
		}

		if (interactableRef.current) {
			viewer.attachInteractable(interactableRef.current)
		}

		return () => {
			viewer.detach()
		}
	}, [])

	const handleGesture = useCallback<Exclude<InteractableProps['onGesture'], undefined>>(({ scale, angle }) => {
		viewer.state.scale = scale
		viewer.state.angle = angle
	}, [])

	const handlePointerUp = useCallback<Exclude<InteractableProps['onPointerUp'], undefined>>(({ event, dragging, pinching }) => {
		if (!mouseCoordinate.state.visible || dragging || pinching) return
		mouseCoordinate.handleInterpolatedCoordinate(event.offsetX, event.offsetY, true)
	}, [])

	const handleMouseMove = useCallback<Exclude<InteractableProps['onMouseMove'], undefined>>(({ event, dragging, pinching }) => {
		if (!mouseCoordinate.state.visible || dragging || pinching) return
		mouseCoordinate.handleInterpolatedCoordinate(event.offsetX, event.offsetY, false)
	}, [])

	return (
		<>
			<Activity mode={selected?.key === image.key ? 'visible' : 'hidden'}>
				<ImageToolBar />
				<ImageInfo />
			</Activity>
			<Interactable onGesture={handleGesture} onMouseMove={handleMouseMove} onPointerUp={handlePointerUp} onTap={viewer.select} ref={interactableRef} zIndex={image.position}>
				<img className='image select-none touch-none pointer-events-none max-w-none shadow-[0_0_80px_black]' draggable={false} id={image.key} onLoad={viewer.handleOnLoad} ref={imgRef} />
				<InteractableOverlay />
			</Interactable>
			<Activity mode={showStretch ? 'visible' : 'hidden'}>
				<ImageStretch />
			</Activity>
			<Activity mode={showPlateSolver ? 'visible' : 'hidden'}>
				<ImageSolver />
			</Activity>
			<Activity mode={showScnr ? 'visible' : 'hidden'}>
				<ImageScnr />
			</Activity>
			<Activity mode={showAdjustment ? 'visible' : 'hidden'}>
				<ImageAdjustment />
			</Activity>
			<Activity mode={showFilter ? 'visible' : 'hidden'}>
				<ImageFilter />
			</Activity>
			<Activity mode={showStarDetection ? 'visible' : 'hidden'}>
				<StarDetection />
			</Activity>
			<Activity mode={showHeader ? 'visible' : 'hidden'}>
				<FITSHeader />
			</Activity>
			<Activity mode={showSettings ? 'visible' : 'hidden'}>
				<ImageSettings />
			</Activity>
			<Activity mode={showAnnotation && solution ? 'visible' : 'hidden'}>
				<ImageAnnotation />
			</Activity>
			<Activity mode={showSave ? 'visible' : 'hidden'}>
				<ImageSave />
			</Activity>
			<Activity mode={showStatistics ? 'visible' : 'hidden'}>
				<ImageStatistics />
			</Activity>
			<Activity mode={showFov && solution ? 'visible' : 'hidden'}>
				<ImageFov />
			</Activity>
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
	const { visible: isMouseCoordinateVisible } = useSnapshot(mouseCoordinate.state)

	const fov = useMolecule(ImageFovMolecule)
	const { show: isFovVisible } = useSnapshot(fov.state)

	return (
		<>
			<Activity mode={crosshair ? 'visible' : 'hidden'}>
				<Crosshair />
			</Activity>
			<Activity mode={isDetectedStarsVisible ? 'visible' : 'hidden'}>
				<DetectedStars />
			</Activity>
			<Activity mode={isAnnotatedStarsVisible ? 'visible' : 'hidden'}>
				<AnnotatedStars />
			</Activity>
			<Activity mode={isMouseCoordinateVisible ? 'visible' : 'hidden'}>
				<CoordinateOnMouse />
			</Activity>
			<Activity mode={isFovVisible ? 'visible' : 'hidden'}>
				<Fov />
			</Activity>
		</>
	)
})
