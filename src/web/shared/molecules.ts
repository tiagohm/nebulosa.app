import { addToast } from '@heroui/react'
import type { MoveMoveEvent } from '@react-types/shared'
import { createScope, molecule, onMount } from 'bunshi'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import type { DirectoryEntry, FileEntry, ImageInfo, ImageTransformation, StarDetection } from 'src/api/types'
import { DEFAULT_IMAGE_TRANSFORMATION, DEFAULT_STAR_DETECTION } from 'src/api/types'
import { proxy, subscribe } from 'valtio'
import { deepClone, subscribeKey } from 'valtio/utils'
import type { FilePickerMode } from '@/ui/FilePicker'
import { Api } from './api'
import { PanZoom, type PanZoomOptions } from './panzoom'
import { simpleLocalStorage } from './storage'
import { type Connection, DEFAULT_CONNECTION } from './types'

export interface ConnectionState {
	showModal: boolean
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
	readonly images: Image[]
	lastPath: string
	showModal: boolean
	selected?: Image
}

export interface ImageViewerScopeValue {
	readonly image: Image
}

export interface ImageState {
	readonly transformation: ImageTransformation
	crosshair: boolean
	rotation: number
	info: ImageInfo
	readonly starDetection: {
		showModal: boolean
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
	readonly plateSolver: {
		showModal: boolean
		loading: boolean
	}
	readonly scnr: {
		showModal: boolean
	}
	readonly stretch: {
		showModal: boolean
	}
	readonly fitsHeader: {
		showModal: boolean
	}
	readonly roi: {
		show: boolean
		x: number
		y: number
		width: number
		height: number
		rotation: number
	}
}

export interface HomeState {
	readonly about: {
		showModal: boolean
	}
}

export interface ModalScopeValue {
	readonly name: string
	readonly canOverflow?: boolean
	readonly isAlwaysOnTop?: boolean
}

export interface ModalState {
	readonly boundary: {
		minLeft: number
		minTop: number
		maxLeft: number
		maxTop: number
	}
	readonly transform: {
		offsetX: number
		offsetY: number
	}
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

// Compares two connections based on their connectedAt timestamp
export const ConnectionComparator = (a: Connection, b: Connection) => {
	return (a.connectedAt ?? 0) - (b.connectedAt ?? 0)
}

// Molecule that manages connections
export const ConnectionMolecule = molecule(() => {
	const connections = simpleLocalStorage.get('connections', () => [structuredClone(DEFAULT_CONNECTION)])
	connections.sort(ConnectionComparator)

	const state = proxy<ConnectionState>({
		showModal: false,
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

	// Shows the modal for creating a new connection
	function create() {
		state.edited = deepClone(DEFAULT_CONNECTION)
		state.showModal = true
	}

	// Shows the modal for editing an existing connection
	function edit(connection: Connection) {
		state.edited = deepClone(connection)
		state.showModal = true
	}

	// Adds a new connection to the list
	function add(connection: Connection) {
		state.connections.push(connection)
	}

	// Duplicates an existing connection
	// If the connection is the default one, it generates a new id
	function duplicate(connection: Connection) {
		const duplicated = deepClone(connection)
		if (duplicated.id === DEFAULT_CONNECTION.id) duplicated.id = Date.now().toFixed(0)
		add(duplicated)
	}

	// Updates a specific property of the edited connection
	function update<K extends keyof Connection>(name: K, value: Connection[K]) {
		if (state.edited) {
			state.edited[name] = value
		}
	}

	// Selects a connection
	function select(connection: Connection) {
		state.selected = connection
	}

	// Selects a connection by its id
	function selectWith(id: string) {
		const selected = state.connections.find((c) => c.id === id)
		selected && select(selected)
	}

	// Saves the edited connection
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

			state.showModal = false
		}
	}

	function removeOnly(connection: Connection) {
		const { connections } = state
		const index = connections.findIndex((e) => e.id === connection.id)
		if (index < 0) return false
		connections.splice(index, 1)
		return true
	}

	// Removes a connection
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

	// Connects to the selected connection
	// If already connected, it disconnects
	function connect() {
		if (state.connected) {
			state.connected = undefined
		} else {
			state.connected = state.selected
		}
	}

	return { state, create, edit, update, select, selectWith, save, connect, duplicate, remove } as const
})

// Molecule that manages the image workspace
export const ImageWorkspaceMolecule = molecule(() => {
	const state = proxy<ImageWorkspaceState>({
		images: [],
		showModal: false,
		lastPath: simpleLocalStorage.get('image.path', ''),
	})

	// Add an image to the workspace from a given path
	// It generates a unique key for the image and adds it to the state
	function add(path: string) {
		const index = state.images.length === 0 ? 0 : Math.max(...state.images.map((e) => e.index)) + 1
		const key = `image-${Date.now()}-${index}`
		state.images.push({ path, key, index })
		state.lastPath = path
		simpleLocalStorage.set('image.path', path)
	}

	// Removes an image from the workspace
	function remove(image: Image) {
		const index = state.images.findIndex((e) => e.key === image.key)
		index >= 0 && state.images.splice(index, 1)
	}

	return { state, add, remove }
})

const imageCache = new Map<string, CachedImage>()
const imageSubscriptionKeys: (keyof ImageState)[] = ['transformation', 'crosshair', 'rotation']

export const ImageViewerScope = createScope<ImageViewerScopeValue>({ image: { key: '', path: '', index: 0 } })

// Molecule that manages the image viewer
// It handles loading, transformations, star detection, and other image-related functionalities
export const ImageViewerMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)

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
			info: {
				path: '',
				originalPath: '',
				width: 0,
				height: 0,
				mono: false,
				metadata: {
					width: 0,
					height: 0,
					channels: 1,
					strideInPixels: 0,
					pixelCount: 0,
					pixelSizeInBytes: 0,
					bitpix: 8,
				},
				transformation,
				headers: {},
			},
			starDetection: {
				showModal: false,
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
			plateSolver: {
				showModal: false,
				loading: false,
			},
			scnr: {
				showModal: false,
			},
			stretch: {
				showModal: false,
			},
			fitsHeader: {
				showModal: false,
			},
			roi: {
				show: false,
				x: 0,
				y: 0,
				width: 0,
				height: 0,
				rotation: 0,
			},
		})

	imageCache.set(key, { url: '', state })

	let loading = false
	let currentImage: HTMLImageElement | undefined

	onMount(() => {
		const unsubscribes: VoidFunction[] = []

		for (const key of imageSubscriptionKeys) {
			const unsubscribe = subscribeKey(state, key, (e) => simpleLocalStorage.set(`image.${key}`, e))
			unsubscribes.push(unsubscribe)
		}

		return () => unsubscribes.forEach((e) => e())
	})

	// Toggles the auto-stretch transformation
	function toggleAutoStretch() {
		state.transformation.stretch.auto = !state.transformation.stretch.auto
		return load(true)
	}

	// Toggles the debayer transformation
	function toggleDebayer() {
		state.transformation.debayer = !state.transformation.debayer
		return load(true)
	}

	// Toggles the horizontal mirror transformation
	function toggleHorizontalMirror() {
		state.transformation.horizontalMirror = !state.transformation.horizontalMirror
		return load(true)
	}

	// Toggles the vertical mirror transformation
	function toggleVerticalMirror() {
		state.transformation.verticalMirror = !state.transformation.verticalMirror
		return load(true)
	}

	// Toggles the invert transformation
	function toggleInvert() {
		state.transformation.invert = !state.transformation.invert
		return load(true)
	}

	// Toggles the crosshair visibility
	function toggleCrosshair() {
		state.crosshair = !state.crosshair
	}

	// Shows a modal
	function showModal(key: 'starDetection' | 'scnr' | 'stretch' | 'fitsHeader' | 'plateSolver') {
		state[key].showModal = true
	}

	// Removes the image from the workspace
	function remove() {
		workspace.remove(scope.image)
	}

	// Loads the current image
	async function load(force: boolean = false, image?: HTMLImageElement) {
		console.info('loading image', key, loading)

		if (loading) return

		if (image) currentImage = image

		const cached = imageCache.get(key)

		// Not loaded yet or forced to load
		if (!cached?.url || force) {
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

	// Opens the current image and saves it into cache
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
				cached.state.info = info
			} else {
				imageCache.set(key, { url, state })
			}

			image ??= currentImage ?? (document.getElementById(key) as HTMLImageElement | undefined)

			if (image) {
				image.src = url
				console.info('image loaded', key, url, info)
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

	// Selects the image and brings it to the front
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

	// Detaches the image from the workspace
	// It destroys the PanZoom instance and removes the image from cache
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

	return { state, scope, toggleAutoStretch, toggleDebayer, toggleHorizontalMirror, toggleVerticalMirror, toggleInvert, toggleCrosshair, load, open, attach, remove, detach, select, showModal }
})

// Molecule that manages star detection
export const StarDetectionMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const key = scope.image.key
	const starDetection = viewer.state.starDetection

	onMount(() => {
		const unsubscribe = subscribe(starDetection.request, () => {
			simpleLocalStorage.set('image.starDetection', starDetection.request)
		})

		return () => unsubscribe()
	})

	// Toggles the visibility of detected stars
	function toggle(enabled?: boolean) {
		starDetection.show = enabled ?? !starDetection.show
	}

	// Detects stars in the image
	async function detect() {
		try {
			starDetection.loading = true

			const stars = await Api.StarDetection.detect(starDetection.request)

			starDetection.stars = stars
			starDetection.show = stars.length > 0

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

			starDetection.computed = { hfd, snr, fluxMin, fluxMax }
		} catch {
			addToast({ description: 'Failed to detect stars', color: 'danger', title: 'ERROR' })
		} finally {
			starDetection.loading = false
		}
	}

	// Selects a detected star and draws it on a canvas
	function select(star: DetectedStar) {
		starDetection.selected = star

		const canvas = document.getElementById(`${key}-selected-star`) as HTMLCanvasElement | null
		if (!canvas) return
		const ctx = canvas.getContext('2d')
		const image = document.getElementById(key) as HTMLImageElement
		ctx?.drawImage(image, star.x - 8.5, star.y - 8.5, 16, 16, 0, 0, canvas.width, canvas.height)
	}

	return { state: starDetection, viewer, scope, toggle, detect, select }
})

// Molecule that manages the home state
export const HomeMolecule = molecule(() => {
	const state = proxy<HomeState>({
		about: {
			showModal: false,
		},
	})

	return { state }
})

const modalTransformMap = new Map<string, ModalState['transform']>()

export const ModalScope = createScope<ModalScopeValue>({ name: '' })

// Molecule that manages modals
// It handles the position, transformation, and z-index of modals
// It allows dragging and moving modals within the workspace
// It also ensures that modals are always on top of other elements
export const ModalMolecule = molecule((m, s) => {
	const scope = s(ModalScope)

	const transform = modalTransformMap.get(scope.name) ?? { offsetX: 0, offsetY: 0 }

	const state = proxy<ModalState>({
		boundary: {
			minLeft: 0,
			minTop: 0,
			maxLeft: 0,
			maxTop: 0,
		},
		transform,
	})

	const zIndex = m(ZIndexMolecule)

	// Increment the z-index for the modal
	zIndex.increment(scope.name, scope.isAlwaysOnTop ?? false)

	let targetRef: HTMLElement | undefined

	// https://github.com/heroui-inc/heroui/blob/canary/packages/hooks/use-draggable/src/index.ts

	// Handles the start of a move event, calculating boundaries based
	// on the current position and size of the target element.
	function onMoveStart() {
		if (!targetRef) return

		zIndex.increment(scope.name, true)

		const { offsetX, offsetY } = state.transform
		const { left, top, width, height } = targetRef.getBoundingClientRect()
		const { clientWidth, clientHeight } = document.documentElement

		// Calculate the boundaries for the modal based on its position and size
		const borderWidth = targetRef.clientWidth - 64
		const borderHeight = targetRef.clientHeight - 64
		state.boundary.minLeft = -left + offsetX - borderWidth
		state.boundary.minTop = -top + offsetY - borderHeight
		state.boundary.maxLeft = clientWidth - left - width + offsetX + borderWidth
		state.boundary.maxTop = clientHeight - top - height + offsetY + borderHeight
	}

	// Handles the move event, updating the position of the target element
	// based on the delta values from the move event.
	// It also ensures that the element does not overflow its boundaries.
	function onMove(e: MoveMoveEvent) {
		if (!targetRef) return

		let offsetX = state.transform.offsetX + e.deltaX
		let offsetY = state.transform.offsetY + e.deltaY

		if (!scope.canOverflow) {
			const { minLeft, minTop, maxLeft, maxTop } = state.boundary
			offsetX = Math.min(Math.max(offsetX, minLeft), maxLeft)
			offsetY = Math.min(Math.max(offsetY, minTop), maxTop)
		}

		state.transform.offsetX = offsetX
		state.transform.offsetY = offsetY
		modalTransformMap.set(scope.name, { offsetX, offsetY })
		targetRef.style.transform = `translate(${offsetX}px, ${offsetY}px)`
	}

	// Handles the pointer up event, which increments the z-index of the modal
	// to ensure it is on top of other elements.
	// This is useful for ensuring that the modal remains interactive after being dragged.
	function onPointerUp() {
		zIndex.increment(scope.name, true)
	}

	// Sets the reference to the target element and applies the initial transform.
	// It also sets the z-index of the parent element to ensure it is on top.
	function ref(node: HTMLElement | null) {
		if (node && node !== targetRef) {
			targetRef = node
			targetRef.style.transform = `translate(${state.transform.offsetX}px, ${state.transform.offsetY}px)`

			if (node.parentElement) {
				node.parentElement.style.zIndex = `var(--z-index-${scope.name}) !important`
			}
		}
	}

	function onOpenChange(isOpen: boolean) {
		if (!isOpen) zIndex.remove(scope.name)
	}

	const props = {
		ref,
		onPointerUp,
		onOpenChange,
		backdrop: 'transparent',
		size: 'sm',
		isDismissable: false,
		isOpen: true,
	} as const

	return { state, scope, props, onMoveStart, onMove }
})

export const FilePickerScope = createScope<FilePickerScopeValue>({})

// Molecule that manages the file picker
// It allows users to navigate through directories, filter files, and select files or directories
// It also supports creating new directories and managing the file system
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

	// biome-ignore lint/nursery/noFloatingPromises: react
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
		return list()
	}

	function navigateBack() {
		if (state.history.length === 0) return
		state.path = state.history.pop()!
		return list()
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
				await list()
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

// Keys and values for z-index management
const zIndex: [string, number][] = []

// Molecule that manages z-index for modals and other elements
// It allows to increment the z-index for a specific key and manage the order of elements
// It is used to ensure that the elements are always on top of each other in the correct order
export const ZIndexMolecule = molecule(() => {
	// Returns the maximum z-index value
	function max() {
		return zIndex.length === 0 ? 1000000 : zIndex[zIndex.length - 1][1]
	}

	// Updates the z-index for a specific key
	function update(key: string, value: number) {
		document.documentElement.style.setProperty(`--z-index-${key}`, value.toFixed(0))
	}

	// Computes the new z-index for a specific key for ensuring that it is always on top
	function increment(key: string, force: boolean = false) {
		const index = zIndex.findIndex((e) => e[0] === key)

		if (index < 0) {
			const value = max() + 1
			zIndex.push([key, value])
			update(key, value)
			return value
		} else if (force) {
			const maxIndex = zIndex.length - 1

			// If the key is not at the top, we need to shift the z-index of the other elements
			// and move the key to the top
			if (index !== maxIndex) {
				const max = zIndex[maxIndex][1]

				for (let i = maxIndex; i > index; i--) {
					zIndex[i][1]--
					update(...zIndex[i])
				}

				zIndex.splice(index, 1)
				zIndex.push([key, max])
				update(key, max)
				return max
			}

			return zIndex[index][1]
		} else {
			update(...zIndex[index])
		}
	}

	function remove(key: string) {
		const index = zIndex.findIndex((e) => e[0] === key)
		if (index < 0) return
		zIndex.splice(index, 1)
	}

	return { increment, remove }
})

// Adjusts the z-index of elements after one is removed
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
