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
const LAYOUT_STORAGE_KEY = 'workspace.layout'

const state = proxy<HomeState>({})

let saveTimer: number | undefined
let layoutDisposable: DockviewIDisposable | undefined

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
	if (mounted) return

	console.info('home mounted')

	mounted = true

	return unmount
}

function unmount() {
	if (!mounted) return

	console.info('home unmounted')

	layoutDisposable?.dispose()
	layoutDisposable = undefined

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

function handleReady(event: DockviewReadyEvent) {
	api = event.api

	load()

	// Init Layout

	// Edge Panels
	left = addEdge('left', { initialSize: 380 })
	right = addEdge('right', { initialSize: 420 })

	// Left Panel
	addUniquePanel('connections', { tabComponent: 'fixed', title: 'Connections' }, left)
	addUniquePanel('devices', { tabComponent: 'fixed', title: 'Devices' }, left)
	addUniquePanel('alpacaServer', { tabComponent: 'fixed', title: 'Alpaca Server' }, left)
	addUniquePanel('indiServer', { tabComponent: 'fixed', title: 'INDI Server' }, left)
	addUniquePanel('settings', { tabComponent: 'fixed', title: 'Settings' }, left)
	addUniquePanel('about', { tabComponent: 'fixed', title: 'About' }, left)

	// Central Panel
	main = addGroup({ id: 'group.main' })

	// Atlas
	addUniquePanel('sun', { title: 'Sun' }, main)
	addUniquePanel('moon', { title: 'Moon' }, main)
	addUniquePanel('planet', { title: 'Planet' }, main)
	addUniquePanel('asteroid', { title: 'Asteroid' }, main)
	addUniquePanel('galaxy', { title: 'DSO' }, main)
	addUniquePanel('satellite', { title: 'Satellite' }, main)

	// layoutDisposable = api.onDidLayoutChange(() => {
	// 	window.clearTimeout(saveTimer)
	// 	saveTimer = window.setTimeout(saveLayout, 1000)
	// })
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
			// api.fromJSON(storedLayout.layout)
		} catch (e) {
			console.error('unable to restore layout:', e)
			localStorage.removeItem(LAYOUT_STORAGE_KEY)
		}
	}

	for (const type of PANEL_TYPES) {
		const ps: IDockviewPanel[] = []

		for (let i = 0; i < MAX_PANELS; i++) {
			const id = `${type}.${i}`
			const p = api!.getPanel(id)

			if (p !== undefined) {
				ps.push(p)
			}
		}

		panels[type] = ps
	}
}

function activatePanel(panel: IDockviewPanel) {
	panel.api.setActive()

	const location = panel.api.location

	if (location.type === 'edge') {
		api?.getEdgeGroup(location.position)?.expand()
	}
}

function addUniquePanel(type: HomePanelType, options: HomePanelOptions, group?: Pick<DockviewGroupPanel, 'id'>, activate: boolean = false) {
	const ps = panels[type] ?? []

	if (ps.length > 0) {
		activatePanel(ps[0])
		return ps[0]
	}

	const id = `${type}.0`
	const p = api!.addPanel({ renderer: 'onlyWhenVisible', ...options, id, tabComponent: group === left ? 'fixed' : 'closeable', component: type, position: { referenceGroup: (group ?? main!).id, index: options.index } })
	ps.push(p)
	panels[type] = ps

	if (activate) activatePanel(p)

	console.info('unique panel added:', id)

	const listener = api!.onDidRemovePanel((e) => {
		if (e === p) {
			const index = panels[type]!.indexOf(p)

			if (index >= 0) {
				panels[type]!.splice(index, 1)
				console.info('unique panel removed:', id)
			}

			listener.dispose()
		}
	})

	return p
}

function addMultiplePanel(type: HomePanelType, options: HomePanelOptions, group?: Pick<DockviewGroupPanel, 'id'>, activate: boolean = false) {
	const ps = panels[type] ?? []

	if (ps.length >= MAX_PANELS) return

	const referenceGroupId = (group ?? main!)?.id
	let referencePanel: IDockviewPanel | undefined

	for (let i = 0; i < MAX_PANELS; i++) {
		const id = `${type}.${i}`
		const p = ps.find((e) => e.id === id)

		if (p === undefined) {
			const p = api!.addPanel({ renderer: 'onlyWhenVisible', ...options, id, tabComponent: type === 'image' ? 'image' : 'closeable', component: type, position: referencePanel && !group?.id ? { referencePanel, direction: 'right' } : { referenceGroup: referenceGroupId } })
			ps.push(p)
			panels[type] = ps

			if (activate) activatePanel(p)

			console.info('multiple panel added:', id)

			const listener = api!.onDidRemovePanel((e) => {
				if (e === p) {
					const index = panels[type]!.indexOf(p)

					if (index >= 0) {
						panels[type]!.splice(index, 1)
						console.info('multiple panel removed:', id)
					}

					listener.dispose()
				}
			})

			return p
		} else if (p.group.id === referenceGroupId) {
			referencePanel = p
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
	return addMultiplePanel(device.type, { title: device.name, params }, right, true)
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
		panel = addMultiplePanel('image', { title, params: image }, main, true)

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
	return addUniquePanel('calculator', { title: 'Calculator' }, main)
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
	return addUniquePanel('framing', { title: 'Framing' }, main)
}

function addSolarEclipse() {
	return addUniquePanel('solarEclipse', { title: 'Solar Eclipse' }, main)
}

function addLunarEclipse() {
	return addUniquePanel('lunarEclipse', { title: 'Lunar Eclipse' }, main)
}

function addGuider() {
	return addUniquePanel('guider', { title: 'Guider' }, main)
}

function addTppa() {
	const params: TppaParams = { id: nanoid() }
	return addMultiplePanel('tppa', { title: 'TPPA', params }, main)
}

function addPlanetarium() {
	return addUniquePanel('planetarium', { title: 'Planetarium' }, main)
}

function addSun() {
	addUniquePanel('sun', { title: 'Sun' }, main)
}

function addMoon() {
	addUniquePanel('moon', { title: 'Moon' }, main)
}

function addPlanet() {
	addUniquePanel('planet', { title: 'Planet' }, main)
}

function addAsteroid() {
	addUniquePanel('asteroid', { title: 'Asteroid' }, main)
}

function addDSO() {
	addUniquePanel('galaxy', { title: 'DSO' }, main)
}

function addSatellite() {
	addUniquePanel('satellite', { title: 'Satellite' }, main)
}

window.addEventListener('beforeunload', () => {
	saveLayout()
})

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
