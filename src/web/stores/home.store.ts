import { cameraBus, imageBus } from '@shared/bus'
import type { Image, ImageSource } from '@shared/types'
import { dockviewStore } from '@stores/dockview.store'
import { equipmentStore } from '@stores/equipment.store'
import type { AutoFocusParams } from '@ui/AutoFocus'
import type { DarvParams } from '@ui/Darv'
import type { FlatWizardParams } from '@ui/FlatWizard'
import type { TppaParams } from '@ui/Tppa'
import type { DockviewApi, DockviewGroupPanel, DockviewGroupPanelApi, DockviewReadyEvent, IDockviewGroupPanel, IDockviewPanel } from 'dockview-react'
import { nanoid } from 'nanoid'
import type { Camera, Device } from 'nebulosa/src/devices/indi/device'

export type HomeStore = typeof homeStore

export type HomePanelType =
	| 'about'
	| 'alpacaServer'
	| 'asteroid'
	| 'autoFocus'
	| 'calculator'
	| 'camera'
	| 'connections'
	| 'cover'
	| 'darv'
	| 'devices'
	| 'dewHeater'
	| 'dome'
	| 'flatPanel'
	| 'flatWizard'
	| 'focuser'
	| 'framing'
	| 'galaxy'
	| 'gps'
	| 'guideOutput'
	| 'guider'
	| 'image'
	| 'indiServer'
	| 'lunarEclipse'
	| 'moon'
	| 'mount'
	| 'planet'
	| 'planetarium'
	| 'power'
	| 'rotator'
	| 'satellite'
	| 'settings'
	| 'solarEclipse'
	| 'sun'
	| 'thermometer'
	| 'tppa'
	| 'wheel'

const panels: Record<HomePanelType, IDockviewPanel[]> = {
	about: [],
	alpacaServer: [],
	asteroid: [],
	autoFocus: [],
	calculator: [],
	camera: [],
	connections: [],
	cover: [],
	darv: [],
	devices: [],
	dewHeater: [],
	dome: [],
	flatPanel: [],
	flatWizard: [],
	focuser: [],
	framing: [],
	galaxy: [],
	gps: [],
	guideOutput: [],
	guider: [],
	image: [],
	indiServer: [],
	lunarEclipse: [],
	moon: [],
	mount: [],
	planet: [],
	planetarium: [],
	power: [],
	rotator: [],
	satellite: [],
	settings: [],
	solarEclipse: [],
	sun: [],
	thermometer: [],
	tppa: [],
	wheel: [],
}

const dockview = dockviewStore(panels, { layoutSchemaVersion: 1, layoutStorageKey: 'home.workspace.layout' })

let api: DockviewApi
let left: DockviewGroupPanelApi
let right: DockviewGroupPanelApi
let main: DockviewGroupPanel | IDockviewGroupPanel

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

	save()
	dockview.unregisterOnDidLayoutChange()

	mounted = false
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
	left = dockview.addEdge(api, 'left', { initialSize: 380 })
	right = dockview.addEdge(api, 'right', { initialSize: 420 })

	if (!hasDevicePanels()) right.collapse()

	// Left Panel
	dockview.addSinglePanel(api, 'connections', { tabComponent: 'fixed', title: 'Connections' }, left, false)
	dockview.addSinglePanel(api, 'devices', { tabComponent: 'fixed', title: 'Devices' }, left, false)
	dockview.addSinglePanel(api, 'alpacaServer', { tabComponent: 'fixed', title: 'Alpaca Server' }, left, false)
	dockview.addSinglePanel(api, 'indiServer', { tabComponent: 'fixed', title: 'INDI Server' }, left, false)
	dockview.addSinglePanel(api, 'settings', { tabComponent: 'fixed', title: 'Settings' }, left, false)
	dockview.addSinglePanel(api, 'about', { tabComponent: 'fixed', title: 'About' }, left, false)

	// Center Panel
	main = dockview.addGroup(api, { id: 'group.main' })

	// Atlas
	dockview.addSinglePanel(api, 'sun', { title: 'Sun' }, main)
	dockview.addSinglePanel(api, 'moon', { title: 'Moon' }, main, false)
	dockview.addSinglePanel(api, 'planet', { title: 'Planet' }, main, false)
	dockview.addSinglePanel(api, 'asteroid', { title: 'Asteroid' }, main, false)
	dockview.addSinglePanel(api, 'galaxy', { title: 'DSO' }, main, false)
	dockview.addSinglePanel(api, 'satellite', { title: 'Satellite' }, main, false)

	dockview.registerOnDidLayoutChange(api)
}

function load() {
	dockview.load(api, (type) => type !== 'image')
}

function addDevice(device: Device) {
	const devicePanels = panels[device.type] ?? []
	const panel = devicePanels.find((e) => e.params!.id === device.id)

	if (panel) {
		dockview.activatePanel(api, panel)
		return panel
	}

	const params = { type: device.type, id: device.id, name: device.name } as const satisfies Pick<Device, 'id' | 'type' | 'name'>
	return dockview.addMultiplePanel(api, device.type, { title: device.name, params }, right)
}

function addImage(path: string, source: ImageSource | Camera, id?: string) {
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
		panel = dockview.addMultiplePanel(api, 'image', { title, params: image, tabComponent: 'image' }, main)

		if (panel !== undefined) {
			imageBus.emit('add', image)
			return image
		}
	}
}

function removeImage(image: Image) {
	const panel = panels.image?.find((e) => e.params!.id === image.id)

	if (panel) {
		api.removePanel(panel)
		panel.dispose()
		imageBus.emit('remove', image)
	}
}

function addAutoFocus() {
	const params: AutoFocusParams = { id: nanoid() }
	return dockview.addMultiplePanel(api, 'autoFocus', { title: 'Auto Focus', params }, main)
}

function addCalculator() {
	return dockview.addSinglePanel(api, 'calculator', { title: 'Calculator' }, main)
}

function addDarv() {
	const params: DarvParams = { id: nanoid() }
	return dockview.addMultiplePanel(api, 'darv', { title: 'DARV', params }, main)
}

function addFlatWizard() {
	const params: FlatWizardParams = { id: nanoid() }
	return dockview.addMultiplePanel(api, 'flatWizard', { title: 'Flat Wizard', params }, main)
}

function addFraming() {
	return dockview.addSinglePanel(api, 'framing', { title: 'Framing' }, main)
}

function addSolarEclipse() {
	return dockview.addSinglePanel(api, 'solarEclipse', { title: 'Solar Eclipse' }, main)
}

function addLunarEclipse() {
	return dockview.addSinglePanel(api, 'lunarEclipse', { title: 'Lunar Eclipse' }, main)
}

function addGuider() {
	return dockview.addSinglePanel(api, 'guider', { title: 'Guider' }, main)
}

function addTppa() {
	const params: TppaParams = { id: nanoid() }
	return dockview.addMultiplePanel(api, 'tppa', { title: 'TPPA', params }, main)
}

function addPlanetarium() {
	return dockview.addSinglePanel(api, 'planetarium', { title: 'Planetarium' }, main)
}

function addSun() {
	dockview.addSinglePanel(api, 'sun', { title: 'Sun' }, main)
}

function addMoon() {
	dockview.addSinglePanel(api, 'moon', { title: 'Moon' }, main)
}

function addPlanet() {
	dockview.addSinglePanel(api, 'planet', { title: 'Planet' }, main)
}

function addAsteroid() {
	dockview.addSinglePanel(api, 'asteroid', { title: 'Asteroid' }, main)
}

function addDSO() {
	dockview.addSinglePanel(api, 'galaxy', { title: 'DSO' }, main)
}

function addSatellite() {
	dockview.addSinglePanel(api, 'satellite', { title: 'Satellite' }, main)
}

function save() {
	dockview.saveLayout(api)
}

window.addEventListener('beforeunload', save)

export const homeStore = {
	dockview,
	handleReady,
	mount,
	unmount,
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
