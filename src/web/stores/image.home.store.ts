import type { Image } from '@shared/types'
import { dockviewStore } from '@stores/dockview.store'
import type { DockviewApi, DockviewGroupPanel, DockviewGroupPanelApi, DockviewReadyEvent, IDockviewGroupPanel, IDockviewPanel } from 'dockview-react'
import { unsubscribe } from 'src/shared/util'

export type ImageHomeStore = ReturnType<typeof imageHomeStore>

export type ImagePanelType =
	| 'adjustment'
	| 'annotation'
	| 'calibration'
	| 'coordinateGrid'
	| 'cosmeticCorrection'
	| 'crosshair'
	| 'curveTransformation'
	| 'debayer'
	| 'filter'
	| 'fov'
	| 'header'
	| 'mouseCoordinate'
	| 'roi'
	| 'rotation'
	| 'save'
	| 'scnr'
	| 'settings'
	| 'solver'
	| 'starDetection'
	| 'statistics'
	| 'stretch'
	| 'viewer'

export function imageHomeStore(image: Image) {
	let api: DockviewApi
	let mounted = false
	const u: VoidFunction[] = []

	let left: DockviewGroupPanelApi
	let right: DockviewGroupPanelApi
	let main: DockviewGroupPanel | IDockviewGroupPanel | undefined

	const panels: Record<ImagePanelType, IDockviewPanel[]> = {
		adjustment: [],
		annotation: [],
		calibration: [],
		coordinateGrid: [],
		cosmeticCorrection: [],
		crosshair: [],
		curveTransformation: [],
		debayer: [],
		filter: [],
		fov: [],
		header: [],
		mouseCoordinate: [],
		roi: [],
		rotation: [],
		save: [],
		scnr: [],
		settings: [],
		solver: [],
		starDetection: [],
		statistics: [],
		stretch: [],
		viewer: [],
	}

	const dockview = dockviewStore(panels, { layoutSchemaVersion: 1, layoutStorageKey: `image.workspace.${image.camera?.id ?? 'default'}.layout` })

	function mount() {
		if (mounted) return unmount

		console.info('image home mounted')

		mounted = true

		return unmount
	}

	function unmount() {
		if (!mounted) return

		console.info('image home unmounted')

		unsubscribe(u)

		save()
		dockview.unregisterOnDidLayoutChange()

		mounted = false
	}

	function handleReady(event: DockviewReadyEvent) {
		api = event.api

		load()

		// Init Layout

		// Edge Panels
		left = dockview.addEdge(api, 'left', { initialSize: 360 })
		right = dockview.addEdge(api, 'right', { initialSize: 360 })

		// Left Panel
		dockview.addSinglePanel(api, 'save', { tabComponent: 'fixed', params: image, title: 'Save' }, left, false)
		dockview.addSinglePanel(api, 'stretch', { tabComponent: 'fixed', params: image, title: 'Stretch' }, left, false)
		dockview.addSinglePanel(api, 'debayer', { tabComponent: 'fixed', params: image, title: 'Debayer' }, left, false)
		dockview.addSinglePanel(api, 'crosshair', { tabComponent: 'fixed', params: image, title: 'Crosshair' }, left, false)
		dockview.addSinglePanel(api, 'rotation', { tabComponent: 'fixed', params: image, title: 'Rotate' }, left, false)
		dockview.addSinglePanel(api, 'calibration', { tabComponent: 'fixed', params: image, title: 'Calibration' }, left, false)
		dockview.addSinglePanel(api, 'scnr', { tabComponent: 'fixed', params: image, title: 'SCNR' }, left, false)
		dockview.addSinglePanel(api, 'adjustment', { tabComponent: 'fixed', params: image, title: 'Adjustment' }, left, false)
		dockview.addSinglePanel(api, 'filter', { tabComponent: 'fixed', params: image, title: 'Filter' }, left, false)
		dockview.addSinglePanel(api, 'settings', { tabComponent: 'fixed', params: image, title: 'Settings' }, left, false)

		// Center Panel
		main = dockview.addGroup(api, { id: 'group.main' })

		dockview.addSinglePanel(api, 'viewer', { tabComponent: 'fixed', params: image, title: 'Viewer' }, main)

		// Right Panel
		dockview.addSinglePanel(api, 'solver', { tabComponent: 'fixed', params: image, title: 'Solver' }, right, false)
		dockview.addSinglePanel(api, 'annotation', { tabComponent: 'fixed', params: image, title: 'Annotation' }, right, false)
		dockview.addSinglePanel(api, 'starDetection', { tabComponent: 'fixed', params: image, title: 'Star Detection' }, right, false)
		dockview.addSinglePanel(api, 'roi', { tabComponent: 'fixed', params: image, title: 'ROI' }, right, false)
		dockview.addSinglePanel(api, 'fov', { tabComponent: 'fixed', params: image, title: 'FOV' }, right, false)
		dockview.addSinglePanel(api, 'mouseCoordinate', { tabComponent: 'fixed', params: image, title: 'Mouse Coordinate' }, right, false)
		dockview.addSinglePanel(api, 'coordinateGrid', { tabComponent: 'fixed', params: image, title: 'Coordinate Grid' }, right, false)
		dockview.addSinglePanel(api, 'header', { tabComponent: 'fixed', params: image, title: 'FITS Header' }, right, false)
		dockview.addSinglePanel(api, 'statistics', { tabComponent: 'fixed', params: image, title: 'Statistics' }, right, false)

		dockview.registerOnDidLayoutChange(api)

		window.addEventListener('beforeunload', save)

		u[0] = () => window.removeEventListener('beforeunload', save)
	}

	function load() {
		dockview.load(api, () => true)
	}

	function save() {
		dockview.saveLayout(api)
	}

	return {
		mount,
		unmount,
		handleReady,
	} as const
}
