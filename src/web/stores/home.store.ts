import { cameraBus, imageBus } from '@shared/bus'
import type { Image, ImageSource } from '@shared/types'
import { equipmentStore } from '@stores/equipment.store'
import type { AddGroupOptions, AddPanelOptions, DockviewApi, DockviewGroupPanel, DockviewGroupPanelApi, DockviewIDisposable, DockviewReadyEvent, EdgeGroupOptions, EdgeGroupPosition, IDockviewGroupPanel, IDockviewPanel, SerializedDockview } from 'dockview-react'
import { nanoid } from 'nanoid'
import type { RequiredOnly } from 'nebulosa/src/core/types'
import type { Camera, Device, DeviceType } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'

export type HomeStore = typeof homeStore

const PANEL_TYPES = [
	'about',
	'alpaca',
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
	'galaxy',
	'gps',
	'guideOutput',
	'image',
	'moon',
	'mount',
	'planet',
	'planetarium',
	'power',
	'rotator',
	'satellite',
	'settings',
	'sun',
	'thermometer',
	'tppa',
	'wheel',
] as const

const MAX_PANELS = 100

export type PanelType = (typeof PANEL_TYPES)[number]

export type PanelOptions<P extends object = object> = Readonly<Omit<AddPanelOptions<P> & { index?: number }, 'position' | 'floating' | 'id' | 'component'>>

export interface HomeState {}

export interface StoredHomeLayout {
	readonly schemaVersion: number
	readonly layout: SerializedDockview
}

export interface DevicePanelParams {
	readonly type: DeviceType
	readonly id: string
	readonly name: string
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

const panels: Partial<Record<PanelType, IDockviewPanel[]>> = {}

cameraBus.subscribe('frame', (event) => {
	if (event.path) {
		const camera = equipmentStore.get('camera', event.camera)
		camera && addImage(event.path, camera)
	}
})

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

	// Create Layout

	left = addEdge('left', { initialSize: 380 })
	right = addEdge('right', { initialSize: 480 })

	addUniquePanel('connections', { tabComponent: 'fixed', title: 'Connections' }, left)
	addUniquePanel('devices', { tabComponent: 'fixed', title: 'Devices' }, left)
	addUniquePanel('alpaca', { tabComponent: 'fixed', title: 'Alpaca' }, left)
	addUniquePanel('settings', { tabComponent: 'fixed', title: 'Settings' }, left)
	addUniquePanel('about', { tabComponent: 'fixed', title: 'About' }, left)

	main = addGroup({ id: 'group.main' })

	addUniquePanel('asteroid', { title: 'Asteroid' }, main)

	// layoutDisposable = api.onDidLayoutChange(() => {
	// 	window.clearTimeout(saveTimer)
	// 	saveTimer = window.setTimeout(saveLayout, 1000)
	// })
}

function addEdge(position: EdgeGroupPosition, options: Omit<Readonly<EdgeGroupOptions>, 'id'>) {
	return api!.getEdgeGroup(position) ?? api!.addEdgeGroup(position, { collapsedSize: 38, collapsed: true, ...options, id: `edge.${position}` })
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

function addUniquePanel(type: PanelType, options: PanelOptions, group?: Pick<DockviewGroupPanel, 'id'>) {
	const ps = panels[type] ?? []

	if (ps.length > 0) return ps[0]

	const id = `${type}.0`
	const p = api!.addPanel({ renderer: 'onlyWhenVisible', ...options, id, component: type, position: { referenceGroup: (group ?? main!).id, index: options.index } })
	ps.push(p)
	panels[type] = ps

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

function addMultiplePanel(type: PanelType, options: PanelOptions, group?: Pick<DockviewGroupPanel, 'id'>) {
	const ps = panels[type] ?? []

	if (ps.length >= MAX_PANELS) return

	const referenceGroupId = (group ?? main!)?.id
	let referencePanel: IDockviewPanel | undefined

	for (let i = 0; i < MAX_PANELS; i++) {
		const id = `${type}.${i}`
		const p = ps.find((e) => e.id === id)

		if (p === undefined) {
			const p = api!.addPanel({ renderer: 'onlyWhenVisible', ...options, id, component: type, position: referencePanel && !group?.id ? { referencePanel, direction: 'right' } : { referenceGroup: referenceGroupId } })
			ps.push(p)
			panels[type] = ps

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

function openDevice(device: Device) {
	if (!api) return

	const params: DevicePanelParams = { type: device.type, id: device.id, name: device.name }
	const panel = addMultiplePanel(device.type, { title: device.name, params }, right)

	if (panel === undefined) return

	panel.api.setActive()

	const location = panel.api.location

	if (location.type === 'edge') {
		api.getEdgeGroup(location.position)?.expand()
	}

	return panel
}

function addImage(path: string, source: ImageSource | Camera, id?: string) {
	if (!api) return undefined

	const camera = typeof source === 'object' ? source : undefined
	source = typeof source === 'string' ? source : 'camera'
	id = `${source}-${id || camera?.id || nanoid()}`

	const ps = panels.image ?? []
	let p = ps.find((e) => e.params!.id === id)

	if (p) {
		const image = p.params as Image
		imageBus.emit('update', { image, path })
		return image
	} else {
		const image = { path, id, source, camera }
		const title = image.camera?.name ?? image.path
		p = addMultiplePanel('image', { title, params: image }, main)

		if (p !== undefined) {
			imageBus.emit('add', image)
			return image
		}
	}
}

function closeImage(image: Image) {
	if (!api) return undefined

	const p = panels.image?.find((e) => e.params!.id === image.id)

	if (p) {
		api.removePanel(p)
		p.dispose()
		imageBus.emit('remove', image)
	}
}

function toggleEdge(position: EdgeGroupPosition) {
	api?.setEdgeGroupVisible(position, !api.isEdgeGroupVisible(position))
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
	openDevice,
	addImage,
	closeImage,
} as const
