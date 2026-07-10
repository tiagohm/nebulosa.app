import type { DockviewApi, DockviewIDisposable, DockviewReadyEvent, EdgeGroupPosition, SerializedDockview } from 'dockview-react'
import type { Device, DeviceType } from 'nebulosa/src/devices/indi/device'
import { proxy } from 'valtio'

export type WorkspaceStore = typeof workspaceStore

export interface WorkspaceState {}

export interface StoredWorkspaceLayout {
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

const state = proxy<WorkspaceState>({})

let api: DockviewApi | undefined
let saveTimer: number | undefined
let layoutDisposable: DockviewIDisposable | undefined

function restoreLayout() {
	const serializedLayout = localStorage.getItem(LAYOUT_STORAGE_KEY)
	if (serializedLayout) return JSON.parse(serializedLayout) as StoredWorkspaceLayout
	return undefined
}

function saveLayout() {
	if (api) {
		const storedLayout: StoredWorkspaceLayout = { schemaVersion: LAYOUT_SCHEMA_VERSION, layout: api.toJSON() }
		localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(storedLayout))
	}
}

function handleReady(event: DockviewReadyEvent) {
	api = event.api

	const storedLayout = restoreLayout()

	if (storedLayout) {
		try {
			api.fromJSON(storedLayout.layout)
		} catch (e) {
			console.error('unable to restore layout:', e)
			localStorage.removeItem(LAYOUT_STORAGE_KEY)
		}
	}

	// Initial layout
	const left = api.getEdgeGroup('left') ?? api.addEdgeGroup('left', { id: 'edge.left', initialSize: 320, collapsedSize: 38, collapsed: true })
	const right = api.getEdgeGroup('right') ?? api.addEdgeGroup('right', { id: 'edge.right', initialSize: 480, collapsedSize: 38, collapsed: true })
	const bottom = api.getEdgeGroup('bottom') ?? api.addEdgeGroup('bottom', { id: 'edge.bottom', initialSize: 280, collapsedSize: 38, collapsed: true })

	const connections = api.getPanel('panel.connections') ?? api.addPanel({ id: 'panel.connections', component: 'component.connections', tabComponent: 'tab.fixed', title: 'Connections', position: { referenceGroup: left.id } })
	const devices = api.getPanel('panel.devices') ?? api.addPanel({ id: 'panel.devices', component: 'component.devices', tabComponent: 'tab.fixed', title: 'Devices', position: { referenceGroup: left.id } })

	layoutDisposable = api.onDidLayoutChange(() => {
		window.clearTimeout(saveTimer)
		saveTimer = window.setTimeout(saveLayout, 1000)
	})
}

function mount() {}

function unmount() {
	layoutDisposable?.dispose()
	layoutDisposable = undefined

	window.clearTimeout(saveTimer)
	saveTimer = undefined

	saveLayout()
}

function openDevice(device: Device) {
	if (!api) return

	const id = `panel.device.${device.id}`
	let panel = api.getPanel(id)

	if (!panel) {
		const params: DevicePanelParams = { type: device.type, id: device.id, name: device.name }
		panel = api.addPanel({ id, component: `component.device.${device.type}`, title: device.name, tabComponent: 'tab.closeable', params, position: { referenceGroup: 'edge.right' } })
	}

	panel.api.setActive()

	const location = panel.api.location

	if (location.type === 'edge') {
		api.getEdgeGroup(location.position)?.expand()
	}

	return panel
}

function toggleEdge(position: EdgeGroupPosition) {
	api?.setEdgeGroupVisible(position, !api.isEdgeGroupVisible(position))
}

window.addEventListener('beforeunload', () => {
	saveLayout()
})

export const workspaceStore = {
	state,
	handleReady,
	mount,
	unmount,
	toggleEdge,
	openDevice,
} as const
