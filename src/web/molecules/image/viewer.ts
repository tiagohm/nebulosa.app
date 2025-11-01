import { createScope, molecule, onMount } from 'bunshi'
import { formatDEC, formatRA } from 'nebulosa/src/angle'
import { numericKeyword } from 'nebulosa/src/fits'
import type { ImageFormat } from 'nebulosa/src/image'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { DetectedStar } from 'nebulosa/src/stardetector'
import bus, { unsubscribe } from 'src/shared/bus'
import { type AnnotatedSkyObject, type CameraCaptureEvent, DEFAULT_IMAGE_TRANSFORMATION, DEFAULT_PLATE_SOLVE_START, DEFAULT_STAR_DETECTION, type EquatorialCoordinate, type ImageInfo, type ImageTransformation, type PlateSolveStart, type StarDetection } from 'src/shared/types'
import type { PickByValue } from 'utility-types'
import { proxy, ref, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { CoordinateInterpolator } from '@/shared/coordinate-interpolation'
import { storage } from '@/shared/storage'
import type { Image } from '@/shared/types'
import { ImageWorkspaceMolecule } from './workspace'

export interface CachedImage {
	url: string
	state: ImageState
	mouseCoordinateOnMoveHandler?: (event: MouseEvent) => void
	mouseCoordinateOnPointerUpHandler?: (event: MouseEvent) => void
}

export interface ImageState {
	readonly transformation: ImageTransformation
	crosshair: boolean
	readonly mouseCoordinate: {
		visible: boolean
		interpolator?: CoordinateInterpolator
		coordinate: EquatorialCoordinate
	}
	rotation: number
	info?: ImageInfo
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
	readonly solver: {
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
	readonly annotation: {
		show: boolean
		visible: boolean
		loading: boolean
		stars: AnnotatedSkyObject[]
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
	readonly save: {
		show: boolean
		loading: boolean
		path: string
		format: ImageFormat
		transformed: boolean
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

const DEFAULT_IMAGE_STATE: ImageState = {
	transformation: DEFAULT_IMAGE_TRANSFORMATION,
	crosshair: false,
	mouseCoordinate: {
		visible: false,
		coordinate: {
			rightAscension: 0,
			declination: 0,
		},
	},
	rotation: 0,
	scale: 1,
	starDetection: {
		show: false,
		visible: false,
		loading: false,
		stars: [],
		request: DEFAULT_STAR_DETECTION,
		computed: {
			hfd: 0,
			snr: 0,
			fluxMin: 0,
			fluxMax: 0,
		},
	},
	solver: {
		show: false,
		loading: false,
		request: DEFAULT_PLATE_SOLVE_START,
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
	annotation: {
		show: false,
		visible: false,
		loading: false,
		stars: [],
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
	save: {
		show: false,
		loading: false,
		path: '',
		format: 'fits',
		transformed: false,
	},
	settings: {
		show: false,
		pixelated: true,
	},
}

const imageCache = new Map<string, CachedImage>()

export const ImageViewerScope = createScope<ImageViewerScopeValue>({ image: { key: '', path: '', position: 0, source: 'file' } })

export const ImageViewerMolecule = molecule((m, s) => {
	const scope = s(ImageViewerScope)

	const workspace = m(ImageWorkspaceMolecule)
	const { key, path, camera } = scope.image

	let target = document.getElementById(key) as HTMLImageElement | null

	const storageKey = camera?.name || 'default'
	const cachedImageState = imageCache.get(key)?.state
	const transformationState = cachedImageState?.transformation ?? storage.get(`image.transformation.${storageKey}`, () => storage.get('image.transformation.default', () => structuredClone(DEFAULT_IMAGE_STATE.transformation)))
	const starDetectionState = cachedImageState?.starDetection.request ?? storage.get(`image.stardetection.${storageKey}.request`, () => storage.get('image.stardetection.default.request', () => structuredClone(DEFAULT_IMAGE_STATE.starDetection.request)))
	const plateSolverState = cachedImageState?.solver.request ?? storage.get(`image.solver.${storageKey}.request`, () => storage.get('image.solver.default.request', () => structuredClone(DEFAULT_IMAGE_STATE.solver.request)))
	const settingsState = cachedImageState?.settings ?? storage.get(`image.settings.${storageKey}`, () => storage.get('image.settings.default', () => structuredClone(DEFAULT_IMAGE_STATE.settings)))
	const saveState = cachedImageState?.save ?? storage.get(`image.save.${storageKey}`, () => storage.get('image.save.default', () => structuredClone(DEFAULT_IMAGE_STATE.save)))

	starDetectionState.path = path
	plateSolverState.id = key
	plateSolverState.path = path
	settingsState.show = false
	saveState.show = false

	const state =
		cachedImageState ??
		proxy<ImageState>({
			transformation: transformationState,
			crosshair: storage.get('image.crosshair', false),
			rotation: storage.get('image.rotation', 0),
			mouseCoordinate: structuredClone(DEFAULT_IMAGE_STATE.mouseCoordinate),
			scale: 1,
			info: undefined,
			starDetection: {
				...structuredClone(DEFAULT_IMAGE_STATE.starDetection),
				request: starDetectionState,
			},
			solver: {
				...structuredClone(DEFAULT_IMAGE_STATE.solver),
				request: plateSolverState,
			},
			scnr: structuredClone(DEFAULT_IMAGE_STATE.scnr),
			stretch: structuredClone(DEFAULT_IMAGE_STATE.stretch),
			adjustment: structuredClone(DEFAULT_IMAGE_STATE.adjustment),
			filter: structuredClone(DEFAULT_IMAGE_STATE.filter),
			annotation: structuredClone(DEFAULT_IMAGE_STATE.annotation),
			fitsHeader: structuredClone(DEFAULT_IMAGE_STATE.fitsHeader),
			roi: structuredClone(DEFAULT_IMAGE_STATE.roi),
			save: saveState,
			settings: settingsState,
		})

	// Save the state in the cache
	imageCache.set(key, { url: '', state })

	let loading = false

	onMount(() => {
		const unsubscribers = new Array<VoidFunction | undefined>(7)

		if (camera) {
			unsubscribers[0] = bus.subscribe<CameraCaptureEvent>('camera:capture', (event) => {
				if (event.device === camera.name && event.savedPath) {
					void load(true, event.savedPath)
				}
			})
		}

		unsubscribers[1] = subscribe(state.transformation, () => {
			storage.set(`image.transformation.${storageKey}`, state.transformation)
		})

		unsubscribers[2] = subscribe(state.starDetection.request, () => {
			storage.set(`image.stardetection.${storageKey}.request`, state.starDetection.request)
		})

		unsubscribers[3] = subscribe(state.solver.request, () => {
			storage.set(`image.solver.${storageKey}.request`, state.solver.request)
		})

		unsubscribers[4] = subscribe(state.settings, () => {
			storage.set(`image.settings.${storageKey}`, state.settings)
		})

		unsubscribers[5] = subscribe(state.save, () => {
			storage.set(`image.save.${storageKey}`, state.save)
		})

		unsubscribers[6] = subscribeKey(state.mouseCoordinate, 'visible', async (enabled) => {
			if (enabled && !state.mouseCoordinate.interpolator && state.solver.solution) {
				const coordinateInterpolation = await Api.Image.coordinateInterpolation(state.solver.solution)

				if (coordinateInterpolation) {
					const { ma, md, x0, y0, x1, y1, delta } = coordinateInterpolation
					state.mouseCoordinate.interpolator = ref(new CoordinateInterpolator(ma, md, x0, y0, x1, y1, delta))
				} else {
					return
				}
			}

			const cached = imageCache.get(key)
			const parent = target?.parentElement

			if (cached && parent) {
				cached.mouseCoordinateOnPointerUpHandler && parent.removeEventListener('pointerup', cached.mouseCoordinateOnPointerUpHandler)
				cached.mouseCoordinateOnMoveHandler && parent.removeEventListener('mousemove', cached.mouseCoordinateOnMoveHandler)

				cached.mouseCoordinateOnPointerUpHandler = undefined
				cached.mouseCoordinateOnMoveHandler = undefined

				if (enabled && state.mouseCoordinate.interpolator) {
					cached.mouseCoordinateOnPointerUpHandler = (event) => showInterpolatedCoordinate(event.offsetX, event.offsetY)
					cached.mouseCoordinateOnMoveHandler = (event) => showInterpolatedCoordinate(event.offsetX, event.offsetY)

					parent.addEventListener('pointerup', cached.mouseCoordinateOnPointerUpHandler)
					parent.addEventListener('mousemove', cached.mouseCoordinateOnMoveHandler)
				}
			}
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function showInterpolatedCoordinate(x: number, y: number) {
		const { interpolator } = state.mouseCoordinate

		if (interpolator) {
			const [rightAscension, declination] = interpolator.interpolate(x, y)
			state.mouseCoordinate.coordinate.rightAscension = rightAscension
			state.mouseCoordinate.coordinate.declination = declination
		}
	}

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

	function toggleMouseCoordinate() {
		state.mouseCoordinate.visible = !state.mouseCoordinate.visible
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
			state.info = ref(image.info)
			updateFromImageInfo(image.info, !!path)

			// Add the image to cache
			const cached = imageCache.get(key)

			if (cached) {
				console.info('image revoked', key, cached.url)
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

	function updateFromImageInfo(info: ImageInfo, newImage: boolean) {
		updateTransformationFromInfo(info)
		updateSolverFromImageInfo(info, newImage)
	}

	function updateTransformationFromInfo(info: ImageInfo) {
		// Update stretch transformation
		state.transformation.stretch.auto = info.transformation.stretch.auto
		state.transformation.stretch.shadow = info.transformation.stretch.shadow
		state.transformation.stretch.highlight = info.transformation.stretch.highlight
		state.transformation.stretch.midtone = info.transformation.stretch.midtone
	}

	function updateSolverFromImageInfo(info: ImageInfo, newImage: boolean) {
		if (newImage) {
			const { request } = state.solver

			// Update current solution
			state.solver.solution = info.solution && ref(info.solution)

			// Update plate solver request with FITS header information
			request.rightAscension = formatRA(info.rightAscension ?? 0)
			request.declination = formatDEC(info.declination ?? 0)
			request.blind = info.rightAscension === undefined || info.declination === undefined

			if (info.headers) {
				request.focalLength = numericKeyword(info.headers, 'FOCALLEN', request.focalLength)
				request.pixelSize = numericKeyword(info.headers, 'XPIXSZ', request.pixelSize)
			}
		}
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
			console.info('image revoked', key, cached.url)
			URL.revokeObjectURL(cached.url)
			imageCache.delete(key)
		}

		console.info('image detached', key)

		adjustZIndexAfterBeRemoved()

		workspace.state.selected = undefined
	}

	return { state, scope, resetStretch, toggleAutoStretch, toggleDebayer, toggleHorizontalMirror, toggleVerticalMirror, toggleInvert, toggleCrosshair, toggleMouseCoordinate, attach, load, open, remove, detach, select, show, hide, apply }
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
