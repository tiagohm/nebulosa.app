import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import type { ConnectionEvent, ConnectionStatus } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { deepClone } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { type Connection, DEFAULT_CONNECTION } from '@/shared/types'

export interface ConnectionState {
	show: boolean
	readonly connections: Connection[]
	mode: 'create' | 'edit'
	loading: boolean
	selected?: Connection
	edited?: Connection
	connected?: ConnectionStatus
}

export const ConnectionComparator = (a: Connection, b: Connection) => {
	return (b.connectedAt ?? 0) - (a.connectedAt ?? 0)
}

const state = proxy<ConnectionState>({
	show: false,
	connections: [],
	mode: 'create',
	loading: false,
})

initProxy(state, 'connection', ['p:show', 'o:connections'])
state.connections.sort(ConnectionComparator)

export const ConnectionMolecule = molecule(() => {
	if (state.connections.length === 0) {
		state.connections.push(structuredClone(DEFAULT_CONNECTION))
	}

	state.selected ??= state.connections[0]

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = bus.subscribe<ConnectionEvent>('connection:open', ({ status, reused }) => {
			reused && void list(status)
		})

		unsubscribers[1] = bus.subscribe<ConnectionEvent>('connection:close', ({ status }) => {
			if (state.connected?.id === status.id) {
				state.connected = undefined
			}
		})

		unsubscribers[2] = bus.subscribe('ws:close', () => {
			state.connected = undefined
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function list(connection: ConnectionStatus) {
		const a = Api.Cameras.list(connection).then((cameras) => void cameras?.forEach((camera) => bus.emit('camera:add', camera)))
		const b = Api.Mounts.list(connection).then((mounts) => void mounts?.forEach((mount) => bus.emit('mount:add', mount)))
		const c = Api.Focusers.list(connection).then((focusers) => void focusers?.forEach((focuser) => bus.emit('focuser:add', focuser)))
		const d = Api.Wheels.list(connection).then((wheels) => void wheels?.forEach((wheel) => bus.emit('wheel:add', wheel)))
		const e = Api.Thermometers.list(connection).then((thermometers) => void thermometers?.forEach((thermometer) => bus.emit('thermometer:add', thermometer)))
		const f = Api.GuideOutputs.list(connection).then((guideOutputs) => void guideOutputs?.forEach((guideOutput) => bus.emit('guideOutput:add', guideOutput)))
		const g = Api.Covers.list(connection).then((covers) => void covers?.forEach((cover) => bus.emit('cover:add', cover)))
		const h = Api.FlatPanels.list(connection).then((flatPanels) => void flatPanels?.forEach((flatPanel) => bus.emit('flatPanel:add', flatPanel)))
		const i = Api.DewHeaters.list(connection).then((dewHeaters) => void dewHeaters?.forEach((dewHeater) => bus.emit('dewHeater:add', dewHeater)))
		const j = Api.Rotators.list(connection).then((rotators) => void rotators?.forEach((rotator) => bus.emit('rotator:add', rotator)))
		return Promise.all([a, b, c, d, e, f, g, h, i, j])
	}

	function create() {
		state.mode = 'create'
		state.edited = structuredClone(DEFAULT_CONNECTION)
		state.show = true
	}

	function edit(connection: Connection) {
		state.mode = 'edit'
		state.edited = deepClone(connection)
		state.show = true
	}

	function add(connection: Connection) {
		state.connections.push(connection)
	}

	function duplicate(connection: Connection) {
		const duplicated = deepClone(connection)
		if (duplicated.id === DEFAULT_CONNECTION.id) duplicated.id = Date.now().toFixed(0)
		add(duplicated)
	}

	function update<K extends keyof Connection>(name: K, value: Connection[K]) {
		if (state.edited) {
			state.edited[name] = value
		}
	}

	function select(connection: Connection | string) {
		if (typeof connection === 'string') {
			const selected = state.connections.find((e) => e.id === connection)
			if (selected) state.selected = selected
			else console.warn('unknown connection', connection)
		} else if (state.connections.includes(connection)) {
			state.selected = connection
		} else {
			select(connection.id)
		}
	}

	function save() {
		const { edited } = state

		if (edited) {
			if (edited.id === DEFAULT_CONNECTION.id) {
				// If the edited connection is the default one, we remove it first
				if (state.mode === 'edit') {
					removeOnly(DEFAULT_CONNECTION)
				}

				// Generate a new id for the edited connection
				edited.id = Date.now().toFixed(0)

				// Add the edited connection to the list
				add(edited)

				// Set the edited connection as the selected one
				state.selected = edited
			} else {
				const index = state.connections.findIndex((e) => e.id === edited.id)

				if (index >= 0) {
					state.connections[index] = edited
				}
			}

			state.show = false
		}
	}

	function removeOnly(connection: Connection) {
		const { connections } = state
		const index = connections.findIndex((e) => e.id === connection.id)
		if (index < 0) return false
		connections.splice(index, 1)
		return true
	}

	function remove(connection: Connection) {
		if (!removeOnly(connection)) return

		const { connections } = state

		if (connections.length === 0) {
			connections.push(structuredClone(DEFAULT_CONNECTION))
			state.selected = connections[0]
		} else if (state.selected?.id === connection.id) {
			state.selected = connections[0]
		}
	}

	async function connect() {
		if (state.connected) {
			void Api.Connections.disconnect(state.connected.id)
			state.connected = undefined
		} else if (state.selected) {
			try {
				state.loading = true

				const status = await Api.Connections.connect(state.selected)

				if (status) {
					state.connected = status
					state.selected.connectedAt = Date.now()
				}
			} finally {
				state.loading = false
			}
		}
	}

	function hide() {
		state.show = false
	}

	return { state, create, edit, update, select, save, connect, duplicate, remove, hide } as const
})
