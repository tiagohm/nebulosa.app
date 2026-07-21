import { initProxy } from '@shared/proxy'
// oxfmt-ignore
import { DEFAULT_CROSSHAIR_CONFIG, crosshairPointFromPixels, crosshairPointInPixels, crosshairSpacingInPixels, imageMinimumDimension, normalizeCrosshairConfig, normalizeCrosshairPoint, screenDeltaInImage, type CrosshairConfig, type CrosshairPoint, type CrosshairPreset, type CrosshairSpacingUnit } from '@shared/types/crosshair'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'

export type ImageCrosshairStore = ReturnType<typeof imageCrosshairStore>

export interface ImageCrosshairState {
	enabled: boolean
	config: CrosshairConfig
	previewCenter?: CrosshairPoint
}

interface CrosshairGesture {
	readonly pointerId: number
	readonly clientX: number
	readonly clientY: number
	readonly scale: number
	readonly angle: number
	readonly center: CrosshairPoint
	readonly aborter: AbortController
}

export function imageCrosshairStore(viewer: ImageViewerStore) {
	const state = proxy<ImageCrosshairState>({
		enabled: false,
		config: structuredClone(DEFAULT_CROSSHAIR_CONFIG),
	})

	console.info('image crosshair created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false
	let gesture: CrosshairGesture | undefined
	let animationFrame: number | undefined
	let pendingCenter: CrosshairPoint | undefined
	let bodyUserSelect: string | undefined

	function imageDimensions() {
		return { width: viewer.state.info?.width ?? 0, height: viewer.state.info?.height ?? 0 } as const
	}

	function minimumDimension() {
		const { width, height } = imageDimensions()
		return imageMinimumDimension(width, height)
	}

	function applyConfig(value: unknown) {
		Object.assign(state.config, normalizeCrosshairConfig(value, minimumDimension()))
	}

	function mount() {
		if (mounted) return

		console.info('image crosshair mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.crosshair`, ['p:enabled', 'o:config'])
		applyConfig(state.config)
		u[1] = subscribeKey(viewer.state, 'info', () => applyConfig(state.config))

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image crosshair unmounted:', viewer.state.path)
		cancelCenterDrag()
		unsubscribe(u)
		mounted = false
	}

	function update(key: 'enabled', value: boolean) {
		state[key] = value
	}

	function toggle() {
		state.enabled = !state.enabled
	}

	function updateConfig<K extends keyof CrosshairConfig>(key: K, value: CrosshairConfig[K]) {
		applyConfig({ ...state.config, [key]: value })
	}

	function setPreset(preset: CrosshairPreset) {
		updateConfig('preset', preset)
	}

	function setSpacingUnit(unit: CrosshairSpacingUnit) {
		if (unit === state.config.spacing.unit) return

		const { width, height } = imageDimensions()
		const spacingInPixels = crosshairSpacingInPixels(state.config.spacing, width, height)
		const minDimension = imageMinimumDimension(width, height)
		const value = unit === 'pixel' ? spacingInPixels : minDimension > 0 ? spacingInPixels / minDimension : DEFAULT_CROSSHAIR_CONFIG.spacing.value
		updateConfig('spacing', { unit, value })
	}

	function setSpacingValue(value: number) {
		updateConfig('spacing', { ...state.config.spacing, value })
	}

	function setCenter(center: CrosshairPoint) {
		updateConfig('center', normalizeCrosshairPoint(center))
	}

	function setCenterFromPixels(center: CrosshairPoint) {
		const { width, height } = imageDimensions()
		if (width <= 0 || height <= 0) return
		setCenter(crosshairPointFromPixels(center, width, height))
	}

	function resetCenter() {
		setCenter(DEFAULT_CROSSHAIR_CONFIG.center)
	}

	function nudgeCenter(deltaX: number, deltaY: number) {
		const { width, height } = imageDimensions()
		if (width <= 0 || height <= 0) return

		const center = crosshairPointInPixels(state.config.center, width, height)
		setCenterFromPixels({ x: center.x + deltaX, y: center.y + deltaY })
	}

	function setAperture(aperture: number) {
		updateConfig('aperture', aperture)
	}

	function setColor(color: string) {
		updateConfig('color', color)
	}

	function setOpacity(opacity: number) {
		updateConfig('opacity', opacity)
	}

	function setLineWidth(lineWidth: number) {
		updateConfig('lineWidth', lineWidth)
	}

	function setDashed(dashed: boolean) {
		updateConfig('dashed', dashed)
	}

	function setHalo(halo: boolean) {
		updateConfig('halo', halo)
	}

	function handleCenterKeyDown(event: React.KeyboardEvent<SVGCircleElement>) {
		const step = event.shiftKey ? 10 : 1
		let x = 0
		let y = 0

		switch (event.key) {
			case 'ArrowLeft':
				x = -step
				break
			case 'ArrowRight':
				x = step
				break
			case 'ArrowUp':
				y = -step
				break
			case 'ArrowDown':
				y = step
				break
			default:
				return
		}

		event.preventDefault()
		event.stopPropagation()
		nudgeCenter(x, y)
	}

	function startCenterDrag(event: ReactPointerEvent<SVGCircleElement>) {
		if (event.button !== 0) return

		const { width, height } = imageDimensions()
		if (width <= 0 || height <= 0) return

		event.preventDefault()
		event.stopPropagation()
		cancelCenterDrag()
		disableBodyUserSelect()
		event.currentTarget.setPointerCapture(event.pointerId)

		const aborter = new AbortController()

		gesture = {
			pointerId: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			scale: viewer.state.scale,
			angle: viewer.state.angle,
			center: crosshairPointInPixels(state.config.center, width, height),
			aborter,
		}

		const options = { capture: true, signal: aborter.signal }
		window.addEventListener('pointermove', handlePointerMove, options)
		window.addEventListener('pointerup', handlePointerEnd, options)
		window.addEventListener('pointercancel', handlePointerCancel, options)
		window.addEventListener('mouseup', handleMouseEnd, options)
		window.addEventListener('blur', cancelCenterDrag, options)
	}

	function handlePointerMove(event: PointerEvent) {
		if (!gesture || event.pointerId !== gesture.pointerId) return
		if (event.buttons === 0) return cancelCenterDrag()

		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()

		const { width, height } = imageDimensions()
		const delta = screenDeltaInImage(event.clientX - gesture.clientX, event.clientY - gesture.clientY, gesture.scale, gesture.angle)
		pendingCenter = crosshairPointFromPixels({ x: gesture.center.x + delta.x, y: gesture.center.y + delta.y }, width, height)

		animationFrame ??= window.requestAnimationFrame(flushPreviewCenter)
	}

	function handlePointerEnd(event: PointerEvent) {
		if (event.pointerId !== gesture?.pointerId) return
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		finishCenterDrag()
	}

	function handlePointerCancel(event: PointerEvent) {
		if (event.pointerId !== gesture?.pointerId) return
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		cancelCenterDrag()
	}

	function handleMouseEnd(event: MouseEvent) {
		if (event.buttons === 0) finishCenterDrag()
	}

	function flushPreviewCenter() {
		animationFrame = undefined
		if (pendingCenter) state.previewCenter = pendingCenter
		pendingCenter = undefined
	}

	function finishCenterDrag() {
		flushPendingCenter()
		if (state.previewCenter) setCenter(state.previewCenter)
		stopCenterDrag()
	}

	function cancelCenterDrag() {
		cancelPendingCenter()
		stopCenterDrag()
	}

	function flushPendingCenter() {
		if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
		animationFrame = undefined
		flushPreviewCenter()
	}

	function cancelPendingCenter() {
		if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
		animationFrame = undefined
		pendingCenter = undefined
	}

	function stopCenterDrag() {
		gesture?.aborter.abort()
		gesture = undefined
		state.previewCenter = undefined
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

	return {
		state,
		viewer,
		mount,
		unmount,
		update,
		toggle,
		setPreset,
		setSpacingUnit,
		setSpacingValue,
		setCenter,
		setCenterFromPixels,
		resetCenter,
		nudgeCenter,
		setAperture,
		setColor,
		setOpacity,
		setLineWidth,
		setDashed,
		setHalo,
		handleCenterKeyDown,
		startCenterDrag,
		finishCenterDrag,
		cancelCenterDrag,
	} as const
}
