import type { Image } from '@shared/types'
import type { AddGroupOptions, AddPanelOptions, DockviewApi, DockviewGroupPanel, DockviewGroupPanelApi, DockviewIDisposable, DockviewReadyEvent, EdgeGroupOptions, EdgeGroupPosition, IDockviewGroupPanel, IDockviewPanel, SerializedDockview } from 'dockview-react'
import type { RequiredOnly } from 'nebulosa/src/core/types'
import { unsubscribe } from 'src/shared/util'

export type ImageHomeStore = ReturnType<typeof imageHomeStore>

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

export type ImagePanelOptions<P extends object = object> = Readonly<Omit<AddPanelOptions<P> & { index?: number }, 'position' | 'floating' | 'id' | 'component'>>

export interface StoredImageLayout {
	readonly schemaVersion: number
	readonly layout: SerializedDockview
}

const LAYOUT_SCHEMA_VERSION = 1

export function imageHomeStore(image: Image) {
	let api: DockviewApi
	let mounted = false
	const u: VoidFunction[] = []

	let saveTimer: number | undefined
	let layoutChangeDisposable: DockviewIDisposable | undefined

	let left: DockviewGroupPanelApi
	let right: DockviewGroupPanelApi
	let main: DockviewGroupPanel | IDockviewGroupPanel | undefined

	const panels: Partial<Record<ImagePanelType, IDockviewPanel[]>> = {}
	const layoutKey = `image.workspace.${image.id}.layout`

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

		layoutChangeDisposable?.dispose()
		layoutChangeDisposable = undefined

		window.clearTimeout(saveTimer)
		saveTimer = undefined

		saveLayout()

		mounted = false
	}

	function handleReady(event: DockviewReadyEvent) {
		api = event.api

		load()

		// Init Layout

		// Edge Panels
		left = addEdge('left', { initialSize: 360 })
		right = addEdge('right', { initialSize: 360 })

		// Left Panel
		addPanel('save', { tabComponent: 'fixed', params: image, title: 'Save' }, left, false)
		addPanel('stretch', { tabComponent: 'fixed', params: image, title: 'Stretch' }, left, false)
		addPanel('debayer', { tabComponent: 'fixed', params: image, title: 'Debayer' }, left, false)
		addPanel('crosshair', { tabComponent: 'fixed', params: image, title: 'Crosshair' }, left, false)
		addPanel('rotation', { tabComponent: 'fixed', params: image, title: 'Rotate' }, left, false)
		addPanel('calibration', { tabComponent: 'fixed', params: image, title: 'Calibration' }, left, false)
		addPanel('scnr', { tabComponent: 'fixed', params: image, title: 'SCNR' }, left, false)
		addPanel('adjustment', { tabComponent: 'fixed', params: image, title: 'Adjustment' }, left, false)
		addPanel('filter', { tabComponent: 'fixed', params: image, title: 'Filter' }, left, false)
		addPanel('settings', { tabComponent: 'fixed', params: image, title: 'Settings' }, left, false)

		// Central Panel
		main = addGroup({ id: 'group.main' })

		addPanel('viewer', { tabComponent: 'fixed', params: image, title: 'Viewer' }, main)

		// Right Panel
		addPanel('solver', { tabComponent: 'fixed', params: image, title: 'Solver' }, right, false)
		addPanel('annotation', { tabComponent: 'fixed', params: image, title: 'Annotation' }, right, false)
		addPanel('starDetection', { tabComponent: 'fixed', params: image, title: 'Star Detection' }, right, false)
		addPanel('roi', { tabComponent: 'fixed', params: image, title: 'ROI' }, right, false)
		addPanel('fov', { tabComponent: 'fixed', params: image, title: 'FOV' }, right, false)
		addPanel('mouseCoordinate', { tabComponent: 'fixed', params: image, title: 'Mouse Coordinate' }, right, false)
		addPanel('coordinateGrid', { tabComponent: 'fixed', params: image, title: 'Coordinate Grid' }, right, false)
		addPanel('header', { tabComponent: 'fixed', params: image, title: 'FITS Header' }, right, false)
		addPanel('statistics', { tabComponent: 'fixed', params: image, title: 'Statistics' }, right, false)

		layoutChangeDisposable = api.onDidLayoutChange(() => {
			window.clearTimeout(saveTimer)
			saveTimer = window.setTimeout(saveLayout, 1000)
		})

		window.addEventListener('beforeunload', saveLayout)

		u[0] = () => window.removeEventListener('beforeunload', saveLayout)
	}

	function load() {
		const storedLayout = restoreLayout()

		if (storedLayout) {
			try {
				api.fromJSON(storedLayout.layout)
			} catch (e) {
				console.error('unable to restore layout:', e)
				localStorage.removeItem(layoutKey)
			}
		}

		for (const type of PANEL_TYPES) {
			const storedPanels: IDockviewPanel[] = []

			for (let i = 0; i < 1; i++) {
				const panel = api.getPanel(type)

				if (panel !== undefined) {
					console.info('loaded stored image panel:', panel.id, panel.group.id, panel.params)
					storedPanels.push(panel)
					listenOnDidRemovePanel(type, panel)
				}
			}

			panels[type] = storedPanels
		}
	}

	function restoreLayout() {
		const serializedLayout = localStorage.getItem(layoutKey)
		if (serializedLayout) return JSON.parse(serializedLayout) as StoredImageLayout
		return undefined
	}

	function saveLayout() {
		const storedLayout: StoredImageLayout = { schemaVersion: LAYOUT_SCHEMA_VERSION, layout: api.toJSON() }
		localStorage.setItem(layoutKey, JSON.stringify(storedLayout))
	}

	function addEdge(position: EdgeGroupPosition, options: Omit<Readonly<EdgeGroupOptions>, 'id'>) {
		return api.getEdgeGroup(position) ?? api.addEdgeGroup(position, { collapsedSize: 38, collapsed: true, ...options, id: `edge.${position}` })
	}

	function toggleEdge(position: EdgeGroupPosition) {
		api?.setEdgeGroupVisible(position, !api.isEdgeGroupVisible(position))
	}

	function addGroup(options: RequiredOnly<Readonly<AddGroupOptions>, 'id'>) {
		return api.getGroup(options.id) ?? api.addGroup({ ...options, direction: options.direction ?? 'within' })
	}

	function activatePanel(panel: IDockviewPanel) {
		panel.api.setActive()

		const location = panel.api.location

		if (location.type === 'edge') {
			api?.getEdgeGroup(location.position)?.expand()
		}
	}

	function addPanel(type: ImagePanelType, options: ImagePanelOptions, group?: Pick<DockviewGroupPanel, 'id'>, activate: boolean = true) {
		const activePanels = panels[type] ?? []

		if (activePanels.length > 0) {
			if (activate) activatePanel(activePanels[0])
			return activePanels[0]
		}

		const panel = api.addPanel({ renderer: 'onlyWhenVisible', ...options, id: type, tabComponent: group === left ? 'fixed' : 'closeable', component: type, position: { referenceGroup: (group ?? main!).id, index: options.index } })
		activePanels.push(panel)
		panels[type] = activePanels

		if (activate) activatePanel(panel)

		console.info('unique panel added:', type)

		listenOnDidRemovePanel(type, panel)

		return panel
	}

	function listenOnDidRemovePanel(type: ImagePanelType, panel: IDockviewPanel) {
		const listener = api.onDidRemovePanel((e) => {
			if (e === panel) {
				const index = panels[type]!.indexOf(panel)

				if (index >= 0) {
					panels[type]!.splice(index, 1)
					console.info('panel removed:', panel.id)
				}

				listener.dispose()
			}
		})

		return listener
	}

	return {
		mount,
		unmount,
		handleReady,
	} as const
}
