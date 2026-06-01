import type { Point } from 'nebulosa/src/geometry'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CameraSubframe } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { initProxy } from '../shared/proxy'
import { sendCameraRoi, subscribeToCameraRoiRequests } from './camera.store'
import type { ImageViewerStore } from './image.viewer.store'

export type ImageRoiStore = ReturnType<typeof imageRoiStore>

export type ImageRoiHandle = 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export interface ImageRoiState {
	visible: boolean
	readonly roi: CameraSubframe
	readonly binning: Point
}

interface RoiGesture {
	readonly handle: ImageRoiHandle
	readonly pointerId: number
	readonly clientX: number
	readonly clientY: number
	readonly scale: number
	readonly angle: number
	readonly roi: CameraSubframe
	readonly aborter: AbortController
}

const MIN_ROI_SIZE = 2

export const IMAGE_ROI_HANDLES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const

export function imageRoiStore(viewer: ImageViewerStore) {
	const state = proxy<ImageRoiState>({
		visible: false,
		roi: { x: 0, y: 0, width: 0, height: 0 },
		binning: { x: 1, y: 1 },
	})

	console.info('image roi created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false

	let root: HTMLDivElement | undefined
	let label: HTMLDivElement | undefined
	let gesture: RoiGesture | undefined
	let bodyUserSelect: string | undefined

	const camera = viewer.image.camera

	function mount() {
		if (mounted) return

		console.info('image roi mounted:', viewer.state.path)

		mounted = true

		syncImage()

		if (camera) u[0] = initProxy(state, `image.roi.${camera.id}`, ['o:roi', 'o:binning'])
		u[1] = subscribeKey(viewer.state, 'info', syncImage)
	}

	function unmount() {
		if (!mounted) return
		console.info('image roi unmounted:', viewer.state.path)
		stopGesture()
		unsubscribe(u)
		mounted = false
	}

	function attachRoot(node: HTMLDivElement | null) {
		root = node ?? undefined
	}

	function attachLabel(node: HTMLDivElement | null) {
		label = node ?? undefined
	}

	function toggle() {
		if (!viewer.image.camera?.canSubFrame) return

		state.visible = !state.visible
	}

	function sync() {
		if (!state.visible) {
			stopGesture()
			return
		}

		syncImage()

		const unsubscribe = camera ? subscribeToCameraRoiRequests(camera, sendRoi) : undefined

		return () => {
			unsubscribe?.()
			stopGesture()
		}
	}

	function startGesture(handle: ImageRoiHandle, event: ReactPointerEvent<HTMLElement>) {
		if (event.button !== 0) return

		event.preventDefault()
		event.stopPropagation()
		stopGesture()
		disableBodyUserSelect()
		event.currentTarget.setPointerCapture(event.pointerId)

		const aborter = new AbortController()

		gesture = {
			handle,
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			scale: viewer.state.scale,
			angle: viewer.state.angle,
			roi: normalizeRoi(restoredRoi() ?? initialRoi()),
			aborter,
		}

		const options = { capture: true, signal: aborter.signal }
		window.addEventListener('pointermove', handlePointerMove, options)
		window.addEventListener('pointerup', handlePointerEnd, options)
		window.addEventListener('pointercancel', handlePointerEnd, options)
		window.addEventListener('mouseup', handleMouseEnd, options)
		window.addEventListener('blur', stopGesture, options)
	}

	function handlePointerMove(event: PointerEvent) {
		if (!gesture || event.pointerId !== gesture.pointerId) return
		if (event.buttons === 0) return stopGesture()

		event.preventDefault()

		const delta = localDelta(event.clientX - gesture.clientX, event.clientY - gesture.clientY, gesture.scale, gesture.angle)
		applyRoi(resizeRoi(gesture.roi, gesture.handle, delta.x, delta.y, imageBounds()))
	}

	function handlePointerEnd(event: PointerEvent) {
		if (event.pointerId === gesture?.pointerId) stopGesture()
	}

	function handleMouseEnd(event: MouseEvent) {
		if (event.buttons === 0) stopGesture()
	}

	function stopGesture() {
		gesture?.aborter.abort()
		gesture = undefined
		restoreBodyUserSelect()
	}

	function disableBodyUserSelect() {
		bodyUserSelect ??= document.body.style.userSelect
		document.body.style.userSelect = 'none'
	}

	function restoreBodyUserSelect() {
		if (bodyUserSelect !== undefined) {
			document.body.style.userSelect = bodyUserSelect
			bodyUserSelect = undefined
		}
	}

	function sendRoi() {
		const camera = viewer.image.camera

		if (camera && restoredRoi()) sendCameraRoi(camera, scaleRoi(state.roi, state.binning))
	}

	function applyRoi(roi: CameraSubframe, binning: Point = imageBinning()) {
		Object.assign(state.roi, roi)
		Object.assign(state.binning, binning)

		if (root) {
			root.style.left = `${roi.x}px`
			root.style.top = `${roi.y}px`
			root.style.width = `${roi.width}px`
			root.style.height = `${roi.height}px`
		}

		if (label) {
			label.textContent = `X: ${roi.x} | Y: ${roi.y} | W: ${roi.width} | H: ${roi.height}`
		}
	}

	function syncImage(info = viewer.state.info) {
		const binning = imageBinning(info)
		const roi = restoredRoi()

		if (roi) {
			applyRoi(normalizeRoi(rebinRoi(roi, state.binning, binning), info), binning)
		} else if (state.visible) {
			applyRoi(normalizeRoi(initialRoi(info), info), binning)
		} else {
			Object.assign(state.binning, binning)
		}
	}

	function initialRoi(info = viewer.state.info) {
		return centeredRoi(info)
	}

	function restoredRoi() {
		if (state.roi.width >= MIN_ROI_SIZE && state.roi.height >= MIN_ROI_SIZE) {
			return state.roi
		}
	}

	function imageBounds(info = viewer.state.info) {
		const width = info?.width || viewer.target?.naturalWidth || 0
		const height = info?.height || viewer.target?.naturalHeight || 0

		return {
			width: Math.max(1, Math.trunc(width)),
			height: Math.max(1, Math.trunc(height)),
		} as const
	}

	function centeredRoi(info = viewer.state.info): CameraSubframe {
		const bounds = imageBounds(info)
		const width = Math.max(1, Math.trunc(bounds.width / 2))
		const height = Math.max(1, Math.trunc(bounds.height / 2))

		return {
			x: Math.trunc((bounds.width - width) / 2),
			y: Math.trunc((bounds.height - height) / 2),
			width,
			height,
		}
	}

	function normalizeRoi(roi: CameraSubframe, info = viewer.state.info): CameraSubframe {
		const bounds = imageBounds(info)
		const width = clampInteger(roi.width, MIN_ROI_SIZE, bounds.width)
		const height = clampInteger(roi.height, MIN_ROI_SIZE, bounds.height)
		const x = clampInteger(roi.x, 0, bounds.width - width)
		const y = clampInteger(roi.y, 0, bounds.height - height)

		return { x, y, width, height }
	}

	function imageBinning(info = viewer.state.info): Point {
		const headers = info?.headers
		const x = Number(headers?.XBINNING)
		const y = Number(headers?.YBINNING)

		return {
			x: Number.isFinite(x) && x >= 1 ? Math.trunc(x) : 1,
			y: Number.isFinite(y) && y >= 1 ? Math.trunc(y) : 1,
		} as const
	}

	return {
		state,
		viewer,
		mount,
		unmount,
		attachRoot,
		attachLabel,
		toggle,
		sync,
		startGesture,
	} as const
}

function localDelta(screenX: number, screenY: number, scale: number, angle: number) {
	const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
	const radians = -angle * (Math.PI / 180)
	const x = screenX / safeScale
	const y = screenY / safeScale
	const cos = Math.cos(radians)
	const sin = Math.sin(radians)

	return {
		x: x * cos - y * sin,
		y: x * sin + y * cos,
	} as const
}

function resizeRoi(roi: CameraSubframe, handle: ImageRoiHandle, dx: number, dy: number, bounds: Pick<CameraSubframe, 'width' | 'height'>): CameraSubframe {
	if (handle === 'move') {
		return {
			x: clampInteger(Math.round(roi.x + dx), 0, bounds.width - roi.width),
			y: clampInteger(Math.round(roi.y + dy), 0, bounds.height - roi.height),
			width: roi.width,
			height: roi.height,
		}
	}

	let x1 = roi.x
	let y1 = roi.y
	let x2 = roi.x + roi.width
	let y2 = roi.y + roi.height

	if (handle.includes('w')) x1 = clampNumber(x1 + dx, 0, x2 - MIN_ROI_SIZE)
	if (handle.includes('e')) x2 = clampNumber(x2 + dx, x1 + MIN_ROI_SIZE, bounds.width)
	if (handle.includes('n')) y1 = clampNumber(y1 + dy, 0, y2 - MIN_ROI_SIZE)
	if (handle.includes('s')) y2 = clampNumber(y2 + dy, y1 + MIN_ROI_SIZE, bounds.height)

	return { x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) }
}

function rebinRoi(roi: CameraSubframe, from: Point | undefined, to: Point): CameraSubframe {
	if (!from || (from.x === to.x && from.y === to.y)) return roi

	return unscaleRoi(scaleRoi(roi, from), to)
}

function scaleRoi(roi: CameraSubframe, binning: Point): CameraSubframe {
	return { x: roi.x * binning.x, y: roi.y * binning.y, width: roi.width * binning.x, height: roi.height * binning.y }
}

function unscaleRoi(roi: CameraSubframe, binning: Point): CameraSubframe {
	return {
		x: clampInteger(roi.x / binning.x, 0, roi.x),
		y: clampInteger(roi.y / binning.y, 0, roi.y),
		width: clampInteger(roi.width / binning.x, MIN_ROI_SIZE, roi.width),
		height: clampInteger(roi.height / binning.y, MIN_ROI_SIZE, roi.height),
	}
}

function clampNumber(value: number, min: number, max: number) {
	if (max < min) return min
	if (!Number.isFinite(value)) return min
	return Math.max(min, Math.min(value, max))
}

function clampInteger(value: number, min: number, max: number) {
	if (max < min) return min
	if (!Number.isFinite(value)) return min
	return Math.max(min, Math.min(Math.trunc(value), max))
}
