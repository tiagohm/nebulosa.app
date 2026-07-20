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
} as const

export const ImageWorkspace = memo(({ params }: IDockviewPanelProps<Image>) => {
	useEffect(imageWorkspaceStore.mount, [])
	const viewer = useStore(() => imageViewerStore(params), [params])

	function handleReady(event: DockviewReadyEvent) {
		const { api } = event

		api.addPanel({ id: 'panel.image', tabComponent: 'fixed', component: 'viewer', params, title: 'Viewer' })

		// TODO: Há um bug, estando dentro da aba (Image), abra o painel lateral, arraste para uma largura qualquer, mude para uma outra aba (Planetarium), volte para a aba (Image), a largura do painel volta para o mínimo (default).
		// CONTORNO: Setar minimumSize = maximumSize = initialSize, mas isso não permite mais redimensionar a largura do painel
		const left = api.addEdgeGroup('left', { id: 'edge.left', collapsed: true, collapsedSize: 36, minimumSize: 360, maximumSize: 360, initialSize: 360 })
		const right = api.addEdgeGroup('right', { id: 'edge.right', collapsed: true, collapsedSize: 36, minimumSize: 360, maximumSize: 360, initialSize: 360 })

		api.addPanel({ id: 'panel.save', tabComponent: 'fixed', component: 'save', params, title: 'Save', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.solver', tabComponent: 'fixed', component: 'solver', params, title: 'Solver', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.stretch', tabComponent: 'fixed', component: 'stretch', params, title: 'Stretch', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.rotation', tabComponent: 'fixed', component: 'rotation', params, title: 'Rotate', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.calibration', tabComponent: 'fixed', component: 'calibration', params, title: 'Calibration', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.scnr', tabComponent: 'fixed', component: 'scnr', params, title: 'SCNR', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.adjustment', tabComponent: 'fixed', component: 'adjustment', params, title: 'Adjustment', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.filter', tabComponent: 'fixed', component: 'filter', params, title: 'Filter', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.annotation', tabComponent: 'fixed', component: 'annotation', params, title: 'Annotation', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.starDetection', tabComponent: 'fixed', component: 'starDetection', params, title: 'Star Detection', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.fov', tabComponent: 'fixed', component: 'fov', params, title: 'FOV', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.header', tabComponent: 'fixed', component: 'header', params, title: 'FITS Header', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.statistics', tabComponent: 'fixed', component: 'statistics', params, title: 'Statistics', position: { referenceGroup: right.id } })
	}

	return (
		<div className="workspace relative h-full min-h-0 w-full flex-1 overflow-hidden">
			<ImageViewerStoreContext value={viewer}>
				<DockviewReact hideBorders theme={themeGithubDark} className="h-full w-full" defaultTabComponent={Tab} tabComponents={tabComponents} components={components} onReady={handleReady} />
			</ImageViewerStoreContext>
		</div>
	)
})
