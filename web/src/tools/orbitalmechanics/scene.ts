import type { ConicMarkerKind, ReferencePlane } from 'api'
import { ECLIPTIC_J2000_MATRIX } from 'nebulosa/src/core/constants'
import { type CenterDrawing, interpolatedPosition, type OrbitalMechanicsState, type OverlayKey, type OrbitView, solutionCurrent } from './orbitalmechanics'

// Renderer of the Orbital Mechanics Explorer: a camera orbiting a target, the projection of display points to canvas
// pixels, and the drawing of a scene on a 2D canvas, depth-sorted so nearer segments cover farther ones and the central
// body hides what passes behind it. It draws what the server sampled and never evaluates gravity. World points are AU in
// J2000 equatorial axes; display points are the same points in the axes of the reference plane drawn (the equator, or
// the ecliptic rotated about +X), so that plane is horizontal. Display axes are right-handed with +Z up on screen.
// Canvas pixels have their origin at the top left, x right and y down, in CSS pixels.

// A point or direction, AU, in display or world axes.
export type ScenePoint = readonly [number, number, number]

// Vertical field of view of the perspective camera, radians.
export const FIELD_OF_VIEW = (45 * Math.PI) / 180

// Distance of the near clipping plane, as a fraction of the camera's distance to its target.
const NEAR_FRACTION = 1e-3

// Radius of the center drawn as a marker, and of the smallest disc of a center drawn to scale, in CSS pixels.
const CENTER_MARKER_PX = 6

// Radius of a marked point (apsis, node, body), in CSS pixels.
const MARKER_PX = 4

// Length of a direction vector (velocity, angular momentum, eccentricity), as a fraction of the scene's extent: these
// show directions and are not to scale.
const DIRECTION_LENGTH = 0.3

// CSS custom properties of the orbit palette, in palette order.
export const PALETTE_TOKENS = ['--color-accent', '--color-info', '--color-success', '--color-warning', '--color-danger', '--color-ink-200'] as const

// Colors of a scene, read from the theme's tokens.
export interface SceneTheme {
	// Grid of the reference plane.
	readonly grid: string
	// Labels.
	readonly text: string
	// Secondary labels and lines.
	readonly muted: string
	// Fill of the central body.
	readonly center: string
	// The X, Y, and Z axes.
	readonly axes: readonly [string, string, string]
	// Orbit colors by palette index.
	readonly palette: readonly string[]
}

// Theme of the document, read from its CSS custom properties once per drawing setup.
export function readTheme(element: Element): SceneTheme {
	const style = getComputedStyle(element)
	const token = (name: string) => style.getPropertyValue(name).trim() || '#888'
	return {
		grid: token('--color-line-100'),
		text: token('--color-ink-100'),
		muted: token('--color-ink-300'),
		center: token('--color-ink-200'),
		axes: [token('--color-danger'), token('--color-success'), token('--color-info')],
		palette: PALETTE_TOKENS.map(token),
	}
}

// A display point of a world point (J2000 equatorial axes) when the reference plane drawn is `plane`.
export function toDisplay(point: ScenePoint, plane: ReferencePlane): [number, number, number] {
	if (plane === 'equator') return [point[0], point[1], point[2]]
	const m = ECLIPTIC_J2000_MATRIX
	return [m[0] * point[0] + m[1] * point[1] + m[2] * point[2], m[3] * point[0] + m[4] * point[1] + m[5] * point[2], m[6] * point[0] + m[7] * point[1] + m[8] * point[2]]
}

// A camera ready to project: its eye, orthonormal basis (right, up, forward into the screen), and pixel scale.
export interface Camera {
	readonly eye: ScenePoint
	readonly right: ScenePoint
	readonly up: ScenePoint
	readonly forward: ScenePoint
	// Width of the canvas, CSS pixels.
	readonly width: number
	// Height of the canvas, CSS pixels.
	readonly height: number
	// Pixels per unit of x/depth (perspective) or per AU (orthographic).
	readonly scale: number
	// Projection.
	readonly projection: OrbitView['projection']
	// Depth of the near clipping plane, AU.
	readonly near: number
}

// Camera of a view on a canvas of `width` by `height` CSS pixels. The eye sits at the view's distance from its target,
// at its yaw (azimuth around +Z from +X) and pitch (elevation); the orthographic scale matches the perspective one at the
// target, so switching projection keeps the target's size.
export function cameraOf(view: OrbitView, width: number, height: number): Camera {
	const { yaw, pitch, distance, target } = view
	const cp = Math.cos(pitch)
	const offset: ScenePoint = [distance * cp * Math.cos(yaw), distance * cp * Math.sin(yaw), distance * Math.sin(pitch)]
	const eye: ScenePoint = [target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]]
	const forward = normalize([-offset[0], -offset[1], -offset[2]])
	const right = normalize(cross(forward, [0, 0, 1]))
	const up = cross(right, forward)
	const focal = height / 2 / Math.tan(FIELD_OF_VIEW / 2)
	const scale = view.projection === 'perspective' ? focal : focal / distance
	return { eye, right, up, forward, width, height, scale, projection: view.projection, near: distance * NEAR_FRACTION }
}

// A projected point: canvas pixels and the depth along the view, AU.
export interface ProjectedPoint {
	readonly x: number
	readonly y: number
	readonly depth: number
}

// Canvas position and depth of a display point, or undefined when it is behind the near plane.
export function project(camera: Camera, point: ScenePoint): ProjectedPoint | undefined {
	const d: ScenePoint = [point[0] - camera.eye[0], point[1] - camera.eye[1], point[2] - camera.eye[2]]
	const depth = dot(d, camera.forward)
	if (!(depth > camera.near)) return undefined
	const k = camera.projection === 'perspective' ? camera.scale / depth : camera.scale
	return { x: camera.width / 2 + dot(d, camera.right) * k, y: camera.height / 2 - dot(d, camera.up) * k, depth }
}

// Pixels per AU at a depth (AU) along the view.
function pixelsPerAu(camera: Camera, depth: number) {
	return camera.projection === 'perspective' ? camera.scale / depth : camera.scale
}

// Camera distance (AU) that frames a sphere of radius `extent` (AU) around the target.
export function fitDistance(extent: number) {
	return (extent * 1.15) / Math.sin(FIELD_OF_VIEW / 2)
}

// Yaw and pitch of a preset view: from above the reference plane (+X right, +Y up on screen), from its edge (looking along
// +Y), or along a plane normal (display axes) so the orbit is seen face-on, turning counterclockwise.
export function presetAngles(kind: 'top' | 'side' | 'normal', normal?: ScenePoint) {
	if (kind === 'top') return { yaw: -Math.PI / 2, pitch: Math.PI / 2 - 0.0087 }
	if (kind === 'side' || !normal) return { yaw: -Math.PI / 2, pitch: 0 }
	const n = normalize(normal)
	const pitch = Math.max(-(Math.PI / 2 - 0.0087), Math.min(Math.PI / 2 - 0.0087, Math.asin(n[2])))
	const horizontal = Math.hypot(n[0], n[1])
	return { yaw: horizontal > 1e-9 ? Math.atan2(n[1], n[0]) : -Math.PI / 2, pitch }
}

// Radii (AU) of the rings of the reference-plane grid: steps of 1, 2, or 5 times a power of ten, up to the extent.
export function gridRings(extent: number) {
	if (!(extent > 0)) return []
	const magnitude = 10 ** Math.floor(Math.log10(extent / 4))
	const step = [1, 2, 5, 10].map((e) => e * magnitude).find((e) => extent / e <= 6) ?? magnitude * 10
	const rings: number[] = []
	for (let r = step; r <= extent * 1.0001 && rings.length < 12; r += step) rings.push(r)
	return rings
}

// One orbit as drawn.
export interface SceneOrbit {
	// Orbit id, answered by picking.
	readonly id: string
	// Name.
	readonly name: string
	// Palette index.
	readonly color: number
	// Whether it is the orbit selected.
	readonly selected: boolean
	// Curve, display points.
	readonly points: readonly ScenePoint[]
	// Whether the curve is a closed ellipse.
	readonly closed: boolean
	// Apsides and nodes, display points.
	readonly markers: readonly { readonly kind: ConicMarkerKind; readonly position: ScenePoint }[]
	// Body at the clock's instant (interpolated), display point; absent outside an open arc.
	readonly body?: ScenePoint
	// Velocity direction at the body, display axes, any length.
	readonly velocity?: ScenePoint
	// Unit normal of the orbital plane (along h), display axes.
	readonly normal?: ScenePoint
	// Eccentricity vector, display axes (its length is the eccentricity).
	readonly eccentricity?: ScenePoint
}

// What a scene draws.
export interface SceneModel {
	// Orbits, in drawing order.
	readonly orbits: readonly SceneOrbit[]
	// Name and radius (AU) of the central body.
	readonly center: { readonly name: string; readonly radius: number }
	// How the central body is drawn.
	readonly centerDrawing: CenterDrawing
	// Layers shown.
	readonly overlays: Readonly<Record<OverlayKey, boolean>>
	// Radius of the region drawn (grid, axes, direction vectors), AU.
	readonly extent: number
	// Name of the reference plane, for the grid's label.
	readonly planeName: string
}

// A primitive of the depth-sorted drawing.
type Primitive = { readonly depth: number; readonly draw: (ctx: CanvasRenderingContext2D) => void }

// Draws a scene on a canvas context whose transform maps CSS pixels (the caller applies the device pixel ratio).
export function drawScene(ctx: CanvasRenderingContext2D, camera: Camera, model: SceneModel, theme: SceneTheme) {
	ctx.clearRect(0, 0, camera.width, camera.height)
	ctx.lineJoin = 'round'
	ctx.lineCap = 'round'
	const { overlays, extent } = model
	const primitives: Primitive[] = []
	const labels: (() => void)[] = []

	const label = (point: ScenePoint, text: string, color: string) => {
		if (!overlays.labels) return
		const p = project(camera, point)
		if (!p) return
		labels.push(() => {
			ctx.fillStyle = color
			ctx.fillText(text, p.x + 6, p.y - 6)
		})
	}

	const segment = (a: ScenePoint, b: ScenePoint, color: string, width: number, dash?: readonly number[]) => {
		const clipped = clipSegment(camera, a, b)
		if (!clipped) return
		const [p, q] = clipped
		primitives.push({
			depth: (p.depth + q.depth) / 2,
			draw: () => {
				ctx.strokeStyle = color
				ctx.lineWidth = width
				ctx.setLineDash(dash ?? [])
				ctx.beginPath()
				ctx.moveTo(p.x, p.y)
				ctx.lineTo(q.x, q.y)
				ctx.stroke()
			},
		})
	}

	const disc = (point: ScenePoint, color: string, radius: number, hollow = false) => {
		const p = project(camera, point)
		if (!p) return
		primitives.push({
			depth: p.depth,
			draw: () => {
				ctx.beginPath()
				ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI)
				if (hollow) {
					ctx.setLineDash([])
					ctx.strokeStyle = color
					ctx.lineWidth = 1.5
					ctx.stroke()
				} else {
					ctx.fillStyle = color
					ctx.fill()
				}
			},
		})
	}

	const arrow = (from: ScenePoint, to: ScenePoint, color: string, text: string) => {
		segment(from, to, color, 1.5)
		const p = project(camera, from)
		const q = project(camera, to)
		if (p && q) {
			const angle = Math.atan2(q.y - p.y, q.x - p.x)
			primitives.push({
				depth: q.depth,
				draw: () => {
					ctx.fillStyle = color
					ctx.beginPath()
					ctx.moveTo(q.x, q.y)
					ctx.lineTo(q.x - 8 * Math.cos(angle - 0.4), q.y - 8 * Math.sin(angle - 0.4))
					ctx.lineTo(q.x - 8 * Math.cos(angle + 0.4), q.y - 8 * Math.sin(angle + 0.4))
					ctx.closePath()
					ctx.fill()
				},
			})
		}
		label(to, text, color)
	}

	// The reference plane: rings around the center and the line of the equinox, under everything else.
	if (overlays.referencePlane) {
		const rings = gridRings(extent)
		ctx.globalAlpha = 0.6
		for (const radius of rings) {
			const ring: ScenePoint[] = []
			for (let k = 0; k <= 96; k++) ring.push([radius * Math.cos((k * Math.PI) / 48), radius * Math.sin((k * Math.PI) / 48), 0])
			strokePath(ctx, camera, ring, theme.grid, 1)
		}
		ctx.globalAlpha = 1
		label([extent, 0, 0], model.planeName, theme.muted)
	}

	if (overlays.axes) {
		const names = ['X', 'Y', 'Z'] as const
		for (let i = 0; i < 3; i++) {
			const tip: [number, number, number] = [0, 0, 0]
			tip[i] = extent * 1.1
			arrow([0, 0, 0], tip, theme.axes[i], names[i])
		}
	}

	for (const orbit of model.orbits) {
		const color = theme.palette[orbit.color % theme.palette.length]
		const width = orbit.selected ? 2 : 1.25

		if (overlays.orbitalPlane && orbit.points.length > 2) {
			const projected = orbit.points.map((e) => project(camera, e))
			if (projected.every((e) => e !== undefined)) {
				const origin = project(camera, [0, 0, 0])
				let depth = 0
				for (const e of projected) depth += e.depth / projected.length
				primitives.push({
					depth: depth + extent * 1e-3,
					draw: () => {
						ctx.globalAlpha = orbit.selected ? 0.12 : 0.06
						ctx.fillStyle = color
						ctx.beginPath()
						if (!orbit.closed && origin) ctx.moveTo(origin.x, origin.y)
						for (const p of projected) ctx.lineTo(p.x, p.y)
						ctx.closePath()
						ctx.fill()
						ctx.globalAlpha = 1
					},
				})
			}
		}

		for (let k = 1; k < orbit.points.length; k++) segment(orbit.points[k - 1], orbit.points[k], color, width)

		for (const marker of orbit.markers) {
			const visible = marker.kind === 'periapsis' || marker.kind === 'apoapsis' ? overlays.apsides : overlays.nodes
			if (!visible) continue
			disc(marker.position, color, MARKER_PX - 1, true)
			label(marker.position, MARKER_LABELS[marker.kind], color)
		}

		if (overlays.nodes) {
			const ascending = orbit.markers.find((e) => e.kind === 'ascendingNode')
			const descending = orbit.markers.find((e) => e.kind === 'descendingNode')
			if (ascending && descending) segment(ascending.position, descending.position, color, 1, [4, 4])
		}

		if (overlays.eccentricityVector && orbit.eccentricity) {
			const e = Math.hypot(...orbit.eccentricity)
			if (e > 0) arrow([0, 0, 0], scaled(orbit.eccentricity, (DIRECTION_LENGTH * extent * Math.min(1, e)) / e), color, 'e')
		}

		if (overlays.angularMomentum && orbit.normal) arrow([0, 0, 0], scaled(orbit.normal, DIRECTION_LENGTH * extent), color, 'h')

		if (orbit.body) {
			if (overlays.positionVector) segment([0, 0, 0], orbit.body, color, 1, [2, 3])
			if (overlays.velocityVector && orbit.velocity) {
				const v = Math.hypot(...orbit.velocity)
				if (v > 0) {
					const tip = scaled(orbit.velocity, (DIRECTION_LENGTH * extent) / v)
					arrow(orbit.body, [orbit.body[0] + tip[0], orbit.body[1] + tip[1], orbit.body[2] + tip[2]], color, 'v')
				}
			}
			disc(orbit.body, color, orbit.selected ? MARKER_PX + 1.5 : MARKER_PX)
			label(orbit.body, orbit.name, theme.text)
		}
	}

	// The central body, sorted with the rest so it hides what passes behind it.
	const center = project(camera, [0, 0, 0])
	if (center) {
		const trueRadius = model.center.radius * pixelsPerAu(camera, center.depth)
		const radius = model.centerDrawing === 'marker' ? CENTER_MARKER_PX : Math.max(trueRadius, 1.5)
		primitives.push({
			depth: center.depth,
			draw: () => {
				ctx.fillStyle = theme.center
				ctx.beginPath()
				ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI)
				ctx.fill()
			},
		})
		label([0, 0, 0], model.center.name, theme.muted)
	}

	primitives.sort((a, b) => b.depth - a.depth)
	for (const primitive of primitives) primitive.draw(ctx)
	ctx.setLineDash([])
	ctx.font = '11px "JetBrains Mono", ui-monospace, monospace'
	for (const draw of labels) draw()
}

// Labels of the marked points.
const MARKER_LABELS: Readonly<Record<ConicMarkerKind, string>> = { periapsis: 'Pe', apoapsis: 'Ap', ascendingNode: '☊', descendingNode: '☋' }

// Strokes a polyline of display points as one path, skipping the parts behind the near plane.
function strokePath(ctx: CanvasRenderingContext2D, camera: Camera, points: readonly ScenePoint[], color: string, width: number) {
	ctx.strokeStyle = color
	ctx.lineWidth = width
	ctx.setLineDash([])
	ctx.beginPath()
	for (let k = 1; k < points.length; k++) {
		const clipped = clipSegment(camera, points[k - 1], points[k])
		if (!clipped) continue
		ctx.moveTo(clipped[0].x, clipped[0].y)
		ctx.lineTo(clipped[1].x, clipped[1].y)
	}
	ctx.stroke()
}

// The projections of a segment's ends, the segment cut at the near plane when it crosses it; undefined when it is
// wholly behind.
export function clipSegment(camera: Camera, a: ScenePoint, b: ScenePoint): readonly [ProjectedPoint, ProjectedPoint] | undefined {
	const da = depthOf(camera, a)
	const db = depthOf(camera, b)
	if (da <= camera.near && db <= camera.near) return undefined
	let p = a
	let q = b

	if (da <= camera.near || db <= camera.near) {
		const t = (camera.near * 1.0001 - da) / (db - da)
		const cut: ScenePoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
		if (da <= camera.near) p = cut
		else q = cut
	}

	const pp = project(camera, p)
	const pq = project(camera, q)
	return pp && pq ? [pp, pq] : undefined
}

// Depth of a display point along the view, AU.
function depthOf(camera: Camera, point: ScenePoint) {
	return (point[0] - camera.eye[0]) * camera.forward[0] + (point[1] - camera.eye[1]) * camera.forward[1] + (point[2] - camera.eye[2]) * camera.forward[2]
}

// Id of the orbit whose body is nearest a canvas position, within `radius` CSS pixels; undefined when none is.
export function pickOrbit(camera: Camera, model: SceneModel, x: number, y: number, radius: number = 12) {
	let best: string | undefined
	let bestDistance = radius

	for (const orbit of model.orbits) {
		const p = orbit.body && project(camera, orbit.body)
		if (!p) continue
		const distance = Math.hypot(p.x - x, p.y - y)
		if (distance <= bestDistance) {
			best = orbit.id
			bestDistance = distance
		}
	}

	return best
}

// The vector `v` times `k`.
function scaled(v: ScenePoint, k: number): ScenePoint {
	return [v[0] * k, v[1] * k, v[2] * k]
}

// Dot product.
function dot(a: ScenePoint, b: ScenePoint) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

// Cross product.
function cross(a: ScenePoint, b: ScenePoint): ScenePoint {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

// Unit vector of a nonzero vector.
function normalize(v: ScenePoint): ScenePoint {
	const length = Math.hypot(v[0], v[1], v[2])
	return [v[0] / length, v[1] / length, v[2] / length]
}

// Fraction of a track's window between the two positions whose difference gives the drawn velocity direction.
const VELOCITY_STEP = 1e-5

// Scene of the explorer's state at its clock's instant: each visible orbit's curve and markers in display axes, its body
// interpolated from its exact samples, and its plane normal and eccentricity vector from its solution, which a two-body
// orbit keeps constant. The extent covers every curve drawn and at least three radii of the center.
export function buildSceneModel(state: Pick<OrbitalMechanicsState, 'orbits' | 'selected' | 'time' | 'plane' | 'overlays' | 'centerDrawing' | 'center'>): SceneModel {
	const { plane, time } = state
	const orbits: SceneOrbit[] = []
	let extent = 3 * (state.center?.radius ?? 0)

	for (const orbit of state.orbits) {
		const track = orbit.track
		if (!orbit.visible || !track) continue
		const points = track.trajectory.curve.points.map((e) => toDisplay(e, plane))
		for (const p of points) extent = Math.max(extent, Math.hypot(p[0], p[1], p[2]))
		const body = interpolatedPosition(track, time)
		let velocity: ScenePoint | undefined

		if (body) {
			const step = Math.max(VELOCITY_STEP * (track.end - track.start), 1e-9)
			// One-sided at the ends of an open window, where the other side has no samples.
			const before = interpolatedPosition(track, time - step) ?? body
			const after = interpolatedPosition(track, time + step) ?? body
			if (before !== after) velocity = toDisplay([after[0] - before[0], after[1] - before[1], after[2] - before[2]], plane)
		}

		const solution = solutionCurrent(orbit) ? orbit.solution : undefined
		orbits.push({
			id: orbit.id,
			name: orbit.name,
			color: orbit.color,
			selected: orbit.id === state.selected,
			points,
			closed: track.trajectory.curve.closed,
			markers: track.trajectory.curve.markers.map((e) => ({ kind: e.kind, position: toDisplay(e.position, plane) })),
			body: body && toDisplay(body, plane),
			velocity,
			normal: solution && toDisplay(solution.diagnostics.normal, plane),
			eccentricity: solution && toDisplay(solution.diagnostics.eccentricityVector, plane),
		})
	}

	return {
		orbits,
		center: { name: state.center?.name ?? '', radius: state.center?.radius ?? 0 },
		centerDrawing: state.centerDrawing,
		overlays: state.overlays,
		extent: extent > 0 ? extent : 1,
		planeName: plane === 'ecliptic' ? 'J2000 ecliptic' : 'J2000 equator',
	}
}
