import { addToast } from '@heroui/react'
import { createScope, molecule, onMount } from 'bunshi'
import { arcsec, formatDEC, formatRA } from 'nebulosa/src/angle'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import type { DirectoryEntry, FileEntry, ImageInfo, ImageTransformation, PlateSolveStart, StarDetection } from 'src/api/types'
import { DEFAULT_IMAGE_TRANSFORMATION, DEFAULT_PLATE_SOLVE_START, DEFAULT_STAR_DETECTION } from 'src/api/types'
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
		request: PlateSolveStart
		solution?: PlateSolution
	}
	readonly scnr: {
		showModal: boolean
	}
	readonly stretch: {
		showModal: boolean
	}
	readonly adjustment: {
		showModal: boolean
	}
	readonly filter: {
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
	readonly settings: {
		showModal: boolean
		pixelated: boolean
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

export const DEFAULT_IMAGE_SETTINGS: ImageState['settings'] = {
	showModal: false,
	pixelated: true,
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
		const unsubscribe = subscribe(state.connections, () => simpleLocalStorage.set('connections', state.connections))

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

export const ImageViewerScope = createScope<ImageViewerScopeValue>({ image: { key: '', path: '', index: 0 } })

// Molecule that manages the image viewer
// It handles loading, transformations, star detection, and other image-related functionalities
export const ImageViewerMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)

	const workspace = m(ImageWorkspaceMolecule)
	const { key, path } = scope.image

	const transformation = simpleLocalStorage.get('image.transformation', () => structuredClone(DEFAULT_IMAGE_TRANSFORMATION))
	const starDetectionRequest = simpleLocalStorage.get('image.starDetection', () => structuredClone(DEFAULT_STAR_DETECTION))
	const plateSolverRequest = simpleLocalStorage.get('image.plateSolver', () => structuredClone(DEFAULT_PLATE_SOLVE_START))
	const settings = simpleLocalStorage.get<ImageState['settings']>('image.settings', () => structuredClone(DEFAULT_IMAGE_SETTINGS))

	starDetectionRequest.path = path
	plateSolverRequest.id = key
	plateSolverRequest.path = path
	settings.showModal = false

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
				request: plateSolverRequest,
			},
			scnr: {
				showModal: false,
			},
			stretch: {
				showModal: false,
			},
			adjustment: {
				showModal: false,
			},
			filter: {
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
			settings,
		})

	// Save the state in the cache
	imageCache.set(key, { url: '', state })

	let loading = false

	onMount(() => {
		const unsubscribes: VoidFunction[] = []

		unsubscribes[0] = subscribeKey(state, 'crosshair', (e) => simpleLocalStorage.set('image.crosshair', e))
		unsubscribes[1] = subscribe(state.transformation, () => simpleLocalStorage.set('image.transformation', state.transformation))

		return () => unsubscribes.forEach((e) => e())
	})

	function currentImage() {
		return document.getElementById(key) as HTMLImageElement | undefined
	}

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
	function showModal(key: 'starDetection' | 'scnr' | 'stretch' | 'fitsHeader' | 'plateSolver' | 'adjustment' | 'filter' | 'settings') {
		state[key].showModal = true
	}

	// Removes the image from the workspace
	function remove() {
		workspace.remove(scope.image)
	}

	// Loads the current image
	async function load(force: boolean = false, image?: HTMLImageElement) {
		if (loading) return

		console.info('loading image', key)

		const cached = imageCache.get(key)

		// Not loaded yet or forced to load
		if (!cached?.url || force) {
			await open(image)
		} else {
			// Load the image from cache
			image ??= currentImage()

			if (image) {
				image.src = cached.url
				apply()
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

			console.info('opening image', key)

			// Load the image
			const { blob, info } = await Api.Image.open({ path: scope.image.path, transformation: state.transformation })
			const url = URL.createObjectURL(blob)

			// Update the state
			state.info = info
			updateTransformationFromInfo(info)

			// Add the image to cache
			const cached = imageCache.get(key)

			if (cached) {
				URL.revokeObjectURL(cached.url)

				cached.url = url
			} else {
				imageCache.set(key, { url, state })
			}

			image ??= currentImage()

			if (image) {
				image.src = url
				apply()
				console.info('image loaded', key, url, info)
			} else {
				console.warn('image not mounted yet', key)
			}

			return url
		} catch (e) {
			console.error('failed to open image', key, e)
			addToast({ title: 'ERROR', description: 'Failed to open image', color: 'danger' })
			remove()
		} finally {
			loading = false
		}
	}

	function updateTransformationFromInfo(info: ImageInfo) {
		// Update stretch transformation
		state.transformation.stretch.auto = info.transformation.stretch.auto
		state.transformation.stretch.shadow = info.transformation.stretch.shadow
		state.transformation.stretch.highlight = info.transformation.stretch.highlight
		state.transformation.stretch.midtone = info.transformation.stretch.midtone

		// Update plate solver request
		state.plateSolver.request.ra = info.rightAscension ? formatRA(info.rightAscension) : DEFAULT_PLATE_SOLVE_START.ra
		state.plateSolver.request.dec = info.declination ? formatDEC(info.declination) : DEFAULT_PLATE_SOLVE_START.dec
		state.plateSolver.request.blind = !info.rightAscension || !info.declination

		// Update plate solver request with FITS header information
		if (info.headers) {
			if (info.headers.FOCALLEN) state.plateSolver.request.focalLength = parseInt(info.headers.FOCALLEN as never)
			if (info.headers.XPIXSZ) state.plateSolver.request.pixelSize = parseFloat(info.headers.XPIXSZ as never)
		}

		// Update plate solver solution
		state.plateSolver.solution = info.solution
	}

	// Applies the current settings to the image
	function apply() {
		const image = currentImage()
		if (!image) return
		image.classList.toggle('pixelated', state.settings.pixelated)
	}

	// Selects the image and brings it to the front
	function select() {
		const image = currentImage()
		if (!image) return
		workspace.state.selected = scope.image
		bringToFront(image)
	}

	// Attaches the PanZoom and other things to image
	function attach() {
		const image = currentImage()

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
		if (loading) return

		const cached = imageCache.get(key)

		if (cached) {
			console.info('image detached', key)
			cached.destroy?.()
			imageCache.delete(key)
		}

		adjustZIndexAfterBeRemoved()

		workspace.state.selected = undefined
	}

	return { state, scope, currentImage, toggleAutoStretch, toggleDebayer, toggleHorizontalMirror, toggleVerticalMirror, toggleInvert, toggleCrosshair, load, open, attach, remove, detach, select, showModal, apply }
})

// Molecule that manages the plate solver
export const PlateSolverMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const plateSolver = viewer.state.plateSolver

	onMount(() => {
		const unsubscribe = subscribe(plateSolver.request, () => simpleLocalStorage.set('image.plateSolver', plateSolver.request))

		return () => unsubscribe()
	})

	// Updates a specific property of the plate solver request
	function update<K extends keyof PlateSolveStart>(key: K, value: PlateSolveStart[K]) {
		viewer.state.plateSolver.request[key] = value
	}

	// Solves the plate using the current request
	async function start() {
		try {
			plateSolver.loading = true

			const request = viewer.state.plateSolver.request
			request.fov = arcsec(angularSizeOfPixel(request.focalLength, request.pixelSize) * viewer.state.info.height)

			const solution = await Api.PlateSolver.start(request)

			if ('failed' in solution) {
				addToast({ description: 'Plate solving failed', color: 'danger', title: 'ERROR' })
			} else {
				viewer.state.plateSolver.solution = solution
			}
		} finally {
			plateSolver.loading = false
		}
	}

	// Stops the plate solving process
	function stop() {
		return Api.PlateSolver.stop({ id: scope.image.key })
	}

	return { state: viewer.state.plateSolver, viewer, scope, update, start, stop }
})

// Molecule that manages star detection
export const StarDetectionMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)
	const key = scope.image.key
	const starDetection = viewer.state.starDetection

	onMount(() => {
		const unsubscribe = subscribe(starDetection.request, () => simpleLocalStorage.set('image.starDetection', starDetection.request))

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

// Molecule that stretches the image
export const ImageStretchMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	// Updates the stretch transformation for a specific key
	function update<K extends keyof ImageTransformation['stretch']>(key: K, value: ImageTransformation['stretch'][K]) {
		viewer.state.transformation.stretch[key] = value
	}

	// Apply the auto-stretch transformation to the image
	function auto() {
		return apply(true)
	}

	// Resets the stretch transformation to default values
	function reset() {
		viewer.state.transformation.stretch.midtone = 32768
		viewer.state.transformation.stretch.shadow = 0
		viewer.state.transformation.stretch.highlight = 65536
		return apply()
	}

	// Applies the stretch transformation to the image
	function apply(auto: boolean = false) {
		viewer.state.transformation.stretch.auto = auto
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.stretch, scope, viewer, update, auto, reset, apply }
})

// Molecule that apply SCNR (Subtractive Color Noise Reduction) to the image
export const ImageScnrMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	// Updates the SCNR transformation for a specific key
	function update<K extends keyof ImageTransformation['scnr']>(key: K, value: ImageTransformation['scnr'][K]) {
		viewer.state.transformation.scnr[key] = value
	}

	// Applies the SCNR transformation to the image
	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.scnr, scope, viewer, update, apply }
})

// Molecule that applies the adjustment transformation to the image
export const ImageAdjustmentMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	// Updates the adjustment transformation for a specific key
	function update<K extends keyof ImageTransformation['adjustment']>(key: K, value: ImageTransformation['adjustment'][K]) {
		viewer.state.transformation.adjustment[key] = value
	}

	// Resets the adjustment transformation to default values
	function reset() {
		viewer.state.transformation.adjustment.brightness = 1
		viewer.state.transformation.adjustment.gamma = 1
		viewer.state.transformation.adjustment.saturation = 1
		viewer.state.transformation.adjustment.normalize = false
		return apply()
	}

	// Applies the adjustment transformation to the image
	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.adjustment, scope, viewer, update, reset, apply }
})

// Molecule that applies the filter transformation to the image
export const ImageFilterMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	// Updates the filter transformation for a specific key
	function update<K extends keyof ImageTransformation['filter']>(key: K, value: ImageTransformation['filter'][K]) {
		viewer.state.transformation.filter[key] = value
	}

	// Resets the filter transformation to default values
	function reset() {
		viewer.state.transformation.filter.sharpen = false
		viewer.state.transformation.filter.blur = false
		viewer.state.transformation.filter.median = false
		return apply()
	}

	// Applies the filter transformation to the image
	function apply() {
		return viewer.load(true)
	}

	return { state: viewer.state.transformation.filter, scope, viewer, update, reset, apply }
})

// Molecule that manages the image settings
export const ImageSettingsMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)
	const viewer = m(ImageViewerMolecule)

	onMount(() => {
		const unsubscribe = subscribe(viewer.state.settings, () => simpleLocalStorage.set('image.settings', viewer.state.settings))

		return () => unsubscribe()
	})

	// Updates the image settings for a specific key
	function update<K extends keyof ImageState['settings']>(key: K, value: ImageState['settings'][K]) {
		viewer.state.settings[key] = value
		viewer.apply()
	}

	// Updates the image format
	function updateFormat(format: ImageTransformation['format']) {
		viewer.state.transformation.format = format
		return viewer.load(true)
	}

	// Resets the image settings to default values
	function reset() {
		const load = viewer.state.transformation.format !== DEFAULT_IMAGE_TRANSFORMATION.format
		viewer.state.transformation.format = DEFAULT_IMAGE_TRANSFORMATION.format
		viewer.state.settings.pixelated = true
		viewer.apply()
		if (load) void viewer.load(true)
	}

	return { state: viewer.state.settings, scope, viewer, update, updateFormat, reset }
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

export const ModalScope = createScope<ModalScopeValue>({ name: '' })

// Molecule that manages modals
// It handles the position, transformation, and z-index of modals
// It allows dragging and moving modals within the workspace
// It also ensures that modals are always on top of other elements
export const ModalMolecule = molecule((m, s) => {
	const scope = s(ModalScope)
	const zIndex = m(ZIndexMolecule)

	// Increment the z-index for the modal
	zIndex.increment(scope.name, scope.isAlwaysOnTop ?? false)

	let targetRef: HTMLElement | undefined

	// Sets the z-index of the modal to ensure it is on top when the move starts
	function onMoveStart() {
		if (!targetRef) return

		zIndex.increment(scope.name, true)
	}

	// Handles the pointer up event, which increments the z-index of the modal
	// to ensure it is on top of other elements.
	function onPointerUp() {
		zIndex.increment(scope.name, true)
	}

	// Sets the reference to the target element and sets the z-index of the parent element to ensure it is on top.
	function ref(node: HTMLElement | null) {
		if (node && node !== targetRef) {
			targetRef = node

			if (node.parentElement) {
				node.parentElement.style.zIndex = `var(--z-index-${scope.name}) !important`
			}
		}
	}

	// Handles the open change event of the modal
	// If the modal is closed, it removes the z-index from the modal
	// This ensures that the modal will be on top of other elements when it is opened again
	// by requesting a new z-index.
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

	return { scope, props, onMoveStart, targetRef }
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
