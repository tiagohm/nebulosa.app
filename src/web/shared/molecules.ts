import type { FilePickerMode } from '@/ui/FilePicker'
import { addToast } from '@heroui/react'
import { createScope, molecule, onMount } from 'bunshi'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import type { DirectoryEntry, FileEntry, ImageInfo, ImageTransformation, StarDetection } from 'src/api/types'
import { DEFAULT_IMAGE_TRANSFORMATION, DEFAULT_STAR_DETECTION } from 'src/api/types'
import { proxy, subscribe } from 'valtio'
import { deepClone } from 'valtio/utils'
import { Api } from './api'
import type { UseDraggableModalResult } from './hooks'
import { PanZoom, type PanZoomOptions } from './panzoom'
import { simpleLocalStorage } from './storage'
import { type Connection, DEFAULT_CONNECTION } from './types'

export interface ConnectionState {
	readonly connections: Connection[]
	loading: boolean
	selected: Connection
	edited?: Connection
	connected?: Connection
}

export interface Image {
	readonly key: string
	readonly index: number
	readonly path: string
}

export interface ImageWorkspaceState {
	selected?: Image
}

export interface ImageViewerScopeValue {
	readonly image: Image
}

export interface ImageState {
	readonly transformation: ImageTransformation
	crosshair: boolean
	rotation: number
	info?: ImageInfo
	readonly starDetection: {
		show: boolean
		loading: boolean
		stars: DetectedStar[]
		selected?: DetectedStar
		request: StarDetection
		computed: {
			hfd: number
			snr: number
			fluxMin: number
			fluxMax: number
		}
	}
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
	readonly selected: string[]
	readonly history: string[]
	filter: string
	createDirectory: boolean
	directoryName: string
	readonly mode: FilePickerMode
}

export interface CachedImage {
	url: string
	panZoom?: PanZoom
	state: ImageState
	destroy?: () => void
}

export const ConnectionComparator = (a: Connection, b: Connection) => {
	return (a.connectedAt ?? 0) - (b.connectedAt ?? 0)
}

export const ConnectionMolecule = molecule(() => {
	const connections = simpleLocalStorage.get('connections', () => [structuredClone(DEFAULT_CONNECTION)])
	connections.sort(ConnectionComparator)

	const state = proxy<ConnectionState>({
		connections,
		loading: false,
		selected: connections[0],
	})

	onMount(() => {
		const unsubscribe = subscribe(state.connections, () => {
			simpleLocalStorage.set('connections', state.connections)
		})

		return () => unsubscribe()
	})

	function create(modal: UseDraggableModalResult) {
		state.edited = deepClone(DEFAULT_CONNECTION)
		modal.show()
	}

	function edit(connection: Connection, modal: UseDraggableModalResult) {
		state.edited = deepClone(connection)
		modal.show()
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

	function save(modal: UseDraggableModalResult) {
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

			modal.close()
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

	return { state, create, edit, update, select, selectWith, save, connect, duplicate, remove } as const
})

export const ImageWorkspaceMolecule = molecule((mol, scope) => {
	const state = proxy<ImageWorkspaceState>({})

	return { state }
})

const imageCache = new Map<string, CachedImage>()

export const ImageViewerScope = createScope<ImageViewerScopeValue>({ image: { key: '', path: '', index: 0 } })

export const ImageViewerMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)

	const home = m(HomeMolecule)
	const workspace = m(ImageWorkspaceMolecule)
	const { key, index, path } = scope.image

	const transformation = simpleLocalStorage.get('image.transformation', () => structuredClone(DEFAULT_IMAGE_TRANSFORMATION))
	const starDetectionRequest = simpleLocalStorage.get('image.starDetection', () => structuredClone(DEFAULT_STAR_DETECTION))

	starDetectionRequest.path = path

	const state =
		imageCache.get(key)?.state ??
		proxy<ImageState>({
			transformation,
			crosshair: simpleLocalStorage.get('image.crosshair', false),
			rotation: simpleLocalStorage.get('image.rotation', 0),
			starDetection: {
				show: false,
				loading: false,
				stars: [],
				request: starDetectionRequest,
				computed: {
					hfd: 0,
					snr: 0,
					fluxMin: 0,
					fluxMax: 0,
				},
			},
		})

	let loading = false
	let currentImage: HTMLImageElement | undefined

	onMount(() => {
		// TODO: Subcribe individuallly
		const unsubscribe = subscribe(state, () => {
			simpleLocalStorage.set('image.transformation', state.transformation)
			simpleLocalStorage.set('image.crosshair', state.crosshair)
			simpleLocalStorage.set('image.rotation', state.rotation)
			simpleLocalStorage.set('image.starDetection', state.starDetection.request)
		})

		return () => {
			unsubscribe()
		}
	})

	function toggleAutoStretch() {
		state.transformation.stretch.auto = !state.transformation.stretch.auto
		return load(true)
	}

	function toggleDebayer() {
		state.transformation.debayer = !state.transformation.debayer
		return load(true)
	}

	function toggleHorizontalMirror() {
		state.transformation.horizontalMirror = !state.transformation.horizontalMirror
		return load(true)
	}

	function toggleVerticalMirror() {
		state.transformation.verticalMirror = !state.transformation.verticalMirror
		return load(true)
	}

	function toggleInvert() {
		state.transformation.invert = !state.transformation.invert
		return load(true)
	}

	function toggleCrosshair() {
		state.crosshair = !state.crosshair
	}

	function toggleDetectedStars(enabled?: boolean) {
		state.starDetection.show = enabled ?? !state.starDetection.show
	}

	// Removes the image
	function remove() {
		home.removeImage(scope.image)
	}

	// Loads the image from path
	async function load(force: boolean = false, image?: HTMLImageElement) {
		console.info('loading image', key, loading)

		if (loading) return

		if (image) currentImage = image

		const cached = imageCache.get(key)

		// Not loaded yet or forced to load
		if (!cached || force) {
			await open(image)
		} else {
			// Load the image from cache
			image ??= currentImage ?? (document.getElementById(key) as HTMLImageElement | undefined)

			if (image) {
				currentImage = image
				image.src = cached.url
				console.info('image loaded from cache', key, cached.url)
			} else {
				console.warn('image not mounted yet', key)
			}
		}
	}

	// Opens the image from path and save it into cache
	async function open(image?: HTMLImageElement) {
		try {
			loading = true

			console.info('opening image', key, index, path)

			// Load the image
			const { blob, info } = await Api.Image.open({ path: scope.image.path, transformation: state.transformation })
			const url = URL.createObjectURL(blob)

			// Update the state
			state.info = info

			// Add the image to cache
			const cached = imageCache.get(key)

			if (cached) {
				URL.revokeObjectURL(cached.url)

				cached.url = url
			} else {
				imageCache.set(key, { url, state })
			}

			image ??= currentImage ?? (document.getElementById(key) as HTMLImageElement | undefined)

			if (image) {
				image.src = url
				console.info('image loaded', key, url)
			} else {
				console.warn('image not mounted yet', key)
			}

			return url
		} catch (e) {
			console.error('failed to open image', key, e)
		} finally {
			loading = false
		}
	}

	function select(e: HTMLImageElement) {
		workspace.state.selected = scope.image
		bringToFront(e)
	}

	// Attaches the PanZoom and other things to image
	function attach(e?: HTMLImageElement) {
		const image = e ?? (document.getElementById(key) as HTMLImageElement | null)

		if (!image) {
			console.warn('image not mounted yet', key)
			return
		}

		const cached = imageCache.get(key)

		if (!cached) {
			return console.warn('cached image not found', key)
		}

		if (cached.panZoom) {
			return console.info('PanZoom has already been created', key)
		}

		const options: Partial<PanZoomOptions> = {
			maxScale: 500,
			canExclude: (e) => {
				return !!e.tagName && (e.classList.contains('roi') || e.classList.contains('moveable-control'))
			},
			on: (event, detail) => {
				if (event === 'panzoomzoom') {
					// this.zoom.scale = detail.transformation.scale
				}
			},
		}

		const wrapper = image.closest('.wrapper') as HTMLElement
		const owner = image.closest('.workspace') as HTMLElement
		const panZoom = new PanZoom(wrapper, options, owner)

		function handleWheel(e: WheelEvent) {
			const target = e.target as HTMLElement

			if (e.shiftKey) {
				// this.rotateWithWheel(e)
			} else if (target === owner || target === wrapper || target === image /*|| target === this.roi().nativeElement*/ || target.tagName === 'circle' || target.tagName === 'text') {
				panZoom.zoomWithWheel(e)
			}
		}

		wrapper.addEventListener('wheel', handleWheel)

		function destroy() {
			panZoom.destroy()
			wrapper.removeEventListener('wheel', handleWheel)
		}

		cached.panZoom = panZoom
		cached.destroy = destroy

		console.info('image attached', key)
	}

	function detach() {
		const cached = imageCache.get(key)

		if (cached) {
			console.info('image detached', key)
			cached.destroy?.()
			imageCache.delete(key)
		}

		if (!loading) adjustZIndexAfterBeRemoved()

		currentImage = undefined
		workspace.state.selected = undefined
	}

	async function detectStars() {
		try {
			state.starDetection.loading = true

			const stars = await Api.StarDetection.detect(state.starDetection.request)

			state.starDetection.stars = stars
			state.starDetection.show = stars.length > 0

			if (!stars.length) {
				addToast({ description: 'No stars detected', color: 'primary', title: 'INFO' })
			}

			let hfd = 0
			let snr = 0
			let fluxMin = Number.MAX_VALUE
			let fluxMax = Number.MIN_VALUE

			for (const star of stars) {
				hfd += star.hfd
				snr += star.snr
				fluxMin = Math.min(fluxMin, star.flux)
				fluxMax = Math.max(fluxMax, star.flux)
			}

			if (stars.length) {
				hfd /= stars.length
				snr /= stars.length
			} else {
				fluxMin = 0
				fluxMax = 0
			}

			state.starDetection.computed = { hfd, snr, fluxMin, fluxMax }
		} catch {
			addToast({ description: 'Failed to detect stars', color: 'danger', title: 'ERROR' })
		} finally {
			state.starDetection.loading = false
		}
	}

	function selectDetectedStar(star: DetectedStar) {
		state.starDetection.selected = star

		const canvas = document.getElementById(`${key}-selected-star`) as HTMLCanvasElement | null
		if (!canvas) return
		const ctx = canvas.getContext('2d')
		const image = document.getElementById(key) as HTMLImageElement
		ctx?.drawImage(image, star.x - 8.5, star.y - 8.5, 16, 16, 0, 0, canvas.width, canvas.height)
	}

	return { state, scope, toggleAutoStretch, toggleDebayer, toggleHorizontalMirror, toggleVerticalMirror, toggleInvert, toggleCrosshair, load, open, attach, remove, detach, select, toggleDetectedStars, detectStars, selectDetectedStar }
})

export const HomeMolecule = molecule(() => {
	const state = proxy<HomeState>({
		openImageLastPath: simpleLocalStorage.get('image.path', ''),
		images: [],
	})

	function addImage(path: string) {
		const index = state.images.length === 0 ? 0 : Math.max(...state.images.map((e) => e.index)) + 1
		const key = `image-${Date.now()}-${index}`
		state.images.push({ path, key, index })
		state.openImageLastPath = path
		simpleLocalStorage.set('image.path', path)
	}

	function removeImage(image: Image) {
		const index = state.images.findIndex((e) => e.key === image.key)
		index >= 0 && state.images.splice(index, 1)
	}

	return { state, addImage, removeImage }
})

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

	let loading = false

	list()

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
		if (loading) return

		try {
			loading = true

			const { entries, tree } = await Api.FileSystem.list({ path: state.path, filter: scope.filter, directoryOnly: state.mode === 'directory' })

			state.entries.splice(0)
			state.entries.push(...entries)
			filter()
			state.directoryTree.splice(0)
			state.directoryTree.push(...tree)
		} finally {
			loading = false
		}
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

	function select(path: string) {
		const entry = state.entries.find((e) => e.path === path)

		if (!entry) return

		if (state.mode !== 'directory' && entry.directory) {
			navigateTo(entry)
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

	return { state, filter, list, navigateTo, navigateBack, navigateToParent, toggleCreateDirectory, createDirectory, select }
})

function adjustZIndexAfterBeRemoved() {
	const wrappers = document.querySelectorAll('.workspace .wrapper') ?? []

	// There is nothing to do
	if (wrappers.length <= 0) return

	// Get the z-index for each element that is not the target
	const elements = new Array<HTMLElement>(wrappers.length)

	for (const div of wrappers) {
		const zIndex = parseInt((div as HTMLElement).style.zIndex)
		elements[zIndex] = div as HTMLElement
	}

	// Update the z-index
	for (let i = 0, z = 0; i < elements.length; i++) {
		if (elements[i]) elements[i].style.zIndex = (z++).toFixed(0)
	}
}

// Brings the selected image to front
function bringToFront(e: HTMLElement) {
	const selected = e.closest('.wrapper') as HTMLElement
	const wrappers = selected.closest('.workspace')?.querySelectorAll('.wrapper') ?? []

	// Only exist one element and it is already at the top
	if (wrappers.length === 1) return

	// Selected element z-index
	const zIndex = parseInt((selected as HTMLElement).style.zIndex)
	const max = wrappers.length - 1

	// It is already at the top
	if (zIndex === max) return

	// Get the z-index for each element
	const elements = new Array<HTMLElement>(wrappers.length)

	for (const div of wrappers) {
		const zIndex = parseInt((div as HTMLElement).style.zIndex)
		elements[zIndex] = div as HTMLElement
	}

	// Shift the element z-index until selected element
	for (let i = elements.length - 1; i > zIndex; i--) {
		elements[i].style.zIndex = (i - 1).toFixed(0)
	}

	// Update the selected element z-index
	elements[zIndex].style.zIndex = max.toFixed(0)
}

export const ZIndexMolecule = molecule(() => {
	const state = proxy({ zIndex: 1000000, key: '' })

	function increment(key: string) {
		if (state.key !== key) {
			state.key = key
			state.zIndex++
			document.documentElement.style.setProperty(`--z-index-${key}`, state.zIndex.toFixed(0))
		}
	}

	return { state, increment }
})
