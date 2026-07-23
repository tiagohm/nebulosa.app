import { cameraBus, imageBus } from '@shared/bus'
import type { Image, ImageSource } from '@shared/types'
import { equipmentStore } from '@stores/equipment.store'
import type { AutoFocusParams } from '@ui/AutoFocus'
import type { DarvParams } from '@ui/Darv'
import type { FlatWizardParams } from '@ui/FlatWizard'
import type { TppaParams } from '@ui/Tppa'
import type { AddGroupOptions, AddPanelOptions, DockviewApi, DockviewGroupPanel, DockviewGroupPanelApi, DockviewIDisposable, DockviewReadyEvent, EdgeGroupOptions, EdgeGroupPosition, IDockviewGroupPanel, IDockviewPanel, SerializedDockview } from 'dockview-react'
import { nanoid } from 'nanoid'
import type { RequiredOnly } from 'nebulosa/src/core/types'
import type { Camera, Device } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'

export type HomeStore = typeof homeStore

const PANEL_TYPES = [
	'about',
	'alpacaServer',
	'asteroid',
	'autoFocus',
	'calculator',
	'camera',
	'connections',
	'cover',
	'darv',
	'devices',
	'dewHeater',
	'dome',
	'flatPanel',
	'flatWizard',
	'focuser',
	'framing',
	'galaxy',
	'gps',
	'guideOutput',
	'guider',
	'image',
	'indiServer',
	'lunarEclipse',
	'moon',
	'mount',
	'planet',
	'planetarium',
	'power',
	'rotator',
	'satellite',
	'settings',
	'solarEclipse',
	'sun',
	'thermometer',
	'tppa',
	'wheel',
] as const

const MAX_PANELS = 100

export type HomePanelType = (typeof PANEL_TYPES)[number]

export type HomePanelOptions<P extends object = object> = Readonly<Omit<AddPanelOptions<P> & { index?: number }, 'position' | 'floating' | 'id' | 'component'>>

export interface HomeState {}

export interface StoredHomeLayout {
	readonly schemaVersion: number
	readonly layout: SerializedDockview
}

const LAYOUT_SCHEMA_VERSION = 1
const LAYOUT_STORAGE_KEY = 'home.workspace.layout'

const state = proxy<HomeState>({})

let saveTimer: number | undefined
let layoutChangeDisposable: DockviewIDisposable | undefined

let api: DockviewApi | undefined
let left: DockviewGroupPanelApi | undefined
let right: DockviewGroupPanelApi | undefined
let main: DockviewGroupPanel | IDockviewGroupPanel | undefined

const panels: Partial<Record<HomePanelType, IDockviewPanel[]>> = {}

cameraBus.subscribe('frame', (event) => {
	if (event.path) {
		const camera = equipmentStore.get('camera', event.camera)
		camera && addImage(event.path, camera)
	}
})

let mounted = false

console.info('home created')

function mount() {
	if (mounted) return unmount

	console.info('home mounted')

	mounted = true

	return unmount
}

function unmount() {
	if (!mounted) return

	console.info('home unmounted')

	layoutChangeDisposable?.dispose()
	layoutChangeDisposable = undefined

	window.clearTimeout(saveTimer)
	saveTimer = undefined

	saveLayout()

	mounted = false
}

function restoreLayout() {
	const serializedLayout = localStorage.getItem(LAYOUT_STORAGE_KEY)
	if (serializedLayout) return JSON.parse(serializedLayout) as StoredHomeLayout
	return undefined
}

function saveLayout() {
	if (api) {
		const storedLayout: StoredHomeLayout = { schemaVersion: LAYOUT_SCHEMA_VERSION, layout: api.toJSON() }
		localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(storedLayout))
	}
}

function hasDevicePanels() {
	return (
		!!panels.camera?.length ||
		!!panels.mount?.length ||
		!!panels.focuser?.length ||
		!!panels.wheel?.length ||
		!!panels.rotator?.length ||
		!!panels.flatPanel?.length ||
		!!panels.cover?.length ||
		!!panels.dome?.length ||
		!!panels.power?.length ||
		!!panels.gps?.length ||
		!!panels.guideOutput?.length ||
		!!panels.thermometer?.length ||
		!!panels.dewHeater?.length
	)
}

function handleReady(event: DockviewReadyEvent) {
	api = event.api

	load()

	// Init Layout

	// Edge Panels
	left = addEdge('left', { initialSize: 380 })
	right = addEdge('right', { initialSize: 420 })

	if (!hasDevicePanels()) right.collapse()

	// Left Panel
	addSinglePanel('connections', { tabComponent: 'fixed', title: 'Connections' }, left, false)
	addSinglePanel('devices', { tabComponent: 'fixed', title: 'Devices' }, left, false)
	addSinglePanel('alpacaServer', { tabComponent: 'fixed', title: 'Alpaca Server' }, left, false)
	addSinglePanel('indiServer', { tabComponent: 'fixed', title: 'INDI Server' }, left, false)
	addSinglePanel('settings', { tabComponent: 'fixed', title: 'Settings' }, left, false)
	addSinglePanel('about', { tabComponent: 'fixed', title: 'About' }, left, false)

	// Central Panel
	main = addGroup({ id: 'group.main' })

	// Atlas
	addSinglePanel('sun', { title: 'Sun' }, main)
	addSinglePanel('moon', { title: 'Moon' }, main, false)
	addSinglePanel('planet', { title: 'Planet' }, main, false)
	addSinglePanel('asteroid', { title: 'Asteroid' }, main, false)
	addSinglePanel('galaxy', { title: 'DSO' }, main, false)
	addSinglePanel('satellite', { title: 'Satellite' }, main, false)

	layoutChangeDisposable = api.onDidLayoutChange(() => {
		window.clearTimeout(saveTimer)
		saveTimer = window.setTimeout(saveLayout, 1000)
	})
}

function addEdge(position: EdgeGroupPosition, options: Omit<Readonly<EdgeGroupOptions>, 'id'>) {
	return api!.getEdgeGroup(position) ?? api!.addEdgeGroup(position, { collapsedSize: 38, collapsed: true, ...options, id: `edge.${position}` })
}

function toggleEdge(position: EdgeGroupPosition) {
	api?.setEdgeGroupVisible(position, !api.isEdgeGroupVisible(position))
}

function addGroup(options: RequiredOnly<Readonly<AddGroupOptions>, 'id'>) {
	return api!.getGroup(options.id) ?? api!.addGroup({ ...options, direction: options.direction ?? 'within' })
}

function load() {
	const storedLayout = restoreLayout()

	if (storedLayout) {
		try {
			api!.fromJSON(storedLayout.layout)
		} catch (e) {
			console.error('unable to restore layout:', e)
			localStorage.removeItem(LAYOUT_STORAGE_KEY)
		}
	}

	for (const type of PANEL_TYPES) {
		const storedPanels: IDockviewPanel[] = []

		for (let i = 0; i < MAX_PANELS; i++) {
			const id = `${type}.${i}`
			const panel = api!.getPanel(id)

			if (panel !== undefined) {
				if (type === 'image') {
					api!.removePanel(panel)
					continue
				}

				console.info('loaded stored home panel:', panel.id, panel.group.id, panel.params)
				storedPanels.push(panel)
				listenOnDidRemovePanel(type, panel)
			}
		}

		panels[type] = storedPanels
	}
}

function activatePanel(panel: IDockviewPanel) {
	panel.api.setActive()

	const location = panel.api.location

	if (location.type === 'edge') {
		api?.getEdgeGroup(location.position)?.expand()
	}
}

function addSinglePanel(type: HomePanelType, options: HomePanelOptions, group?: Pick<DockviewGroupPanel, 'id'>, activate: boolean = true) {
	const activePanels = panels[type] ?? []

	if (activePanels.length > 0) {
		if (activate) activatePanel(activePanels[0])
		return activePanels[0]
	}

	const id = `${type}.0`
	const panel = api!.addPanel({ renderer: 'onlyWhenVisible', ...options, id, tabComponent: group === left ? 'fixed' : 'closeable', component: type, position: { referenceGroup: (group ?? main!).id, index: options.index } })
	activePanels.push(panel)
	panels[type] = activePanels

	if (activate) activatePanel(panel)

	console.info('unique panel added:', id)

	listenOnDidRemovePanel(type, panel)

	return panel
}

function addMultiplePanel(type: HomePanelType, options: HomePanelOptions, group?: Pick<DockviewGroupPanel, 'id'>, activate: boolean = true) {
	const activePanels = panels[type] ?? []

	if (activePanels.length >= MAX_PANELS) return

	const referenceGroupId = (group ?? main!)?.id
	let referencePanel: IDockviewPanel | undefined

	for (let i = 0; i < MAX_PANELS; i++) {
		const id = `${type}.${i}`
		const panel = activePanels.find((e) => e.id === id)

		if (panel === undefined) {
			const p = api!.addPanel({ renderer: 'onlyWhenVisible', ...options, id, tabComponent: type === 'image' ? 'image' : 'closeable', component: type, position: referencePanel && !group?.id ? { referencePanel, direction: 'right' } : { referenceGroup: referenceGroupId } })
			activePanels.push(p)
			panels[type] = activePanels

			if (activate) activatePanel(p)

			console.info('multiple panel added:', id)

			listenOnDidRemovePanel(type, p)

			return p
		} else if (panel.group.id === referenceGroupId) {
			referencePanel = panel
		}
	}
}

function addDevice(device: Device) {
	const devicePanels = panels[device.type] ?? []
	const panel = devicePanels.find((e) => e.params!.id === device.id)

	if (panel) {
		activatePanel(panel)
		return panel
	}

	const params = { type: device.type, id: device.id, name: device.name } as const satisfies Pick<Device, 'id' | 'type' | 'name'>
	return addMultiplePanel(device.type, { title: device.name, params }, right)
}

function addImage(path: string, source: ImageSource | Camera, id?: string) {
	if (!api) return undefined

	const camera = typeof source === 'object' ? source : undefined
	source = typeof source === 'string' ? source : 'camera'
	id = `${source}-${id || camera?.id || nanoid()}`

	const imagePanels = panels.image ?? []
	let panel = imagePanels.find((e) => e.params!.id === id)

	if (panel) {
		const image = panel.params as Image
		imageBus.emit('update', { image, path })
		return image
	} else {
		const image = { path, id, source, camera }
		const title = image.camera?.name ?? image.path
		panel = addMultiplePanel('image', { title, params: image }, main)

		if (panel !== undefined) {
			imageBus.emit('add', image)
			return image
		}
	}
}

function removeImage(image: Image) {
	if (!api) return undefined

	const p = panels.image?.find((e) => e.params!.id === image.id)

	if (p) {
		api.removePanel(p)
		p.dispose()
		imageBus.emit('remove', image)
	}
}

function addAutoFocus() {
	const params: AutoFocusParams = { id: nanoid() }
	return addMultiplePanel('autoFocus', { title: 'Auto Focus', params }, main)
}

function addCalculator() {
	return addSinglePanel('calculator', { title: 'Calculator' }, main)
}

function addDarv() {
	const params: DarvParams = { id: nanoid() }
	return addMultiplePanel('darv', { title: 'DARV', params }, main)
}

function addFlatWizard() {
	const params: FlatWizardParams = { id: nanoid() }
	return addMultiplePanel('flatWizard', { title: 'Flat Wizard', params }, main)
}

function addFraming() {
	return addSinglePanel('framing', { title: 'Framing' }, main)
}

function addSolarEclipse() {
	return addSinglePanel('solarEclipse', { title: 'Solar Eclipse' }, main)
}

function addLunarEclipse() {
	return addSinglePanel('lunarEclipse', { title: 'Lunar Eclipse' }, main)
}

function addGuider() {
	return addSinglePanel('guider', { title: 'Guider' }, main)
}

function addTppa() {
	const params: TppaParams = { id: nanoid() }
	return addMultiplePanel('tppa', { title: 'TPPA', params }, main)
}

function addPlanetarium() {
	return addSinglePanel('planetarium', { title: 'Planetarium' }, main)
}

function addSun() {
	addSinglePanel('sun', { title: 'Sun' }, main)
}

function addMoon() {
	addSinglePanel('moon', { title: 'Moon' }, main)
}

function addPlanet() {
	addSinglePanel('planet', { title: 'Planet' }, main)
}

function addAsteroid() {
	addSinglePanel('asteroid', { title: 'Asteroid' }, main)
}

function addDSO() {
	addSinglePanel('galaxy', { title: 'DSO' }, main)
}

function addSatellite() {
	addSinglePanel('satellite', { title: 'Satellite' }, main)
}

function listenOnDidRemovePanel(type: HomePanelType, panel: IDockviewPanel) {
	const listener = api!.onDidRemovePanel((e) => {
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

window.addEventListener('beforeunload', saveLayout)

export const homeStore = {
	state,
	handleReady,
	mount,
	unmount,
	toggleEdge,
	addDevice,
	addImage,
	removeImage,
	addAutoFocus,
	addCalculator,
	addDarv,
	addFlatWizard,
	addFraming,
	addSolarEclipse,
	addLunarEclipse,
	addGuider,
	addTppa,
	addPlanetarium,
	addSun,
	addMoon,
	addPlanet,
	addAsteroid,
	addDSO,
	addSatellite,
} as const
