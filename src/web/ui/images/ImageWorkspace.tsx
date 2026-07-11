import { DockviewReact, themeGithubDark, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import { memo } from 'react'
import type { Image } from 'src/web/shared/types'
import { ImageViewer } from '../ImageViewer'
import { CloseableTab } from '../workspace/tabs/CloseableTab'
import { FixedTab } from '../workspace/tabs/FixedTab'

const Dummy = () => <div></div>

const tabComponents = {
	'tab.fixed': FixedTab,
	'tab.closeable': CloseableTab,
} as const

const components = {
	'component.image.viewer': ImageViewer,
	'component.image.save': Dummy,
	'component.image.solver': Dummy,
	'component.image.stretch': Dummy,
	'component.image.rotation': Dummy,
	'component.image.calibration': Dummy,
	'component.image.scnr': Dummy,
	'component.image.adjustment': Dummy,
	'component.image.filter': Dummy,
	'component.image.annotation': Dummy,
	'component.image.starDetection': Dummy,
	'component.image.fov': Dummy,
}

export const ImageWorkspace = memo(({ params }: IDockviewPanelProps<Image>) => {
	function handleReady(event: DockviewReadyEvent) {
		const { api } = event

		api.addPanel({ id: 'panel.image', tabComponent: 'tab.fixed', component: 'component.image.viewer', params, title: 'Viewer' })

		const left = api.addEdgeGroup('left', { id: 'edge.left', collapsed: true, collapsedSize: 38, initialSize: 480 })
		const right = api.addEdgeGroup('right', { id: 'edge.right', collapsed: true, collapsedSize: 38, initialSize: 480 })

		api.addPanel({ id: 'panel.save', tabComponent: 'tab.fixed', component: 'component.image.save', params, title: 'Save', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.solver', tabComponent: 'tab.fixed', component: 'component.image.solver', params, title: 'Solver', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.stretch', tabComponent: 'tab.fixed', component: 'component.image.stretch', params, title: 'Stretch', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.rotation', tabComponent: 'tab.fixed', component: 'component.image.rotation', params, title: 'Rotate', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.calibration', tabComponent: 'tab.fixed', component: 'component.image.calibration', params, title: 'Calibration', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.scnr', tabComponent: 'tab.fixed', component: 'component.image.scnr', params, title: 'SCNR', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.adjustment', tabComponent: 'tab.fixed', component: 'component.image.adjustment', params, title: 'Adjustment', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.filter', tabComponent: 'tab.fixed', component: 'component.image.filter', params, title: 'Filter', position: { referenceGroup: left.id } })
		api.addPanel({ id: 'panel.annotation', tabComponent: 'tab.fixed', component: 'component.image.annotation', params, title: 'Annotation', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.starDetection', tabComponent: 'tab.fixed', component: 'component.image.starDetection', params, title: 'Star Detection', position: { referenceGroup: right.id } })
		api.addPanel({ id: 'panel.fov', tabComponent: 'tab.fixed', component: 'component.image.fov', params, title: 'FOV', position: { referenceGroup: right.id } })
	}

	return (
		<div className="workspace relative h-full min-h-0 w-full flex-1 overflow-hidden">
			<DockviewReact hideBorders theme={themeGithubDark} className="h-full w-full" tabComponents={tabComponents} components={components} onReady={handleReady} />
		</div>
	)
})
