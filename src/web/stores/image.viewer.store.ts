import { formatDEC, formatRA } from 'nebulosa/src/angle'
import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import { numericKeyword } from 'nebulosa/src/fits.util'
import type { Mount } from 'nebulosa/src/indi.device'
import { pmod } from 'nebulosa/src/math'
import type { Writable } from 'nebulosa/src/types'
import bus from 'src/shared/bus'
import { type ImageTransformation, type ImageInfo, DEFAULT_IMAGE_TRANSFORMATION, type Framing, type Roi } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref, subscribe } from 'valtio'
import type { Image, ImageLoaded, ImageRoiRequest } from '@/shared/types'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { InteractableMethods } from '../ui/Interactable'
import { framingStore } from './framing.store'
import { imageAdjustmentStore, type ImageAdjustmentStore } from './image.adjustment.store'
import { imageAnnotationStore, type ImageAnnotationStore } from './image.annotation.store'
import { imageCalibrationStore, type ImageCalibrationStore } from './image.calibration.store'
import { imageCoordinateGridStore, type ImageCoordinateGridStore } from './image.coordinategrid.store'
import { imageFilterStore, type ImageFilterStore } from './image.filter.store'
import { imageFovStore, type ImageFovStore } from './image.fov.store'
import { imageHeaderStore, type ImageHeaderStore } from './image.header.store'
import { imageMouseCoordinateStore, type ImageMouseCoordinateStore } from './image.mousecoordinate.store'
import { imageRoiStore, type ImageRoiStore } from './image.roi.store'
import { imageSaveStore, type ImageSaveStore } from './image.save.store'
import { imageScnrStore, type ImageScnrStore } from './image.scnr.store'
import { imageSettingsStore, type ImageSettingsStore } from './image.settings.store'
import { imageSolverStore, type ImageSolverStore } from './image.solver.store'
import { imageStarDetectionStore, type ImageStarDetectionStore } from './image.stardetection.store'
import { imageStatisticsStore, type ImageStatisticsStore } from './image.statistics.store'
import { imageStretchStore, type ImageStretchStore } from './image.stretch.store'
import { imageWorkspaceStore } from './image.workspace.store'

export interface ImageViewerStore {
	readonly state: ImageViewerState
	readonly image: Image
	readonly key: string // The storage key
	readonly target: HTMLImageElement | undefined
	readonly mount: VoidFunction
	readonly unmount: VoidFunction
	readonly attachImage: (node: HTMLImageElement | null) => void
	readonly attachInteractable: (i: InteractableMethods) => void
	readonly toggleDebayer: () => Promise<void>
	readonly toggleHorizontalMirror: () => Promise<void>
	readonly toggleVerticalMirror: () => Promise<void>
	readonly toggleInvert: () => Promise<void>
	readonly toggleCrosshair: VoidFunction
	readonly load: (path?: string | boolean) => Promise<void>
	readonly reload: () => Promise<void>
	readonly rotateTo: (angle: number) => void
	readonly rotateLeft: VoidFunction
	readonly rotateRight: VoidFunction
	readonly rotateToZero: VoidFunction
	readonly enableRotation: VoidFunction
	readonly disableRotation: VoidFunction
	readonly pointMountHere: (mount: Mount, coordinate: EquatorialCoordinate) => Promise<unknown>
	readonly syncMountHere: (mount: Mount, coordinate: EquatorialCoordinate) => Promise<unknown>
	readonly frameAt: (coordinate: EquatorialCoordinate) => Promise<void>
	readonly handleLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void
	readonly select: VoidFunction
	readonly detach: VoidFunction
	readonly toggleClass: (token: string, force?: boolean) => void
	readonly remove: VoidFunction
	readonly close: () => Promise<unknown>
	readonly adjustment: ImageAdjustmentStore
	readonly annotation: ImageAnnotationStore
	readonly calibration: ImageCalibrationStore
	readonly coordinateGrid: ImageCoordinateGridStore
	readonly filter: ImageFilterStore
	readonly fov: ImageFovStore
	readonly header: ImageHeaderStore
	readonly mouseCoordinate: ImageMouseCoordinateStore
	readonly roi: ImageRoiStore
	readonly save: ImageSaveStore
	readonly scnr: ImageScnrStore
	readonly settings: ImageSettingsStore
	readonly solver: ImageSolverStore
	readonly starDetection: ImageStarDetectionStore
	readonly statistics: ImageStatisticsStore
	readonly stretch: ImageStretchStore
}

export interface ImageViewerState {
	readonly transformation: ImageTransformation
	crosshair: boolean
	angle: number // deg
	scale: number
	info?: ImageInfo
	path: string
}

export function imageViewerStore(image: Image): ImageViewerStore {
	const state = proxy<ImageViewerState>({
		transformation: structuredClone(DEFAULT_IMAGE_TRANSFORMATION),
		crosshair: false,
		angle: 0,
		scale: 1,
		info: undefined,
		path: image.path,
	})

	const { camera } = image

	console.info('image viewer created:', state.path, camera?.name)

	const u: VoidFunction[] = []
	let mounted = false
	let loading = false
	let interactable: InteractableMethods | undefined
	let target: HTMLImageElement | undefined
	let centered = false
	const stores: Pick<ImageViewerStore, 'mount' | 'unmount'>[] = []
	const key = camera?.id || 'default'

	function mount() {
		if (mounted) return

		console.info('image viewer mounted:', state.path)

		mounted = true

		u[0] = initProxy(state, `image.${key}`, ['o:transformation', 'p:crosshair', 'p:angle'])

		u[1] = subscribe(state.transformation.format, () => {
			void reload()
		})

		window.addEventListener('beforeunload', close)

		const timer = window.setInterval(ping, 30000)
		u[2] = window.clearInterval.bind(window, timer)

		for (const s of stores) s.mount()
	}

	function unmount() {
		if (!mounted) return
		console.info('image viewer unmounted:', state.path)
		unsubscribe(u)
		window.removeEventListener('beforeunload', close)
		for (const s of stores) s.unmount()
		mounted = false
	}

	function attachImage(node: HTMLImageElement | null) {
		if (node) {
			target = node
			select()
		}
	}

	function attachInteractable(i: InteractableMethods) {
		interactable = i
	}

	function ping() {
		return Api.Image.ping({ path: state.path, hash: state.info?.hash, camera: camera?.name })
	}

	function toggleDebayer() {
		state.transformation.debayer = !state.transformation.debayer
		return reload()
	}

	function toggleHorizontalMirror() {
		state.transformation.horizontalMirror = !state.transformation.horizontalMirror
		return reload()
	}

	function toggleVerticalMirror() {
		state.transformation.verticalMirror = !state.transformation.verticalMirror
		return reload()
	}

	function toggleInvert() {
		state.transformation.invert = !state.transformation.invert
		return reload()
	}

	function toggleCrosshair() {
		state.crosshair = !state.crosshair
	}

	async function load(path: string | boolean = state.path) {
		if (loading) return

		console.info('loading image:', path)

		try {
			loading = true

			if (path) {
				await open(path === true ? state.path : path)
			}
		} finally {
			loading = false
		}
	}

	function reload() {
		return load(true)
	}

	async function open(path: string) {
		try {
			loading = true

			// Load the image
			console.info(state.transformation.stretch)
			const data = await Api.Image.open({ path, transformation: state.transformation, camera: camera?.name })

			if (data === undefined) {
				return remove()
			}

			const url = URL.createObjectURL(data.blob)

			// Update the state
			const refreshed = state.info === undefined || state.path !== path
			state.info = ref(data.info)
			state.path = state.info.path

			if (target) {
				target.src = url

				bus.emit('image:load', { image, info: data.info, refreshed } satisfies ImageLoaded)

				console.info('image loaded:', path, url, data.info)
			} else {
				console.warn('image not mounted yet:', path)
			}
		} finally {
			loading = false
		}
	}

	function rotateTo(angle: number) {
		interactable?.rotateTo(angle)
	}

	function rotateLeft() {
		interactable && rotateTo(interactable.angle - 90)
	}

	function rotateRight() {
		interactable && rotateTo(interactable.angle + 90)
	}

	function rotateToZero() {
		rotateTo(0)
	}

	function enableRotation() {
		interactable?.enableRotation()
	}

	function disableRotation() {
		interactable?.disableRotation()
	}

	function pointMountHere(mount: Mount, coordinate: EquatorialCoordinate) {
		return Api.Mounts.goTo(mount, { type: 'J2000', J2000: { x: coordinate.rightAscension, y: coordinate.declination } })
	}

	function syncMountHere(mount: Mount, coordinate: EquatorialCoordinate) {
		return Api.Mounts.sync(mount, { type: 'J2000', J2000: { x: coordinate.rightAscension, y: coordinate.declination } })
	}

	function frameAt(coordinate: EquatorialCoordinate) {
		const focalLength = state.info && numericKeyword(state.info.headers, 'FOCALLEN', undefined)
		const pixelSize = state.info && numericKeyword(state.info.headers, 'XPIXSZ', undefined)
		const rotation = state.info?.solution ? pmod(state.info.solution.orientation + state.angle, 360) : state.angle
		const width = state.info ? Math.min(state.info.width, 1280) : 1280
		const aspectRatio = state.info ? state.info.height / state.info.width : 1
		const request: Partial<Framing> = { rightAscension: formatRA(coordinate.rightAscension), declination: formatDEC(coordinate.declination), width, height: Math.trunc(width * aspectRatio), rotation, focalLength, pixelSize }
		return framingStore.load(request)
	}

	function handleLoad(event: React.SyntheticEvent<HTMLImageElement>) {
		const target = event.currentTarget
		URL.revokeObjectURL(target.src)

		if (!centered && interactable !== undefined) {
			interactable.center()
			centered = true
		}
	}

	function select() {
		if (!target) return
		imageWorkspaceStore.state.selected = ref(image)
		bringToFront(target)
	}

	function detach() {
		if (loading) return

		console.info('image detached:', state.path)

		adjustZIndexAfterBeRemoved()

		imageWorkspaceStore.unlink(image)
		imageWorkspaceStore.state.selected = undefined
		target = undefined
		interactable = undefined
	}

	function toggleClass(token: string, force?: boolean) {
		target?.classList.toggle(token, force)
	}

	function remove() {
		imageWorkspaceStore.remove(image)
	}

	function close() {
		return Api.Image.close({ path: state.path, hash: state.info?.hash, camera: camera?.name })
	}

	const store = {
		state,
		image,
		key,
		get target() {
			return target
		},
		mount,
		unmount,
		attachImage,
		attachInteractable,
		toggleDebayer,
		toggleHorizontalMirror,
		toggleVerticalMirror,
		toggleInvert,
		toggleCrosshair,
		load,
		reload,
		rotateTo,
		rotateLeft,
		rotateRight,
		rotateToZero,
		enableRotation,
		disableRotation,
		pointMountHere,
		syncMountHere,
		frameAt,
		handleLoad,
		select,
		detach,
		toggleClass,
		remove,
		close,
	} as Writable<ImageViewerStore>

	const adjustment = (store.adjustment = imageAdjustmentStore(store))
	const annotation = (store.annotation = imageAnnotationStore(store))
	const calibration = (store.calibration = imageCalibrationStore(store))
	const coordinateGrid = (store.coordinateGrid = imageCoordinateGridStore(store))
	const filter = (store.filter = imageFilterStore(store))
	const fov = (store.fov = imageFovStore(store))
	const header = (store.header = imageHeaderStore(store))
	const mouseCoordinate = (store.mouseCoordinate = imageMouseCoordinateStore(store))
	const roi = (store.roi = imageRoiStore(store))
	const save = (store.save = imageSaveStore(store))
	const scnr = (store.scnr = imageScnrStore(store))
	const settings = (store.settings = imageSettingsStore(store))
	const solver = (store.solver = imageSolverStore(store))
	const starDetection = (store.starDetection = imageStarDetectionStore(store))
	const statistics = (store.statistics = imageStatisticsStore(store))
	const stretch = (store.stretch = imageStretchStore(store))

	stores.push(adjustment, annotation, calibration, coordinateGrid, filter, fov, header, mouseCoordinate, roi, save, scnr, settings, solver, starDetection, statistics, stretch)

	return store
}

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
	const selected = e.closest<HTMLElement>('.wrapper')!
	const wrappers = selected.closest('.workspace')?.querySelectorAll('.wrapper') ?? []

	// Only exist one element and it is already at the top
	if (wrappers.length === 1) return

	// Selected element z-index
	const zIndex = +selected.style.zIndex
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

function imageRoiRequestTopic(image: string) {
	return `image:${image}:roi:request`
}

function imageRoiSubframeSnapshotTopic(image: string) {
	return `image:${image}:roi:subframe:snapshot`
}

export function subscribeToImageRoiRequests(image: Image, callback: (options?: ImageRoiRequest) => void) {
	return bus.subscribe(imageRoiRequestTopic(image.id), callback)
}

export function sendImageRoiSubframeSnapshot(image: Image, subframe: Roi) {
	bus.emitSync(imageRoiSubframeSnapshotTopic(image.id), subframe)
}
