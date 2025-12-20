import { createScope, molecule, onMount, use } from 'bunshi'
import bus from 'src/shared/bus'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageInfo, type ImageTransformation } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy, ref } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import type { Image, ImageLoaded } from '@/shared/types'
import type { InteractableMethods } from '@/ui/Interactable'
import { ImageWorkspaceMolecule } from './workspace'

export interface CachedImage {
	url: string
	state: ImageState
}

export interface ImageState {
	readonly transformation: ImageTransformation
	crosshair: boolean
	angle: number
	info?: ImageInfo
	scale: number
}

export interface ImageViewerScopeValue {
	readonly image: Image
}

const DEFAULT_IMAGE_STATE: ImageState = {
	transformation: DEFAULT_IMAGE_TRANSFORMATION,
	crosshair: false,
	angle: 0,
	scale: 1,
}

const stateMap = new Map<string, CachedImage>()

export const ImageViewerScope = createScope<ImageViewerScopeValue>({ image: { key: '', path: '', position: 0, source: 'file' } })

export const ImageViewerMolecule = molecule(() => {
	const scope = use(ImageViewerScope)
	const workspace = use(ImageWorkspaceMolecule)
	const { key, camera } = scope.image

	let target = document.getElementById(key) as HTMLImageElement | null | undefined
	let interactable: InteractableMethods | undefined
	let first = false

	const state =
		stateMap.get(key)?.state ??
		proxy<ImageState>({
			transformation: structuredClone(DEFAULT_IMAGE_STATE.transformation),
			crosshair: false,
			angle: 0,
			scale: 1,
			info: undefined,
		})

	// Save the state in the cache
	stateMap.set(key, { url: '', state })

	let loading = false

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(2)

		const imageKey = camera?.name || 'default'

		unsubscribers[0] = initProxy(state, `image.${imageKey}`, ['o:transformation', 'p:crosshair', 'p:angle'])

		unsubscribers[1] = subscribeKey(state.transformation, 'format', () => {
			void load(true)
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function realPath() {
		return state.info?.realPath || scope.image.path
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

	function remove() {
		workspace.remove(scope.image)
	}

	async function load(force: boolean = false, path?: string) {
		if (loading) return

		loading = true

		console.info('loading image', key, path)

		const cached = stateMap.get(key)

		// Not loaded yet or forced to load
		if (!cached?.url || force || path) {
			await open(path)
		}
		// Load the image from cache
		else if (target) {
			target.src = cached.url
			console.info('image loaded from cache', key, cached.url)
		} else {
			console.warn('image not mounted yet', key)
		}

		loading = false
	}

	async function open(path?: string) {
		try {
			loading = true

			console.info('opening image', key, path)

			// Load the image
			const image = await Api.Image.open({ path: path || realPath(), transformation: state.transformation, camera: camera?.name })

			if (!image) return remove()

			const url = URL.createObjectURL(image.blob)

			// Update the state
			state.info = ref(image.info)
			updateFromImageInfo(image.info)

			// Add the image to cache
			const cached = stateMap.get(key)

			const newImage = !!path || !cached?.url

			if (cached) {
				if (cached.url) {
					console.info('image revoked', key, cached.url)
					URL.revokeObjectURL(cached.url)
				}

				cached.url = url
			} else {
				stateMap.set(key, { url, state })
			}

			if (target) {
				target.src = url

				bus.emit<ImageLoaded>('image:load', { image: scope.image, info: image.info, newImage })

				console.info('image loaded', key, url, image.info)
			} else {
				console.warn('image not mounted yet', key)
			}
		} finally {
			loading = false
		}
	}

	function updateFromImageInfo(info: ImageInfo) {
		updateTransformationFromInfo(info)
	}

	function updateTransformationFromInfo(info: ImageInfo) {
		// Update stretch transformation
		state.transformation.stretch.auto = info.transformation.stretch.auto
		state.transformation.stretch.shadow = info.transformation.stretch.shadow
		state.transformation.stretch.highlight = info.transformation.stretch.highlight
		state.transformation.stretch.midtone = info.transformation.stretch.midtone
	}

	function handleOnLoad() {
		if (!first) {
			first = true

			interactable?.center()
		}
	}

	function rotateTo(angle: number) {
		interactable?.rotateTo(angle)
	}

	function resetRotation() {
		interactable?.resetRotation()
	}

	function select() {
		if (!target) return
		workspace.state.selected = scope.image
		bringToFront(target)
	}

	function attachImage(node: HTMLImageElement | null) {
		if (node) {
			target = node
			void load(false)
			select()
		}
	}

	function attachInteractable(i: InteractableMethods) {
		interactable = i
	}

	function detach() {
		if (loading) return

		const cached = stateMap.get(key)

		if (cached) {
			console.info('image revoked', key, cached.url)
			URL.revokeObjectURL(cached.url)
			stateMap.delete(key)
		}

		console.info('image detached', key)

		adjustZIndexAfterBeRemoved()

		workspace.state.selected = undefined
		target = undefined
		interactable = undefined
	}

	return {
		state,
		scope,
		get path() {
			return realPath()
		},
		get target() {
			return target
		},
		toggleDebayer,
		toggleHorizontalMirror,
		toggleVerticalMirror,
		toggleInvert,
		toggleCrosshair,
		attachImage,
		attachInteractable,
		load,
		handleOnLoad,
		rotateTo,
		resetRotation,
		remove,
		detach,
		select,
	} as const
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
