import { imageHomeStore, type ImagePanelType } from '@stores/image.home.store'
import { ImageAdjustment } from '@ui/ImageAdjustment'
import { ImageAnnotation } from '@ui/ImageAnnotation'
import { ImageCalibration } from '@ui/ImageCalibration'
import { ImageCoordinateGrid } from '@ui/ImageCoordinateGrid'
import { ImageCrosshair } from '@ui/ImageCrosshair'
import { ImageDebayer } from '@ui/ImageDebayer'
import { ImageFilter } from '@ui/ImageFilter'
import { ImageFov } from '@ui/ImageFov'
import { ImageHeader } from '@ui/ImageHeader'
import { ImageMouseCoordinate } from '@ui/ImageMouseCoordinate'
import { ImageRoi } from '@ui/ImageRoi'
import { ImageSave } from '@ui/ImageSave'
import { ImageScnr } from '@ui/ImageScnr'
import { ImageSettings } from '@ui/ImageSettings'
import { ImageSolver } from '@ui/ImageSolver'
import { ImageStarDetection } from '@ui/ImageStarDetection'
import { ImageStatistics } from '@ui/ImageStatistics'
import { ImageStretch } from '@ui/ImageStretch'
import { ImageViewer } from '@ui/ImageViewer'
import { Tab } from '@ui/Tab'
import { DockviewReact, themeGithubDark, type IDockviewPanelProps } from 'dockview-react'
import { memo } from 'react'
import { useStore } from 'src/web/hooks/store.hook'
import { ImageViewerStoreContext } from 'src/web/shared/context'
import type { Image } from 'src/web/shared/types'
import { imageViewerStore } from 'src/web/stores/image.viewer.store'

const Dummy = memo(() => <div></div>)

const tabComponents = {
	fixed: Tab,
	closeable: Tab,
} as const

const components = {
	adjustment: ImageAdjustment,
	annotation: ImageAnnotation,
	calibration: ImageCalibration,
	coordinateGrid: ImageCoordinateGrid,
	cosmeticCorrection: Dummy,
	crosshair: ImageCrosshair,
	curveTransformation: Dummy,
	debayer: ImageDebayer,
	filter: ImageFilter,
	fov: ImageFov,
	header: ImageHeader,
	mouseCoordinate: ImageMouseCoordinate,
	roi: ImageRoi,
	rotation: Dummy,
	save: ImageSave,
	scnr: ImageScnr,
	settings: ImageSettings,
	solver: ImageSolver,
	starDetection: ImageStarDetection,
	statistics: ImageStatistics,
	stretch: ImageStretch,
	viewer: ImageViewer,
} as const satisfies Record<ImagePanelType, React.FunctionComponent<IDockviewPanelProps>>

export const ImageHome = memo(({ params }: IDockviewPanelProps<Image>) => {
	const viewer = useStore(() => imageViewerStore(params), [params])

	return (
		<div className="workspace relative h-full min-h-0 w-full flex-1 overflow-hidden">
			<ImageViewerStoreContext value={viewer}>
				<DockviewReact hideBorders theme={themeGithubDark} className="h-full w-full" defaultTabComponent={Tab} tabComponents={tabComponents} components={components} onReady={(event) => imageHomeStore.handleReady(event, params)} />
			</ImageViewerStoreContext>
		</div>
	)
})
