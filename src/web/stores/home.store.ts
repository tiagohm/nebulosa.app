import { cameraBus, imageBus } from '@shared/bus'
import type { Image, ImageSource } from '@shared/types'
import { equipmentStore } from '@stores/equipment.store'
import type { DockviewApi, DockviewIDisposable, DockviewReadyEvent, EdgeGroupPosition, SerializedDockview } from 'dockview-react'
import { nanoid } from 'nanoid'
import type { Camera, Device, DeviceType } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'

export type HomeStore = typeof homeStore

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

let api: DockviewApi | undefined
let saveTimer: number | undefined
let layoutDisposable: DockviewIDisposable | undefined

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

	const storedLayout = restoreLayout()

	if (storedLayout) {
		try {
			// api.fromJSON(storedLayout.layout)
		} catch (e) {
			console.error('unable to restore layout:', e)
			localStorage.removeItem(LAYOUT_STORAGE_KEY)
		}
	}

	// Initial layout
	const left = api.getEdgeGroup('left') ?? api.addEdgeGroup('left', { id: 'edge.left', initialSize: 380, collapsedSize: 38, collapsed: true })
	const right = api.getEdgeGroup('right') ?? api.addEdgeGroup('right', { id: 'edge.right', initialSize: 480, collapsedSize: 38, collapsed: true })

	const connections = api.getPanel('panel.connections') ?? api.addPanel({ id: 'panel.connections', component: 'component.connections', tabComponent: 'tab.fixed', title: 'Connections', position: { referenceGroup: left.id } })
	const devices = api.getPanel('panel.devices') ?? api.addPanel({ id: 'panel.devices', component: 'component.devices', tabComponent: 'tab.fixed', title: 'Devices', position: { referenceGroup: left.id } })

	const images = api.getGroup('group.images') ?? api.addGroup({ id: 'group.images', direction: 'within' })
	const planetarium = api.addPanel({ id: 'panel.planetarium', component: 'component.planetarium', tabComponent: 'tab.fixed', title: 'Planetarium', position: { referenceGroup: images.id } })
	const sun = api.addPanel({ id: 'panel.atlas.sun', component: 'component.atlas.sun', tabComponent: 'tab.fixed', title: 'Sun', position: { referenceGroup: images.id } })
	const moon = api.addPanel({ id: 'panel.atlas.moon', component: 'component.atlas.moon', tabComponent: 'tab.fixed', title: 'Moon', position: { referenceGroup: images.id } })
	const planet = api.addPanel({ id: 'panel.atlas.planet', component: 'component.atlas.planet', tabComponent: 'tab.fixed', title: 'Planet', position: { referenceGroup: images.id } })
	const asteroid = api.addPanel({ id: 'panel.atlas.asteroid', component: 'component.atlas.asteroid', tabComponent: 'tab.fixed', title: 'Asteroid', position: { referenceGroup: images.id } })
	const galaxy = api.addPanel({ id: 'panel.atlas.galaxy', component: 'component.atlas.galaxy', tabComponent: 'tab.fixed', title: 'Galaxy', position: { referenceGroup: images.id } })
	const satellite = api.addPanel({ id: 'panel.atlas.satellite', component: 'component.atlas.satellite', tabComponent: 'tab.fixed', title: 'Satellite', position: { referenceGroup: images.id } })
	const calculator = api.addPanel({ id: 'panel.calculator', component: 'component.calculator', tabComponent: 'tab.fixed', title: 'Calculator', position: { referenceGroup: images.id } })
	const darv = api.addPanel({ id: 'panel.darv', component: 'component.darv', tabComponent: 'tab.fixed', title: 'DARV', params: { id: nanoid() }, position: { referenceGroup: images.id } })
	const tppa = api.addPanel({ id: 'panel.tppa', component: 'component.tppa', tabComponent: 'tab.fixed', title: 'TPPA', params: { id: nanoid() }, position: { referenceGroup: images.id } })
	const flatWizard = api.addPanel({ id: 'panel.flatwizard', component: 'component.flatwizard', tabComponent: 'tab.fixed', title: 'Flat Wizard', params: { id: nanoid() }, position: { referenceGroup: images.id } })
	const autoFocus = api.addPanel({ id: 'panel.autofocus', component: 'component.autofocus', tabComponent: 'tab.fixed', title: 'Auto Focus', params: { id: nanoid() }, position: { referenceGroup: images.id } })

	// layoutDisposable = api.onDidLayoutChange(() => {
	// 	window.clearTimeout(saveTimer)
	// 	saveTimer = window.setTimeout(saveLayout, 1000)
	// })
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

	const id = `panel.device.${device.id}`
	let panel = api.getPanel(id)

	if (!panel) {
		const params: DevicePanelParams = { type: device.type, id: device.id, name: device.name }
		panel = api.addPanel({ id, component: `component.device.${device.type}`, title: device.name, params, position: { referenceGroup: 'edge.right' } })
	}

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
	const panelId = `panel.image.${id}`

	const panel = api.getPanel(panelId)

	if (panel) {
		const image = panel.params as Image
		imageBus.emit('update', { image, path })
		return image
	} else {
		const images = api.getGroup('group.images') ?? api.addGroup({ id: 'group.images', direction: 'within', locked: true })

		const image = { path, id, source, camera }
		const title = image.camera?.name ?? image.path
		const panel = api.addPanel({ id: panelId, component: 'component.images', title, params: image, position: { referenceGroup: images.id } })

		imageBus.emit('add', image)

		return image
	}
}

function closeImage(image: Image) {
	if (!api) return undefined

	const id = `panel.image.${image.id}`
	const panel = api.getPanel(id)

	if (panel) {
		api.removePanel(panel)
		panel.dispose()
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
