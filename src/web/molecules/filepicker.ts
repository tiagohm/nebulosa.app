import { createScope, molecule, onMount } from 'bunshi'
import { unsubscribe } from 'src/shared/bus'
import type { DirectoryEntry, FileEntry } from 'src/shared/types'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import type { FilePickerMode } from '@/shared/types'

export interface FilePickerState {
	path: string
	readonly entries: FileEntry[]
	readonly directoryTree: DirectoryEntry[]
	readonly filtered: FileEntry[]
	readonly selected: string[]
	readonly history: string[]
	filter: string
	readonly mode: FilePickerMode
	readonly directory: {
		create: boolean
		name: string
	}
	readonly save: {
		name: string
		alreadyExists: boolean
	}
}

export interface FilePickerScopeValue {
	readonly path?: string
	readonly filter?: string
	readonly mode?: FilePickerMode
	readonly multiple?: boolean
}

export const FilePickerScope = createScope<FilePickerScopeValue>({})

export const FilePickerMolecule = molecule((m, s) => {
	const scope = s(FilePickerScope)

	const multiple = !!scope.multiple && scope.mode !== 'save'

	const state = proxy<FilePickerState>({
		path: scope.path ?? '',
		entries: [],
		directoryTree: [],
		filtered: [],
		selected: [],
		history: [],
		filter: '',
		mode: scope.mode ?? 'file',
		directory: {
			create: false,
			name: '',
		},
		save: {
			name: '',
			alreadyExists: false,
		},
	})

	onMount(() => {
		void list()

		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = subscribeKey(state.save, 'name', async (name) => {
			state.save.alreadyExists = name.length > 0 && !!(await Api.FileSystem.exists({ path: state.path, name }))
		})

		unsubscribers[1] = subscribeKey(state, 'path', async (path) => {
			state.save.alreadyExists = path.length > 0 && !!(await Api.FileSystem.exists({ path, name: state.save.name }))
		})

		return () => {
			unsubscribe(unsubscribers)
		}
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
		const directory = await Api.FileSystem.list({ path: state.path, filter: scope.filter, directoryOnly: state.mode !== 'file' })

		if (directory) {
			state.entries.splice(0)
			state.entries.push(...directory.entries)
			filter()
			state.directoryTree.splice(0)
			state.directoryTree.push(...directory.tree)
		}
	}

	function navigateTo(entry: DirectoryEntry) {
		if (state.history.length === 0 || state.history[state.history.length - 1] !== state.path) {
			state.history.push(state.path)
		}

		state.path = entry.path
		return list()
	}

	function navigateBack() {
		if (state.history.length === 0) return
		state.path = state.history.pop()!
		return list()
	}

	function navigateToParent() {
		if (state.directoryTree.length <= 1) return
		void navigateTo(state.directoryTree[state.directoryTree.length - 2])
	}

	function toggleCreateDirectory() {
		state.directory.create = !state.directory.create
	}

	async function createDirectory() {
		if (state.directory.name) {
			const directory = await Api.FileSystem.create({ path: state.path, name: state.directory.name })

			if (directory?.path) {
				state.directory.create = false
				state.directory.name = ''
				await list()
			}
		}
	}

	function select(path: React.Key) {
		if (typeof path !== 'string') return

		const entry = state.entries.find((e) => e.path === path)

		if (!entry) return

		if (state.mode !== 'directory' && entry.directory) {
			return navigateTo(entry)
		}

		const index = state.selected.indexOf(path)

		if (index >= 0) {
			state.selected.splice(index, 1)
		} else if (multiple || state.selected.length === 0) {
			state.selected.push(path)
		} else {
			state.selected[0] = path
		}
	}

	function unselectAll(event?: React.PointerEvent<Element>) {
		event?.stopPropagation()
		state.selected.length = 0
	}

	function updateSave(name: string) {
		state.save.name = name
	}

	return { state, filter, list, navigateTo, navigateBack, navigateToParent, toggleCreateDirectory, createDirectory, select, unselectAll, updateSave } as const
})
