import { useEffect, useRef, useState } from 'react'
import { subscribe } from 'valtio'
import { type FitKind, orbitalMechanicsState, PITCH_LIMIT, selectOrbit } from './orbitalmechanics'
import { buildSceneModel, cameraOf, drawScene, FIELD_OF_VIEW, fitDistance, pickOrbit, readTheme, selectedExtent } from './scene'

// The 3D view of the Orbital Mechanics Explorer: a canvas sized to its container that draws the tab's scene whenever its
// state changes, at most once per animation frame, and never otherwise, so an idle tool costs nothing. Dragging orbits
// the camera, a drag with Shift or the secondary button (or two fingers) pans it, and the wheel (or a pinch) zooms it;
// a click on a body selects its orbit. Focused, it takes the arrows (Shift to pan) and + and − for the same moves. Only the canvas captures touch gestures, never the page. Everything it
// registers is released when it unmounts.

// Radians of camera rotation per CSS pixel dragged.
const ROTATE_PER_PX = 0.008

// Factor of zoom per unit of wheel delta.
const ZOOM_PER_WHEEL = 0.0015

// Radians of camera rotation per arrow key press.
const ROTATE_PER_KEY = 0.08

// CSS pixels of pan per Shift + arrow key press.
const PAN_PER_KEY = 24

// Factor of zoom per + or − key press; a smaller distance is closer.
const ZOOM_PER_KEY = 0.85

// Largest drag, in CSS pixels, that still counts as a click.
const CLICK_SLOP_PX = 4

// 3D view of the explorer.
export function OrbitScene() {
	const container = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLCanvasElement>(null)
	const [unsupported, setUnsupported] = useState(false)

	useEffect(() => {
		const element = canvas.current!
		const host = container.current!
		const ctx = element.getContext('2d')

		if (!ctx) {
			setUnsupported(true)
			return
		}

		const theme = readTheme(document.documentElement)
		const state = orbitalMechanicsState
		let width = 0
		let height = 0
		let frame = 0

		// Draws the scene now, framing it first across the canvas's shape when a preset, a scenario, or the view asked for
		// it. While the curves of a framing are still on their way, the canvas stays empty rather than drawing the center
		// and its labels piled at an unframed distance.
		const draw = () => {
			frame = 0
			if (width === 0 || height === 0) return
			const model = buildSceneModel(state)

			const ratio = window.devicePixelRatio || 1
			if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
				element.width = Math.round(width * ratio)
				element.height = Math.round(height * ratio)
			}

			ctx.setTransform(ratio, 0, 0, ratio, 0, 0)

			if (state.fitPending && model.orbits.length === 0 && state.orbits.some((e) => e.loading)) {
				ctx.clearRect(0, 0, width, height)
				return
			}

			if (state.fitPending && model.orbits.length > 0) {
				const extent = state.fitPending === 'selected' ? selectedExtent(model) : model.extent
				fitted = { kind: state.fitPending, distance: fitDistance(extent, width / height) }
				state.fitPending = false
				state.view.distance = fitted.distance
				state.view.target = [0, 0, 0]
			}

			drawScene(ctx, cameraOf(state.view, width, height), model, theme)
		}

		const request = () => {
			if (!frame) frame = requestAnimationFrame(draw)
		}

		// The last framing while the camera has neither zoomed nor panned since, so a canvas that changes size (the
		// panel's sheet opening on a phone) frames the same orbits again instead of showing them shrunken.
		let fitted: { readonly kind: FitKind; readonly distance: number } | undefined

		const observer = new ResizeObserver(([entry]) => {
			const { view } = state
			if (fitted && (view.distance !== fitted.distance || view.target.some((e) => e !== 0))) fitted = undefined
			if (fitted && (entry.contentRect.width !== width || entry.contentRect.height !== height)) state.fitPending = fitted.kind
			width = entry.contentRect.width
			height = entry.contentRect.height
			request()
		})
		observer.observe(host)
		const unsubscribe = subscribe(state, request)

		// Active pointers by id, with where they were last.
		const pointers = new Map<number, { x: number; y: number }>()
		let dragged = 0
		let panning = false

		// Moves the camera's target by a drag of (dx, dy) CSS pixels in the plane of the screen.
		const pan = (dx: number, dy: number) => {
			const camera = cameraOf(state.view, width, height)
			const k = (2 * state.view.distance * Math.tan(FIELD_OF_VIEW / 2)) / height
			const [tx, ty, tz] = state.view.target
			state.view.target = [tx - (camera.right[0] * dx - camera.up[0] * dy) * k, ty - (camera.right[1] * dx - camera.up[1] * dy) * k, tz - (camera.right[2] * dx - camera.up[2] * dy) * k]
		}

		// Zooms by a factor, a smaller distance being closer.
		const zoom = (factor: number) => {
			state.view.distance = Math.min(1e7, Math.max(1e-9, state.view.distance * factor))
		}

		const down = (event: PointerEvent) => {
			element.setPointerCapture(event.pointerId)
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
			dragged = 0
			panning = event.shiftKey || event.button === 2
		}

		const move = (event: PointerEvent) => {
			const last = pointers.get(event.pointerId)
			if (!last) return
			const dx = event.clientX - last.x
			const dy = event.clientY - last.y
			dragged += Math.hypot(dx, dy)

			if (pointers.size === 2) {
				const [other] = [...pointers.entries()].filter(([id]) => id !== event.pointerId).map(([, e]) => e)
				const before = Math.hypot(last.x - other.x, last.y - other.y)
				const after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
				if (before > 0 && after > 0) zoom(before / after)
				pan(dx / 2, dy / 2)
			} else if (panning) {
				pan(dx, dy)
			} else {
				state.view.yaw -= dx * ROTATE_PER_PX
				state.view.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.view.pitch + dy * ROTATE_PER_PX))
			}

			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
		}

		const up = (event: PointerEvent) => {
			const wasClick = pointers.size === 1 && dragged <= CLICK_SLOP_PX
			pointers.delete(event.pointerId)

			if (wasClick) {
				const rect = element.getBoundingClientRect()
				const id = pickOrbit(cameraOf(state.view, width, height), buildSceneModel(state), event.clientX - rect.left, event.clientY - rect.top)
				if (id) selectOrbit(state, id)
			}
		}

		const wheel = (event: WheelEvent) => {
			event.preventDefault()
			zoom(Math.exp(event.deltaY * ZOOM_PER_WHEEL))
		}

		const menu = (event: Event) => event.preventDefault()

		// The keyboard path of the camera: arrows orbit it, Shift + arrows pan it, + and − zoom it.
		const key = (event: KeyboardEvent) => {
			const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
			const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0

			if (dx || dy) {
				if (event.shiftKey) pan(dx * PAN_PER_KEY, dy * PAN_PER_KEY)
				else {
					state.view.yaw -= dx * ROTATE_PER_KEY
					state.view.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.view.pitch + dy * ROTATE_PER_KEY))
				}
			} else if (event.key === '+' || event.key === '=') zoom(ZOOM_PER_KEY)
			else if (event.key === '-' || event.key === '_') zoom(1 / ZOOM_PER_KEY)
			else return

			event.preventDefault()
		}

		element.addEventListener('pointerdown', down)
		element.addEventListener('pointermove', move)
		element.addEventListener('pointerup', up)
		element.addEventListener('pointercancel', up)
		element.addEventListener('wheel', wheel, { passive: false })
		element.addEventListener('contextmenu', menu)
		element.addEventListener('keydown', key)

		return () => {
			if (frame) cancelAnimationFrame(frame)
			unsubscribe()
			observer.disconnect()
			element.removeEventListener('pointerdown', down)
			element.removeEventListener('pointermove', move)
			element.removeEventListener('pointerup', up)
			element.removeEventListener('pointercancel', up)
			element.removeEventListener('wheel', wheel)
			element.removeEventListener('contextmenu', menu)
			element.removeEventListener('keydown', key)
		}
	}, [])

	return (
		<div ref={container} className="absolute inset-0 overflow-hidden bg-base-000">
			<canvas
				ref={canvas}
				tabIndex={0}
				title="Scene: drag or arrows to turn, Shift-drag or Shift + arrows to pan, wheel or + and − to zoom, click a body to select its orbit. Space plays, comma and period step, F fits all, Shift + F fits the selected orbit."
				className="absolute inset-0 size-full cursor-grab touch-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:cursor-grabbing"
			/>
			{unsupported && <p className="absolute inset-x-0 top-1/2 m-0 px-4 text-center text-sm text-ink-300">This browser cannot draw the scene. The values of the orbit remain in the panel.</p>}
		</div>
	)
}
