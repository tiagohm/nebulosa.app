import { imageWorkspaceStore } from '@stores/image.workspace.store'
import { ImageAdjustment } from '@ui/ImageAdjustment'
import { ImageAnnotation } from '@ui/ImageAnnotation'
import { ImageCalibration } from '@ui/ImageCalibration'
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
import { DockviewReact, themeGithubDark, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import { memo, useEffect } from 'react'
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
	'component.image.viewer': ImageViewer,
	'component.image.save': ImageSave,
	'component.image.solver': ImageSolver,
	'component.image.stretch': ImageStretch,
	'component.image.rotation': Dummy,
	'component.image.calibration': ImageCalibration,
	'component.image.scnr': ImageScnr,
	'component.image.adjustment': ImageAdjustment,
	'component.image.filter': ImageFilter,
	'component.image.annotation': ImageAnnotation,
	'component.image.starDetection': ImageStarDetection,
	'component.image.fov': ImageFov,
	'component.image.header': ImageHeader,
	'component.image.statistics': ImageStatistics,
	'component.image.settings': ImageSettings,
} as const

export const ImageWorkspace = memo(({ params }: IDockviewPanelProps<Image>) => {
	useEffect(imageWorkspaceStore.mount, [])
	const viewer = useStore(() => imageViewerStore(params), [params])

	function handleReady(event: DockviewReadyEvent) {
		const { api } = event

		api.addPanel({ id: 'panel.image', tabComponent: 'fixed', component: 'component.image.viewer', params, title: 'Viewer' })

		const left = api.addEdgeGroup('left', { id: 'edge.left', collapsed: true, collapsedSize: 38, initialSize: 380 })
		const right = api.addEdgeGroup('right', { id: 'edge.right', collapsed: true, collapsedSize: 38, initialSize: 380 })

		api.addPanel({ id: 'panel.save', tabComponent: 'fixed', component: 'component.image.save', params, title: 'Save', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.solver', tabComponent: 'fixed', component: 'component.image.solver', params, title: 'Solver', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.stretch', tabComponent: 'fixed', component: 'component.image.stretch', params, title: 'Stretch', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.rotation', tabComponent: 'fixed', component: 'component.image.rotation', params, title: 'Rotate', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.calibration', tabComponent: 'fixed', component: 'component.image.calibration', params, title: 'Calibration', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.scnr', tabComponent: 'fixed', component: 'component.image.scnr', params, title: 'SCNR', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.adjustment', tabComponent: 'fixed', component: 'component.image.adjustment', params, title: 'Adjustment', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.filter', tabComponent: 'fixed', component: 'component.image.filter', params, title: 'Filter', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.annotation', tabComponent: 'fixed', component: 'component.image.annotation', params, title: 'Annotation', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.starDetection', tabComponent: 'fixed', component: 'component.image.starDetection', params, title: 'Star Detection', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.fov', tabComponent: 'fixed', component: 'component.image.fov', params, title: 'FOV', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.header', tabComponent: 'fixed', component: 'component.image.header', params, title: 'FITS Header', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.statistics', tabComponent: 'fixed', component: 'component.image.statistics', params, title: 'Statistics', position: { referenceGroup: right.id } })
	}

	return (
		<div className="workspace relative h-full min-h-0 w-full flex-1 overflow-hidden">
			<ImageViewerStoreContext value={viewer}>
				<DockviewReact hideBorders theme={themeGithubDark} className="h-full w-full" defaultTabComponent={Tab} tabComponents={tabComponents} components={components} onReady={handleReady} />
			</ImageViewerStoreContext>
		</div>
	)
})
