import type { Image } from '@shared/types'
import type { DockviewReadyEvent } from 'dockview-react'
import { unsubscribe } from 'src/shared/util'

export type ImageHomeStore = typeof imageHomeStore

// oxfmt-ignore
const PANEL_TYPES = [
	'adjustment',
	'annotation',
	'calibration',
	'coordinateGrid',
	'cosmeticCorrection',
	'crosshair',
	'curveTransformation',
	'debayer',
	'filter',
	'fov',
	'header',
	'mouseCoordinate',
	'roi',
	'rotation',
	'save',
	'scnr',
	'settings',
	'solver',
	'starDetection',
	'statistics',
	'stretch',
	'viewer',
] as const

export type ImagePanelType = (typeof PANEL_TYPES)[number]

let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return

	console.info('image home mounted')

	mounted = true

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('image home unmounted')
	unsubscribe(u)
	mounted = false
}

function handleReady(event: DockviewReadyEvent, image: Image) {
	const { api } = event

	// https://github.com/mathuo/dockview/issues/1495
	api.addPanel({ id: 'image', tabComponent: 'fixed', component: 'viewer', params: image, title: 'Viewer', renderer: 'always' })

	const left = api.addEdgeGroup('left', { id: 'left', collapsed: true, collapsedSize: 36, minimumSize: 360, maximumSize: 360, initialSize: 360 })
	const right = api.addEdgeGroup('right', { id: 'right', collapsed: true, collapsedSize: 36, minimumSize: 360, maximumSize: 360, initialSize: 360 })

	api.addPanel({ id: 'save', tabComponent: 'fixed', component: 'save', params: image, title: 'Save', position: { referenceGroup: left.id } })
	api.addPanel({ id: 'solver', tabComponent: 'fixed', component: 'solver', params: image, title: 'Solver', position: { referenceGroup: right.id } })
	api.addPanel({ id: 'stretch', tabComponent: 'fixed', component: 'stretch', params: image, title: 'Stretch', position: { referenceGroup: left.id } })
	api.addPanel({ id: 'debayer', tabComponent: 'fixed', component: 'debayer', params: image, title: 'Debayer', position: { referenceGroup: left.id } })
	api.addPanel({ id: 'crosshair', tabComponent: 'fixed', component: 'crosshair', params: image, title: 'Crosshair', position: { referenceGroup: left.id } })
	api.addPanel({ id: 'rotation', tabComponent: 'fixed', component: 'rotation', params: image, title: 'Rotate', position: { referenceGroup: left.id } })
	api.addPanel({ id: 'calibration', tabComponent: 'fixed', component: 'calibration', params: image, title: 'Calibration', position: { referenceGroup: left.id } })
	api.addPanel({ id: 'scnr', tabComponent: 'fixed', component: 'scnr', params: image, title: 'SCNR', position: { referenceGroup: left.id } })
	api.addPanel({ id: 'adjustment', tabComponent: 'fixed', component: 'adjustment', params: image, title: 'Adjustment', position: { referenceGroup: left.id } })
	api.addPanel({ id: 'filter', tabComponent: 'fixed', component: 'filter', params: image, title: 'Filter', position: { referenceGroup: left.id } })
	api.addPanel({ id: 'settings', tabComponent: 'fixed', component: 'settings', params: image, title: 'Settings', position: { referenceGroup: left.id } })

	api.addPanel({ id: 'annotation', tabComponent: 'fixed', component: 'annotation', params: image, title: 'Annotation', position: { referenceGroup: right.id } })
	api.addPanel({ id: 'starDetection', tabComponent: 'fixed', component: 'starDetection', params: image, title: 'Star Detection', position: { referenceGroup: right.id } })
	api.addPanel({ id: 'fov', tabComponent: 'fixed', component: 'fov', params: image, title: 'FOV', position: { referenceGroup: right.id } })
	api.addPanel({ id: 'header', tabComponent: 'fixed', component: 'header', params: image, title: 'FITS Header', position: { referenceGroup: right.id } })
	api.addPanel({ id: 'statistics', tabComponent: 'fixed', component: 'statistics', params: image, title: 'Statistics', position: { referenceGroup: right.id } })
}

export const imageHomeStore = {
	mount,
	unmount,
	handleReady,
} as const
