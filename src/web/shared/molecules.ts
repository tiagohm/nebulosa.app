import type { FilePickerMode } from '@/ui/FilePicker'
import { ComponentScope, createScope, molecule, onMount } from 'bunshi'
import type { Key } from 'react'
import { DEFAULT_IMAGE_TRANSFORMATION, type DirectoryEntry, type FileEntry, type ImageInfo, type ImageTransformation } from 'src/api/types'
import { proxy, subscribe } from 'valtio'
import { deepClone } from 'valtio/utils'
import { Api } from './api'
import { simpleLocalStorage } from './storage'
import { type Connection, DEFAULT_CONNECTION, type Image } from './types'

export interface ConnectionState {
	readonly connections: Connection[]
	selected: Connection
	edited?: Connection
	connected?: Connection
}

export interface ImageState {
	readonly transformation: ImageTransformation
	crosshair: boolean
	rotation: number
	url?: string
	info?: ImageInfo
}

export interface HomeState {
	readonly images: Image[]
	openImageLastPath: string
}

export interface FilePickerScopeValue {
	path?: string
	filter?: string
	mode?: FilePickerMode
	multiple?: boolean
}

export interface FilePickerState {
	path: string
	readonly entries: FileEntry[]
	readonly directoryTree: DirectoryEntry[]
	readonly filtered: FileEntry[]
	readonly selected: Key[]
	readonly history: string[]
	filter: string
	createDirectory: boolean
	directoryName: string
	readonly mode: FilePickerMode
}

export const ConnectionComparator = (a: Connection, b: Connection) => {
	return (a.connectedAt ?? 0) - (b.connectedAt ?? 0)
}

export const ConnectionMolecule = molecule(() => {
	const connections = simpleLocalStorage.get('connections', () => [structuredClone(DEFAULT_CONNECTION)])
	connections.sort(ConnectionComparator)

	const state = proxy<ConnectionState>({
		connections,
		selected: connections[0],
	})

	onMount(() => {
		const unsubscribe = subscribe(state.connections, () => {
			simpleLocalStorage.set('connections', state.connections)
		})

		return () => unsubscribe()
	})

	function create() {
		state.edited = deepClone(DEFAULT_CONNECTION)
	}

	function edit(connection: Connection) {
		state.edited = deepClone(connection)
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

	function select(connection: Connection) {
		state.selected = connection
	}

	function selectWith(id: string) {
		const selected = state.connections.find((c) => c.id === id)
		selected && select(selected)
	}

	function save() {
		const { edited } = state

		if (edited) {
			if (edited.id === DEFAULT_CONNECTION.id) {
				removeOnly(DEFAULT_CONNECTION)
				edited.id = Date.now().toFixed(0)
				add(edited)
				state.selected = edited
			} else {
				const index = state.connections.findIndex((e) => e.id === edited.id)

				if (index >= 0) {
					state.connections[index] = edited
				}
			}
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
		} else if (state.selected.id === connection.id) {
			state.selected = connections[0]
		}
	}

	function connect() {
		if (state.connected) {
			state.connected = undefined
		} else {
			state.connected = state.selected
		}
	}

	return { state, create, edit, update, select, selectWith, save, connect, add, duplicate, remove } as const
})

export const ImageMolecule = molecule((mol, scope) => {
	scope(ComponentScope)

	const home = mol(HomeMolecule)
	const state = proxy<ImageState>({
		transformation: simpleLocalStorage.get('image.transformation', () => structuredClone(DEFAULT_IMAGE_TRANSFORMATION)),
		crosshair: simpleLocalStorage.get('image.crosshair', false),
		rotation: simpleLocalStorage.get('image.rotation', 0),
	})

	onMount(() => {
		const unsubscribe = subscribe(state, () => {
			simpleLocalStorage.set('image.transformation', state.transformation)
			simpleLocalStorage.set('image.crosshair', state.crosshair)
			simpleLocalStorage.set('image.rotation', state.rotation)
		})

		return () => unsubscribe()
	})

	function toggleHorizontalMirror() {
		state.transformation.horizontalMirror = !state.transformation.horizontalMirror
	}

	function toggleVerticalMirror() {
		state.transformation.verticalMirror = !state.transformation.verticalMirror
	}

	function toggleInvert() {
		state.transformation.invert = !state.transformation.invert
	}

	function toggleCrosshair() {
		state.crosshair = !state.crosshair
	}

	function refresh(url: string, info: ImageInfo) {
		state.url = url
		state.info = info
	}

	function close(image: Image | string) {
		home.removeImage(image)
	}

	return { state, toggleHorizontalMirror, toggleVerticalMirror, toggleInvert, toggleCrosshair, refresh, close }
})

export const HomeMolecule = molecule(() => {
	const state = proxy<HomeState>({
		openImageLastPath: simpleLocalStorage.get('image.path', ''),
		images: [],
	})

	function addImage(path: string) {
		const key = `${path}:${Date.now()}`
		const index = state.images.length === 0 ? 0 : Math.max(...state.images.map((e) => e.index))
		state.images.push({ path, key, index })
		state.openImageLastPath = path
		simpleLocalStorage.set('image.path', path)
	}

	function removeImage(image: Image | string) {
		const key = typeof image === 'string' ? image : image.key
		const index = state.images.findIndex((e) => e.key === key)
		index >= 0 && state.images.splice(index, 1)
	}

	return { state, addImage, removeImage }
})

export const FilePickerScope = createScope<FilePickerScopeValue>({})

export const FilePickerMolecule = molecule((mol, scope) => {
	const value = scope(FilePickerScope)

	const state = proxy<FilePickerState>({
		path: value.path ?? '',
		entries: [],
		directoryTree: [],
		filtered: [],
		selected: [],
		history: [],
		filter: '',
		createDirectory: false,
		directoryName: '',
		mode: value.mode ?? 'file',
	})

	onMount(() => {
		list()
	})

	function filter(text?: string) {
		if (text !== undefined) state.filter = text

		state.filtered.splice(0)

		if (state.filter.trim().length === 0) {
			state.filtered.push(...state.entries)
		} else {
			const text = state.filter.toLowerCase()
			state.filtered.push(...state.entries.filter((e) => e.name.toLowerCase().includes(text)))
		}
	}

	async function list() {
		const { entries, tree } = await Api.FileSystem.list({ path: state.path, filter: value.filter, directoryOnly: state.mode === 'directory' })

		state.entries.splice(0)
		state.entries.push(...entries)
		filter()
		state.directoryTree.splice(0)
		state.directoryTree.push(...tree)
	}

	function navigateTo(entry: DirectoryEntry) {
		state.history.push(state.path)
		state.path = entry.path
		list()
	}

	function navigateBack() {
		if (state.history.length === 0) return
		state.path = state.history.pop()!
		list()
	}

	function navigateToParent() {
		if (state.directoryTree.length <= 1) return
		navigateTo(state.directoryTree[state.directoryTree.length - 2])
	}

	function toggleCreateDirectory() {
		state.createDirectory = !state.createDirectory
	}

	async function createDirectory() {
		if (state.directoryName) {
			const { path } = await Api.FileSystem.create({ path: state.path, name: state.directoryName })

			if (path) {
				state.createDirectory = false
				state.directoryName = ''
				list()
			}
		}
	}

	function select(path: Key) {
		const entry = state.entries.find((e) => e.path === path)

		if (!entry) return

		if (state.mode !== 'directory' && entry.directory) {
			navigateTo(entry)
			return
		}

		const index = state.selected.indexOf(path)

		if (index >= 0) {
			state.selected.splice(index, 1)
		} else if (value.multiple || state.selected.length === 0) {
			state.selected.push(path)
		} else {
			state.selected[0] = path
		}
	}

	return { state, filter, list, navigateTo, navigateBack, navigateToParent, toggleCreateDirectory, createDirectory, select }
})
