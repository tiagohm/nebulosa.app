import { createScope, molecule, onMount } from 'bunshi'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import bus, { unsubscribe } from 'src/shared/bus'
import { type CameraCaptureEvent, DEFAULT_IMAGE_TRANSFORMATION, DEFAULT_PLATE_SOLVE_START, DEFAULT_STAR_DETECTION, type ImageInfo, type ImageTransformation, type PlateSolveStart, type StarDetection } from 'src/shared/types'
import type { PickByValue } from 'utility-types'
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
		show: boolean
		visible: boolean
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
		show: boolean
		loading: boolean
		request: PlateSolveStart
		solution?: PlateSolution
	}
	readonly scnr: {
		show: boolean
	}
	readonly stretch: {
		show: boolean
	}
	readonly adjustment: {
		show: boolean
	}
	readonly filter: {
		show: boolean
	}
	readonly fitsHeader: {
		show: boolean
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
		show: boolean
		pixelated: boolean
	}
}

export interface ImageViewerScopeValue {
	readonly image: Image
}

export const DEFAULT_IMAGE_SETTINGS: ImageState['settings'] = {
	show: false,
	pixelated: true,
}

const imageCache = new Map<string, CachedImage>()

export const ImageViewerScope = createScope<ImageViewerScopeValue>({ image: { key: '', path: '', position: 0, source: 'file' } })

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
	settings.show = false

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
				show: false,
				visible: false,
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
				show: false,
				loading: false,
				request: plateSolverRequest,
			},
			scnr: {
				show: false,
			},
			stretch: {
				show: false,
			},
			adjustment: {
				show: false,
			},
			filter: {
				show: false,
			},
			fitsHeader: {
				show: false,
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
			unsubscribers[2] = bus.subscribe<CameraCaptureEvent>('camera:capture', (event) => {
				if (event.device === camera.name && event.savedPath) {
					void load(true, event.savedPath)
				}
			})
		}

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function resetStretch() {
		state.transformation.stretch.auto = false
		state.transformation.stretch.midtone = 32768
		state.transformation.stretch.shadow = 0
		state.transformation.stretch.highlight = 65536
		return load(true)
	}

	function toggleAutoStretch() {
		if (state.transformation.stretch.auto) {
			return resetStretch()
		} else {
			state.transformation.stretch.auto = true
			return load(true)
		}
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

	function show(key: keyof PickByValue<typeof state, { show: boolean }>) {
		state[key].show = true
	}

	function hide(key: keyof PickByValue<typeof state, { show: boolean }>) {
		state[key].show = false
	}

	function remove() {
		workspace.remove(scope.image)
	}

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

	function apply() {
		if (!target) return
		target.classList.toggle('pixelated', state.settings.pixelated)
	}

	function select() {
		if (!target) return
		workspace.state.selected = scope.image
		bringToFront(target)
	}

	function attach(node: HTMLImageElement | null) {
		if (node) {
			target = node
			void load(false)
			select()
		}
	}

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

	return { state, scope, resetStretch, toggleAutoStretch, toggleDebayer, toggleHorizontalMirror, toggleVerticalMirror, toggleInvert, toggleCrosshair, attach, load, open, remove, detach, select, show, hide, apply }
})

function adjustZIndexAfterBeRemoved() {
	const wrappers = document.querySelectorAll('.workspace .wrapper') ?? []

	// There is nothing to do
	if (wrappers.length === 0) return

	// Get the z-index for each element that is not the target
	const elements = new Array<HTMLElement>(wrappers.length)

	for (const div of wrappers) {
		const zIndex = +(div as HTMLElement).style.zIndex
		elements[zIndex] = div as HTMLElement
	}

	// Update the z-index
	for (let i = 0, z = 0; i < elements.length; i++) {
		if (elements[i]) elements[i].style.zIndex = (z++).toFixed(0)
	}
}

function bringToFront(e: HTMLElement) {
	const selected = e.closest('.wrapper') as HTMLElement
	const wrappers = selected.closest('.workspace')?.querySelectorAll('.wrapper') ?? []

	// Only exist one element and it is already at the top
	if (wrappers.length === 1) return

	// Selected element z-index
	const zIndex = +(selected as HTMLElement).style.zIndex
	const max = wrappers.length - 1

	// It is already at the top
	if (zIndex === max) return

	// Get the z-index for each element
	const elements = new Array<HTMLElement>(wrappers.length)

	for (const div of wrappers) {
		const zIndex = +(div as HTMLElement).style.zIndex
		elements[zIndex] = div as HTMLElement
	}

	// Shift the element z-index until selected element
	for (let i = elements.length - 1; i > zIndex; i--) {
		elements[i].style.zIndex = (i - 1).toFixed(0)
	}

	// Update the selected element z-index
	elements[zIndex].style.zIndex = max.toFixed(0)
}
