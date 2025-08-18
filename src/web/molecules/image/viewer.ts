import { createScope, molecule, onMount } from 'bunshi'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import bus, { unsubscribe } from 'src/shared/bus'
import { type CameraCaptureTaskEvent, DEFAULT_IMAGE_TRANSFORMATION, DEFAULT_PLATE_SOLVE_START, DEFAULT_STAR_DETECTION, type ImageInfo, type ImageTransformation, type PlateSolveStart, type StarDetection } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import type { Image } from '@/shared/types'
import { ImageWorkspaceMolecule } from './workspace'

export interface CachedImage {
	url: string
	state: ImageState
}

export interface ImageState {
	readonly transformation: ImageTransformation
	crosshair: boolean
	rotation: number
	info: ImageInfo
	scale: number
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

export interface ImageViewerScopeValue {
	readonly image: Image
}

export const DEFAULT_IMAGE_SETTINGS: ImageState['settings'] = {
	showModal: false,
	pixelated: true,
}

const imageCache = new Map<string, CachedImage>()

export const ImageViewerScope = createScope<ImageViewerScopeValue>({ image: { key: '', path: '', position: 0, source: 'file' } })

// Molecule that manages the image viewer
// It handles loading, transformations, star detection, and other image-related functionalities
export const ImageViewerMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)

	const workspace = m(ImageWorkspaceMolecule)
	const { key, path, camera } = scope.image

	let target = document.getElementById(key) as HTMLImageElement | null

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
			scale: 1,
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
		const unsubscribers = new Array<VoidFunction | undefined>(3)

		unsubscribers[0] = subscribeKey(state, 'crosshair', (e) => simpleLocalStorage.set('image.crosshair', e))
		unsubscribers[1] = subscribe(state.transformation, () => simpleLocalStorage.set('image.transformation', state.transformation))

		if (camera) {
			unsubscribers[2] = bus.subscribe<CameraCaptureTaskEvent>('camera:capture', (event) => {
				if (event.device === camera.name && event.savedPath) {
					void load(true, event.savedPath)
				}
			})
		}

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	// Resets the stretch transformation to default values
	function resetStretch() {
		state.transformation.stretch.auto = false
		state.transformation.stretch.midtone = 32768
		state.transformation.stretch.shadow = 0
		state.transformation.stretch.highlight = 65536
		return load(true)
	}

	// Toggles the auto-stretch transformation
	function toggleAutoStretch() {
		if (state.transformation.stretch.auto) {
			return resetStretch()
		} else {
			state.transformation.stretch.auto = true
			return load(true)
		}
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

	// Closes a modal
	function closeModal(key: 'starDetection' | 'scnr' | 'stretch' | 'fitsHeader' | 'plateSolver' | 'adjustment' | 'filter' | 'settings') {
		state[key].showModal = false
	}

	// Removes the image from the workspace
	function remove() {
		workspace.remove(scope.image)
	}

	// Loads the current image
	async function load(force: boolean = false, path?: string) {
		if (loading) return

		loading = true

		console.info('loading image', key)

		const cached = imageCache.get(key)

		// Not loaded yet or forced to load
		if (!cached?.url || force || path) {
			await open(path)
		}
		// Load the image from cache
		else if (target) {
			target.src = cached.url
			apply()
			console.info('image loaded from cache', key, cached.url)
		} else {
			console.warn('image not mounted yet', key)
		}

		loading = false
	}

	// Opens the current image and saves it into cache
	async function open(path?: string) {
		try {
			loading = true

			console.info('opening image', key)

			// Load the image
			path ||= scope.image.path.split('#')[0]
			const image = await Api.Image.open({ path, transformation: state.transformation })

			if (!image) return remove()

			const url = URL.createObjectURL(image.blob)

			// Update the state
			state.info = image.info
			updateTransformationFromInfo(image.info)

			// Add the image to cache
			const cached = imageCache.get(key)

			if (cached) {
				URL.revokeObjectURL(cached.url)

				cached.url = url
			} else {
				imageCache.set(key, { url, state })
			}

			if (target) {
				target.src = url
				afterLoad()
				bus.emit('image:load', scope.image)
				console.info('image loaded', key, url, image.info)
			} else {
				console.warn('image not mounted yet', key)
			}
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

		// Update plate solver solution
		state.plateSolver.solution = info.solution
	}

	function afterLoad() {
		apply()
		resetStarDetection()
	}

	function resetStarDetection() {
		if (state.starDetection.stars.length) {
			state.starDetection.stars = []
			state.starDetection.selected = undefined
			state.starDetection.computed.hfd = 0
			state.starDetection.computed.snr = 0
			state.starDetection.computed.fluxMin = 0
			state.starDetection.computed.fluxMax = 0
		}
	}

	// Applies the current settings to the image
	function apply() {
		if (!target) return
		target.classList.toggle('pixelated', state.settings.pixelated)
	}

	// Selects the image and brings it to the front
	function select() {
		if (!target) return
		workspace.state.selected = scope.image
		bringToFront(target)
	}

	// Attaches the image to the viewer
	function attach(node: HTMLImageElement | null) {
		if (node) {
			target = node
			void load(false)
			select()
		}
	}

	// Detaches the image from the workspace
	// It destroys the PanZoom instance and removes the image from cache
	function detach() {
		if (loading) return

		const cached = imageCache.get(key)

		if (cached) {
			console.info('image detached', key)
			imageCache.delete(key)
		}

		adjustZIndexAfterBeRemoved()

		workspace.state.selected = undefined
	}

	return { state, scope, resetStretch, toggleAutoStretch, toggleDebayer, toggleHorizontalMirror, toggleVerticalMirror, toggleInvert, toggleCrosshair, attach, load, open, remove, detach, select, showModal, closeModal, apply }
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
