import { createScope, molecule, onMount } from 'bunshi'
import type { DirectoryEntry, FileEntry } from 'src/shared/types'
import { proxy } from 'valtio'
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
	createDirectory: boolean
	directoryName: string
	readonly mode: FilePickerMode
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

	const state = proxy<FilePickerState>({
		path: scope.path ?? '',
		entries: [],
		directoryTree: [],
		filtered: [],
		selected: [],
		history: [],
		filter: '',
		createDirectory: false,
		directoryName: '',
		mode: scope.mode ?? 'file',
	})

	onMount(() => {
		void list()
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
		const directory = await Api.FileSystem.list({ path: state.path, filter: scope.filter, directoryOnly: state.mode === 'directory' })

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
		state.createDirectory = !state.createDirectory
	}

	async function createDirectory() {
		if (state.directoryName) {
			const directory = await Api.FileSystem.create({ path: state.path, name: state.directoryName })

			if (directory?.path) {
				state.createDirectory = false
				state.directoryName = ''
				await list()
			}
		}
	}

	function select(path: string) {
		const entry = state.entries.find((e) => e.path === path)

		if (!entry) return

		if (state.mode !== 'directory' && entry.directory) {
			void navigateTo(entry)
			return
		}

		const index = state.selected.indexOf(path)

		if (index >= 0) {
			state.selected.splice(index, 1)
		} else if (scope.multiple || state.selected.length === 0) {
			state.selected.push(path)
		} else {
			state.selected[0] = path
		}
	}

	function unselectAll(event?: React.PointerEvent<Element>) {
		event?.stopPropagation()
		state.selected.length = 0
	}

	return { state, filter, list, navigateTo, navigateBack, navigateToParent, toggleCreateDirectory, createDirectory, select, unselectAll } as const
})
