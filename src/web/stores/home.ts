import { simpleLocalStorage } from '@/shared/storage'
import { type Connection, DEFAULT_CONNECTION, DEFAULT_IMAGE_TRANSFORMATION, type Image } from '@/shared/types'
import { proxy, subscribe } from 'valtio'

export interface HomeState {
	readonly images: Record<string, Image>
	readonly connections: Connection[]
	readonly connection: {
		selected: Connection
		connected?: Connection
		edited?: Connection
	}
}

export class HomeStore {
	readonly state: HomeState

	constructor() {
		const connections = simpleLocalStorage.get('connections', [structuredClone(DEFAULT_CONNECTION)])

		this.state = proxy({
			images: {},
			connections,
			connection: {
				selected: connections[0],
			},
		})

		subscribe(this.state.connections, () => simpleLocalStorage.set('connections', this.state.connections))
	}

	addImage(path: string) {
		const key = `${path}:${Date.now()}`
		const transformation = simpleLocalStorage.get('image.transformation', structuredClone(DEFAULT_IMAGE_TRANSFORMATION))
		const index = Math.max(0, Math.max(...Object.keys(this.state.images).map((e) => this.state.images[e].index)))
		this.state.images[key] = { path, key, transformation, index }
	}

	removeImage(image: Image) {
		delete this.state.images[image.key]
	}

	addConnection(connection: Connection) {
		this.state.connections.push(connection)
	}

	saveConnection() {
		const { edited } = this.state.connection

		if (edited) {
			if (edited.id === DEFAULT_CONNECTION.id) {
				this.removeConnectionById(DEFAULT_CONNECTION.id)
				edited.id = Date.now().toFixed(0)
				this.addConnection(edited)
				this.state.connection.selected = edited
			} else {
				const index = this.state.connections.findIndex((e) => e.id === edited.id)

				if (index >= 0) {
					this.state.connections[index] = edited
				}
			}
		}
	}

	removeConnectionById(id: string) {
		const { connections } = this.state
		const index = connections.findIndex((e) => e.id === id)
		index >= 0 && connections.splice(index, 1)
	}

	removeConnection(connection: Connection) {
		const { connections } = this.state

		this.removeConnectionById(connection.id)

		if (connections.length === 0) {
			connections.push(structuredClone(DEFAULT_CONNECTION))
			this.state.connection.selected = connections[0]
		} else if (this.state.connection.selected.id === connection.id) {
			this.state.connection.selected = connections[0]
		}
	}

	connect() {
		const { connection } = this.state

		if (connection.connected) {
			connection.connected = undefined
		} else {
			connection.connected = connection.selected
		}
	}
}

export const homeStore = new HomeStore()
export const homeState = homeStore.state
