import { imageHomeStore } from '@stores/image.home.store'
import { ImageAdjustment } from '@ui/ImageAdjustment'
import { ImageAnnotation } from '@ui/ImageAnnotation'
import { ImageCalibration } from '@ui/ImageCalibration'
import { ImageCrosshair } from '@ui/ImageCrosshair'
import { ImageDebayer } from '@ui/ImageDebayer'
import { ImageFilter } from '@ui/ImageFilter'
import { ImageFov } from '@ui/ImageFov'
import { ImageHeader } from '@ui/ImageHeader'
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

const Dummy = () => <div></div>

const tabComponents = {
	fixed: Tab,
	closeable: Tab,
} as const

const components = {
	viewer: ImageViewer,
	save: ImageSave,
	solver: ImageSolver,
	stretch: ImageStretch,
	rotation: Dummy,
	calibration: ImageCalibration,
	scnr: ImageScnr,
	adjustment: ImageAdjustment,
	filter: ImageFilter,
	annotation: ImageAnnotation,
	starDetection: ImageStarDetection,
	fov: ImageFov,
	header: ImageHeader,
	statistics: ImageStatistics,
	settings: ImageSettings,
	debayer: ImageDebayer,
	crosshair: ImageCrosshair,
} as const

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
