import { Api } from '@shared/api'
import { initProxy } from '@shared/proxy'
import { hasScaledSolution } from '@stores/image.solver.store'
import type { ImageViewerStore } from '@stores/image.viewer.store'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { DeepWritable } from 'nebulosa/src/core/types'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { unsubscribe } from 'src/shared/util'
import { screenDeltaInImage } from 'src/types/image'
import { DEFAULT_CROSSHAIR_ANGULAR_SPACING, DEFAULT_CROSSHAIR_CONFIG, crosshairPointFromPixels, crosshairPointInPixels, crosshairSpacingInPixels } from 'src/types/image.crosshair'
import type { CrosshairPreset, CrosshairProjection, CrosshairProjectionAnchor, CrosshairAngularDisplayUnit, CrosshairCenter, CrosshairCenterSpace, CrosshairConfig, CrosshairPoint, CrosshairSpacingUnit } from 'src/types/image.crosshair'
import { proxy, ref } from 'valtio'
import { subscribeKey } from 'valtio/utils'

export type ImageCrosshairStore = ReturnType<typeof imageCrosshairStore>
export type ImageCrosshairWcsStatus = 'unavailable' | 'loading' | 'ready' | 'outside' | 'error'

export interface ImageCrosshairState {
	enabled: boolean
	config: DeepWritable<CrosshairConfig>
	previewCenter?: CrosshairPoint
	projection?: Extract<CrosshairProjection, { status: 'ready' }>
	wcsStatus: ImageCrosshairWcsStatus
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
		wcsStatus: 'unavailable',
	})

	console.info('image crosshair created:', viewer.state.path)

	const u: VoidFunction[] = []
	let mounted = false
	let gesture: CrosshairGesture | undefined
	let animationFrame: number | undefined
	let pendingCenter: CrosshairPoint | undefined
	let bodyUserSelect: string | undefined
	let projectionRevision = 0

	function imageDimensions() {
		return { width: viewer.state.info?.width ?? 0, height: viewer.state.info?.height ?? 0 } as const
	}

	function compatibleSolution(solution: PlateSolution | undefined = viewer.solver.state.solution) {
		const { info } = viewer.state
		return info && hasScaledSolution(solution) && Number.isFinite(solution.width) && solution.width > 0 && Number.isFinite(solution.height) && solution.height > 0 && solution.widthInPixels === info.width && solution.heightInPixels === info.height ? solution : undefined
	}

	function mount() {
		if (mounted) return unmount

		console.info('image crosshair mounted:', viewer.state.path)

		mounted = true

		u[0] = initProxy(state, `image.${viewer.key}.crosshair`, ['p:enabled', 'o:config'])

		u[1] = subscribeKey(viewer.state, 'info', () => {
			// applyConfig(state.config)
			void refreshProjection()
		})

		u[2] = subscribeKey(viewer.solver.state, 'solution', refreshProjection)

		u[3] = subscribeKey(state, 'enabled', async (enabled) => {
			await refreshProjection()
			if (enabled && state.wcsStatus === 'outside') resetCenter()
		})

		void refreshProjection()

		return unmount
	}

	function unmount() {
		if (!mounted) return
		console.info('image crosshair unmounted:', viewer.state.path)
		projectionRevision++
		cancelCenterDrag()
		unsubscribe(u)
		mounted = false
	}

	function projectionAnchor(center: CrosshairCenter = state.config.center): CrosshairProjectionAnchor {
		if (center.space === 'sky') return { space: 'sky', coordinate: { ...center.coordinate } }
		const { width, height } = imageDimensions()
		return { space: 'image', point: crosshairPointInPixels(center.point, width, height) }
	}

	async function requestProjection(anchor: CrosshairProjectionAnchor) {
		const solution = compatibleSolution()
		const revision = ++projectionRevision
		state.projection = undefined

		if (!state.enabled || !solution) {
			state.wcsStatus = 'unavailable'
			return undefined
		}

		state.wcsStatus = 'loading'
		const spacing = state.config.spacing
		const result = await Api.Image.crosshairProjection({
			solution,
			anchor,
			preset: state.config.preset,
			angularSpacing: spacing.unit === 'angular' ? { automatic: spacing.automatic, value: spacing.value } : undefined,
		})

		if (revision !== projectionRevision) return undefined

		if (!result || result.status === 'unprojectable') {
			state.wcsStatus = 'error'
			return undefined
		}

		state.projection = ref(result)
		state.wcsStatus = result.center.inside ? 'ready' : 'outside'
		return result
	}

	function refreshProjection() {
		return requestProjection(projectionAnchor())
	}

	function setEnabled(value: boolean) {
		state.enabled = value
		void refreshProjection()
	}

	function setPreset(preset: CrosshairPreset) {
		state.config.preset = preset
		void refreshProjection()
	}

	function setSpacingUnit(unit: CrosshairSpacingUnit) {
		if (unit === state.config.spacing.unit || (unit === 'angular' && !compatibleSolution())) return

		const { width, height } = imageDimensions()
		const minDimension = Math.min(width, height)
		const projectionSpacing = state.projection?.spacing

		if (unit === 'angular') {
			Object.assign(state.config.spacing, DEFAULT_CROSSHAIR_ANGULAR_SPACING)
		} else {
			const current = state.config.spacing
			const spacingInPixels = current.unit === 'angular' ? (projectionSpacing ?? current.value) / (compatibleSolution()?.scale ?? 1) : crosshairSpacingInPixels(current, width, height)
			const value = unit === 'pixel' ? spacingInPixels : minDimension > 0 ? spacingInPixels / minDimension : DEFAULT_CROSSHAIR_CONFIG.spacing.value
			Object.assign(state.config.spacing, { unit, value })
		}

		void refreshProjection()
	}

	function setSpacingValue(value: number) {
		state.config.spacing.value = value
		void refreshProjection()
	}

	function setAngularAutomatic(automatic: boolean) {
		const spacing = state.config.spacing
		if (spacing.unit !== 'angular') return
		spacing.automatic = automatic
		void refreshProjection()
	}

	function setAngularDisplayUnit(displayUnit: CrosshairAngularDisplayUnit) {
		const spacing = state.config.spacing
		if (spacing.unit !== 'angular') return
		spacing.displayUnit = displayUnit
	}

	function setImageCenter(point: CrosshairPoint) {
		Object.assign(state.config.center, { space: 'image', point })
		void refreshProjection()
	}

	async function commitCenterFromPixels(center: CrosshairPoint) {
		const { width, height } = imageDimensions()
		if (width <= 0 || height <= 0) return false

		const normalized = crosshairPointFromPixels(center, width, height)
		state.previewCenter = normalized

		if (state.config.center.space === 'image') {
			setImageCenter(normalized)
			state.previewCenter = undefined
			return true
		}

		const point = crosshairPointInPixels(normalized, width, height)
		const result = await requestProjection({ space: 'image', point })

		if (result) {
			Object.assign(state.config.center, { space: 'sky', coordinate: { rightAscension: result.center.rightAscension, declination: result.center.declination } })
			state.previewCenter = undefined
			return true
		}

		state.previewCenter = undefined
		return false
	}

	function setCenterFromPixels(center: CrosshairPoint) {
		void commitCenterFromPixels(center)
	}

	async function setCenterSpace(space: CrosshairCenterSpace) {
		if (space === state.config.center.space) return

		if (space === 'sky') {
			if (!compatibleSolution()) return
			const result = await requestProjection(projectionAnchor())
			if (result) Object.assign(state.config.center, { space, coordinate: { rightAscension: result.center.rightAscension, declination: result.center.declination } })
		} else {
			const { width, height } = imageDimensions()
			const projected = state.projection?.center
			const point = projected ? crosshairPointFromPixels(projected, width, height) : { x: 0.5, y: 0.5 }
			Object.assign(state.config.center, { space, point })
			void refreshProjection()
		}
	}

	function setSkyCenter(coordinate: EquatorialCoordinate) {
		if (state.config.center.space !== 'sky') return
		Object.assign(state.config.center, { space: 'sky', coordinate })
		void refreshProjection()
	}

	function resetCenter() {
		const { width, height } = imageDimensions()
		if (state.config.center.space === 'sky') void commitCenterFromPixels({ x: width / 2, y: height / 2 })
		else setImageCenter({ x: 0.5, y: 0.5 })
	}

	function resolvedCenterInPixels() {
		const { width, height } = imageDimensions()
		if (state.previewCenter) return crosshairPointInPixels(state.previewCenter, width, height)
		if (state.config.center.space === 'image') return crosshairPointInPixels(state.config.center.point, width, height)
		return state.projection?.center
	}

	function nudgeCenter(deltaX: number, deltaY: number) {
		const center = resolvedCenterInPixels()
		if (!center) return
		void commitCenterFromPixels({ x: center.x + deltaX, y: center.y + deltaY })
	}

	function setColor(color: string) {
		state.config.color = color
	}

	function setOpacity(opacity: number) {
		state.config.opacity = opacity
	}

	function setLineWidth(lineWidth: number) {
		state.config.lineWidth = lineWidth
	}

	function setDashed(dashed: boolean) {
		state.config.dashed = dashed
	}

	function setHalo(halo: boolean) {
		state.config.halo = halo
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

		const center = resolvedCenterInPixels()
		if (!center) return

		event.preventDefault()
		event.stopPropagation()
		cancelCenterDrag()
		disableBodyUserSelect()
		event.currentTarget.setPointerCapture(event.pointerId)

		const aborter = new AbortController()
		gesture = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scale: viewer.state.scale, angle: viewer.state.angle, center, aborter }

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
		void finishCenterDrag()
	}

	function handlePointerCancel(event: PointerEvent) {
		if (event.pointerId !== gesture?.pointerId) return
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		cancelCenterDrag()
	}

	function handleMouseEnd(event: MouseEvent) {
		if (event.buttons === 0) void finishCenterDrag()
	}

	function flushPreviewCenter() {
		animationFrame = undefined
		if (pendingCenter) state.previewCenter = pendingCenter
		pendingCenter = undefined
	}

	async function finishCenterDrag() {
		flushPendingCenter()
		const preview = state.previewCenter
		stopCenterDrag(false)
		if (preview) {
			const { width, height } = imageDimensions()
			await commitCenterFromPixels(crosshairPointInPixels(preview, width, height))
		}
		state.previewCenter = undefined
	}

	function cancelCenterDrag() {
		cancelPendingCenter()
		stopCenterDrag(true)
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

	function stopCenterDrag(clearPreview: boolean) {
		gesture?.aborter.abort()
		gesture = undefined
		if (clearPreview) state.previewCenter = undefined
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
		refreshProjection,
		setEnabled,
		setPreset,
		setSpacingUnit,
		setSpacingValue,
		setAngularAutomatic,
		setAngularDisplayUnit,
		setCenterSpace,
		setCenterFromPixels,
		setSkyCenter,
		resetCenter,
		nudgeCenter,
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
