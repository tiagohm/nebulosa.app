import { Api } from '@shared/api'
import { imageBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { framingStore } from '@stores/framing.store'
import { imageAdjustmentStore } from '@stores/image.adjustment.store'
import type { ImageAdjustmentStore } from '@stores/image.adjustment.store'
import { imageAnnotationStore } from '@stores/image.annotation.store'
import type { ImageAnnotationStore } from '@stores/image.annotation.store'
import { imageCalibrationStore } from '@stores/image.calibration.store'
import type { ImageCalibrationStore } from '@stores/image.calibration.store'
import { imageCoordinateGridStore } from '@stores/image.coordinategrid.store'
import type { ImageCoordinateGridStore } from '@stores/image.coordinategrid.store'
import { imageCrosshairStore } from '@stores/image.crosshair.store'
import type { ImageCrosshairStore } from '@stores/image.crosshair.store'
import { imageDebayerStore } from '@stores/image.debayer.store'
import type { ImageDebayerStore } from '@stores/image.debayer.store'
import { imageFilterStore } from '@stores/image.filter.store'
import type { ImageFilterStore } from '@stores/image.filter.store'
import { imageFovStore } from '@stores/image.fov.store'
import type { ImageFovStore } from '@stores/image.fov.store'
import { imageHeaderStore } from '@stores/image.header.store'
import type { ImageHeaderStore } from '@stores/image.header.store'
import type { ImageHomeStore } from '@stores/image.home.store'
import { imageLoadStore } from '@stores/image.load.store'
import type { ImageLoadStore } from '@stores/image.load.store'
import { imageMouseCoordinateStore } from '@stores/image.mousecoordinate.store'
import type { ImageMouseCoordinateStore } from '@stores/image.mousecoordinate.store'
import { imageRoiStore } from '@stores/image.roi.store'
import type { ImageRoiStore } from '@stores/image.roi.store'
import { imageRotationStore } from '@stores/image.rotation.store'
import type { ImageRotationStore } from '@stores/image.rotation.store'
import { imageSaveStore } from '@stores/image.save.store'
import type { ImageSaveStore } from '@stores/image.save.store'
import { imageScnrStore } from '@stores/image.scnr.store'
import type { ImageScnrStore } from '@stores/image.scnr.store'
import { imageSettingsStore } from '@stores/image.settings.store'
import type { ImageSettingsStore } from '@stores/image.settings.store'
import { imageSolverStore } from '@stores/image.solver.store'
import type { ImageSolverStore } from '@stores/image.solver.store'
import { imageStarDetectionStore } from '@stores/image.stardetection.store'
import type { ImageStarDetectionStore } from '@stores/image.stardetection.store'
import { imageStatisticsStore } from '@stores/image.statistics.store'
import type { ImageStatisticsStore } from '@stores/image.statistics.store'
import { imageStretchStore } from '@stores/image.stretch.store'
import type { ImageStretchStore } from '@stores/image.stretch.store'
import type { SlideMenuItem, SlideMenuProps } from '@ui/components/SlideMenu'
import type { InteractableMethods } from '@ui/Interactable'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { Writable } from 'nebulosa/src/core/types'
import type { Mount } from 'nebulosa/src/devices/indi/device'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import { pmod } from 'nebulosa/src/math/numerical/math'
import { formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref, snapshot, subscribe } from 'valtio'
import type { Framing } from '#/framing'
import type { Image, ImageTransformation, ImageInfo } from '#/image'
import { DEFAULT_IMAGE_TRANSFORMATION } from '#/image'

export interface ImageViewerStore {
	readonly state: ImageViewerState
	readonly home: ImageHomeStore
	readonly loader: ImageLoadStore
	readonly image: Image
	readonly key: string // The storage key
	readonly target: HTMLImageElement | undefined
	readonly mount: () => VoidFunction
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
	// Releases an undecodable blob without presenting its overlay.
	readonly handleError: (event: React.SyntheticEvent<HTMLImageElement>) => void
	readonly select: VoidFunction
	readonly detach: VoidFunction
	readonly toggleClass: (token: string, force?: boolean) => void
	readonly remove: VoidFunction
	readonly close: () => Promise<unknown>
	readonly handleAction: SlideMenuProps['onAction']
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
	readonly debayer: ImageDebayerStore
	readonly crosshair: ImageCrosshairStore
	readonly rotation: ImageRotationStore
}

export interface ImageViewerState {
	readonly transformation: ImageTransformation
	angle: number // deg
	scale: number
	info?: ImageInfo
	path: string
}

export function imageViewerStore(image: Image, home: ImageHomeStore): ImageViewerStore {
	const state = proxy<ImageViewerState>({
		transformation: structuredClone(DEFAULT_IMAGE_TRANSFORMATION),
		angle: 0,
		scale: 1,
		info: undefined,
		path: image.path,
	})

	const { camera } = image

	console.info('image viewer created:', state.path, camera?.name)

	const u: VoidFunction[] = []
	let mounted = false
	let interactable: InteractableMethods | undefined
	let target: HTMLImageElement | undefined
	let centered = false
	const key = camera?.id || 'default'

	const loader = imageLoadStore({
		open: (path, transformation, signal) => Api.Image.open({ path, transformation, camera: camera?.name }, signal),
		loaded: (info) => {
			const first = state.info === undefined
			state.info = ref(info)
			state.path = info.path
			imageBus.emit('load', { image, info, first, refreshed: true })
		},
	})

	function mount() {
		if (mounted) return unmount

		console.info('image viewer mounted:', state.path)

		mounted = true

		u[0] = initProxy(state, `image.${key}`, ['o:transformation', 'p:angle'])

		u[1] = subscribe(state.transformation.format, () => {
			void reload()
		})

		window.addEventListener('beforeunload', close)

		const timer = window.setInterval(ping, 30000)
		u[2] = window.clearInterval.bind(window, timer)

		// Home forwards camera frames to this image's update topic. Listening to both topics would
		// enqueue two HTTP loads for every exposure, discarding the first response unnecessarily.
		u[3] = imageBus.subscribe('update', (event) => {
			if (event.image.id === image.id) {
				void load(event.path)
			}
		})

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image viewer unmounted:', state.path)
		unsubscribe(u)
		loader.detach()
		window.removeEventListener('beforeunload', close)
		mounted = false
	}

	function attachImage(node: HTMLImageElement | null) {
		if (node !== null) {
			target = node
			loader.attach(node)
		}
	}

	function attachInteractable(i: InteractableMethods) {
		interactable = i
	}

	function ping() {
		return Api.Image.ping({ path: state.path, camera: camera?.name })
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

	// Queues the latest image with a private processing snapshot; identity comes back with the pixels.
	function load(path: string | true = '') {
		return loader.load(path === true || path === '' ? state.path : path, structuredClone(snapshot(state.transformation)))
	}

	function reload() {
		return load(true)
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
		if (!loader.handleLoad(target)) return

		if (!centered && interactable !== undefined) {
			interactable.center()
			centered = true
		}
	}

	function handleAction(id: React.Key, item: SlideMenuItem) {
		switch (id) {
			case 'invert':
				void toggleInvert()
				break
			case 'verticalMirror':
				void toggleVerticalMirror()
				break
			case 'horizontalMirror':
				void toggleHorizontalMirror()
				break
		}
	}

	// Clears failed image metadata and releases its blob URL.
	function handleError(event: React.SyntheticEvent<HTMLImageElement>) {
		loader.handleError(event.currentTarget)
	}

	function detach() {
		loader.detach()

		console.info('image detached:', state.path)

		target = undefined
		interactable = undefined
	}

	function toggleClass(token: string, force?: boolean) {
		target?.classList.toggle(token, force)
	}

	function remove() {}

	function close() {
		return Api.Image.close({ path: state.path, camera: camera?.name })
	}

	const store = {
		loader,
		state,
		home,
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
		handleAction,
		handleError,
		detach,
		toggleClass,
		remove,
		close,
	} as Writable<ImageViewerStore>

	store.adjustment = imageAdjustmentStore(store)
	store.annotation = imageAnnotationStore(store)
	store.calibration = imageCalibrationStore(store)
	store.coordinateGrid = imageCoordinateGridStore(store)
	store.filter = imageFilterStore(store)
	store.fov = imageFovStore(store)
	store.header = imageHeaderStore(store)
	store.mouseCoordinate = imageMouseCoordinateStore(store)
	store.roi = imageRoiStore(store)
	store.save = imageSaveStore(store)
	store.scnr = imageScnrStore(store)
	store.settings = imageSettingsStore(store)
	store.solver = imageSolverStore(store)
	store.starDetection = imageStarDetectionStore(store)
	store.statistics = imageStatisticsStore(store)
	store.stretch = imageStretchStore(store)
	store.debayer = imageDebayerStore(store)
	store.crosshair = imageCrosshairStore(store)
	store.rotation = imageRotationStore(store)

	return store
}
