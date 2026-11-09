import type { MeteorRadiantPath, MeteorShowerStates, MeteorSkyRadiant, MeteorSkyRadiants } from 'api'
import { TAU } from 'nebulosa/src/core/constants'
import { jsonInit } from '../http'
import type { Celestial } from './celestial/celestial'
import { METEOR_RADIANT_SHAPE_TYPE, type MeteorRadiantData, meteorRadiantShapeId } from './objects'
import { createRequestGuard } from './selection'

// Meteor shower radiants on the Sky map: the radiants of the showers active at the instant the map shows (while the
// meteorRadiants layer is shown) and the selected shower's radiant (always), drawn as selectable custom shapes. A radiant
// is a direction, not a body: it is never targeted, and the server gives it as geocentric J2000, which is converted here
// with the precession-nutation matrix of the map data, as the stars are, so it is precessed exactly once.
// Radiants drift by at most a degree or two per day, so they are asked for again only when the instant shown moves more
// than REFRESH_SPAN_MS from the last request (about 0.05° of drift), the catalog or the layer changes, or another shower
// is selected; never on a timer of their own, and never once per frame. A failed request waits LOAD_RETRY_DELAY_MS.
// The selected shower's drift path over its nearest occurrence is drawn too, dashed, in the same frame as the radiants: it
// is asked for once per shower and catalog, and again only when the instant leaves the occurrence by more than a month.

// Largest distance of the instant shown from the instant of the radiants drawn, milliseconds.
export const REFRESH_SPAN_MS = 3_600_000

// Wait after a failed request before asking again, milliseconds.
const LOAD_RETRY_DELAY_MS = 10_000

// Colour of the radiant glyph, a pink apart from the stars, the deep-sky markers, the planets, and the satellites.
const RADIANT_COLOR = 'rgb(244 114 182)'

// Radii of the glyph, CSS pixels: the dot and the inner and outer ends of its rays.
const RADIANT_DOT_RADIUS = 2.5
const RADIANT_RAY_RANGE = [5, 10] as const

// Number of rays of the glyph.
const RADIANT_RAYS = 8

// Id of the shape of the selected shower's drift path.
const PATH_SHAPE_ID = 'meteor-radiant-path'

// How far the instant shown may leave the occurrence of the drift path drawn before it is asked for again, milliseconds.
const PATH_MARGIN_MS = 30 * 86400000

// What the map draws.
export interface MeteorRadiantTargets {
	// Whether the radiants of the active showers are drawn.
	readonly visible: boolean
	// Revision of the meteor shower catalog, whose change asks for the radiants again.
	readonly revision: number
	// Id of the selected shower, drawn even outside its activity and with the layer hidden.
	readonly selected?: string
	// Name of the selected shower, its label when it is not among the active radiants.
	readonly selectedName?: string
}

// Services of the map the layer uses.
export interface MeteorRadiantMap {
	// Instant the map shows, Unix milliseconds (UTC).
	readonly time: () => number
	// A geocentric J2000 direction (radians) in the frame of the loaded map data; undefined before the data is loaded.
	readonly toMapFrame: (rightAscension: number, declination: number) => { readonly rightAscension: number; readonly declination: number } | undefined
}

// Draws one radiant at a screen point: a dot with rays and its label.
function drawRadiant(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
	ctx.strokeStyle = RADIANT_COLOR
	ctx.fillStyle = RADIANT_COLOR
	ctx.lineWidth = 1.25
	ctx.lineCap = 'round'
	ctx.beginPath()
	ctx.arc(x, y, RADIANT_DOT_RADIUS, 0, TAU)
	ctx.fill()
	ctx.beginPath()

	for (let i = 0; i < RADIANT_RAYS; i++) {
		const angle = (i * TAU) / RADIANT_RAYS
		const [inner, outer] = RADIANT_RAY_RANGE
		ctx.moveTo(x + inner * Math.cos(angle), y + inner * Math.sin(angle))
		ctx.lineTo(x + outer * Math.cos(angle), y + outer * Math.sin(angle))
	}

	ctx.stroke()
	ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
	ctx.textAlign = 'left'
	ctx.textBaseline = 'middle'
	ctx.fillText(label, x + RADIANT_RAY_RANGE[1] + 3, y)
}

// Radiants drawn on one map.
export class MeteorRadiantLayer {
	readonly #guard = createRequestGuard()
	readonly #selectedGuard = createRequestGuard()
	readonly #shapes = new Set<string>()
	#targets: MeteorRadiantTargets = { visible: false, revision: 0 }
	#radiants: readonly MeteorSkyRadiant[] = []
	#selected?: MeteorSkyRadiant
	// Instants the active radiants and the selected one were asked for; absent to ask again.
	#activeTime?: number
	#selectedTime?: number
	#retryAt = 0
	// Drift path of the selected shower and the instant it was asked for.
	#path?: MeteorRadiantPath
	#pathTime?: number
	readonly #pathGuard = createRequestGuard()

	// Creates the layer of a map.
	constructor(
		private readonly celestial: Celestial,
		private readonly map: MeteorRadiantMap,
		private readonly fetch: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => globalThis.fetch(input, init),
	) {}

	// Sets what is drawn: a new catalog asks for everything again, a hidden layer drops the active radiants, and another
	// selected shower asks for its radiant.
	set(targets: MeteorRadiantTargets) {
		const previous = this.#targets
		this.#targets = targets

		if (targets.revision !== previous.revision || targets.visible !== previous.visible) {
			this.#guard.cancel()
			this.#activeTime = undefined
			if (!targets.visible) this.#radiants = []
		}

		if (targets.revision !== previous.revision || targets.selected !== previous.selected) {
			this.#selectedGuard.cancel()
			this.#selectedTime = undefined
			this.#selected = undefined
			this.#pathGuard.cancel()
			this.#path = undefined
			this.#pathTime = undefined
		}

		this.#retryAt = 0
		this.redraw()
		this.update(this.map.time())
	}

	// Follows an update of the map for an instant (Unix milliseconds), asking again for what is out of date.
	update(time: number) {
		if (Date.now() < this.#retryAt) return
		if (this.#targets.visible && outdated(this.#activeTime, time)) void this.#loadActive(time)
		const selected = this.#targets.selected
		if (selected !== undefined && outdated(this.#selectedTime, time) && !this.#radiants.some((radiant) => radiant.id === selected)) void this.#loadSelected(selected, time)
		if (selected !== undefined && pathOutdated(this.#path, this.#pathTime, time)) void this.#loadPath(selected, time)
	}

	// Draws the radiants again in the frame of the map data, after it was loaded or changed.
	redraw() {
		const drawn = new Set<string>()
		const radiants = this.#selected && !this.#radiants.some((radiant) => radiant.id === this.#selected!.id) ? [...this.#radiants, this.#selected] : this.#radiants

		for (const radiant of radiants) {
			const coordinate = this.map.toMapFrame(radiant.rightAscension, radiant.declination)
			if (!coordinate) continue
			const id = meteorRadiantShapeId(radiant.id)
			const data: MeteorRadiantData = { ref: { kind: 'meteorShower', id: radiant.id }, name: radiant.name, code: radiant.code }
			const label = radiant.code ?? radiant.name
			this.celestial.addShape({ id, type: METEOR_RADIANT_SHAPE_TYPE, coordinate: { ...coordinate }, data, render: (_, ctx, state) => drawRadiant(ctx, state.x, state.y, label) })
			drawn.add(id)
		}

		for (const id of this.#shapes) if (!drawn.has(id)) this.celestial.removeShape(id)
		this.#shapes.clear()
		for (const id of drawn) this.#shapes.add(id)
		this.#drawPath()
	}

	// Draws the selected shower's drift path, or removes it.
	#drawPath() {
		const segments = (this.#path?.segments ?? []).map((segment) => segment.map((point) => this.map.toMapFrame(point.rightAscension, point.declination)).filter((point) => point !== undefined))
		const anchor = segments.find((segment) => segment.length > 0)?.[0]

		if (!anchor || this.#targets.selected === undefined) {
			this.celestial.removeShape(PATH_SHAPE_ID)
			return
		}

		this.celestial.addShape({
			id: PATH_SHAPE_ID,
			coordinate: { ...anchor },
			selectable: false,
			render: (_, ctx, { state }) => {
				const point: [number, number] = [0, 0]
				ctx.strokeStyle = RADIANT_COLOR
				ctx.globalAlpha = 0.8
				ctx.lineWidth = 1.25
				ctx.setLineDash([5, 4])
				ctx.beginPath()

				// Each piece is drawn on its own, and a point the projection cannot place breaks the line, so the path is never joined
				// across a gap.
				for (const segment of segments) {
					let drawing = false
					for (const vertex of segment) {
						if (!state.projectEquatorialToScreen(vertex.rightAscension, vertex.declination, point)) {
							drawing = false
							continue
						}

						if (drawing) ctx.lineTo(point[0], point[1])
						else ctx.moveTo(point[0], point[1])
						drawing = true
					}
				}

				ctx.stroke()
				ctx.setLineDash([])
				ctx.globalAlpha = 1
			},
		})
	}

	// Asks for the drift path of the selected shower around an instant.
	async #loadPath(id: string, time: number) {
		const request = this.#pathGuard.begin()
		this.#pathTime = time

		try {
			const response = await this.fetch(`/api/meteor-showers/${encodeURIComponent(id)}/path`, jsonInit('POST', { time }, request.signal))
			if (!request.current()) return
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			const path = (await response.json()) as MeteorRadiantPath
			if (!request.current()) return
			this.#path = path
			this.#drawPath()
		} catch {
			if (!request.current()) return
			this.#pathTime = undefined
			this.#retryAt = Date.now() + LOAD_RETRY_DELAY_MS
		}
	}

	// Releases the layer for good.
	destroy() {
		this.#guard.cancel()
		this.#selectedGuard.cancel()
		this.#pathGuard.cancel()
		this.celestial.removeShape(PATH_SHAPE_ID)
		for (const id of this.#shapes) this.celestial.removeShape(id)
		this.#shapes.clear()
	}

	// Asks for the radiants of the showers active at an instant.
	async #loadActive(time: number) {
		const request = this.#guard.begin()
		this.#activeTime = time

		try {
			const response = await this.fetch('/api/meteor-showers/radiants', jsonInit('POST', { time }, request.signal))
			if (!request.current()) return
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			const answer = (await response.json()) as MeteorSkyRadiants
			if (!request.current()) return
			this.#radiants = answer.radiants
			this.redraw()
		} catch {
			if (!request.current()) return
			this.#activeTime = undefined
			this.#retryAt = Date.now() + LOAD_RETRY_DELAY_MS
		}
	}

	// Asks for the radiant of the selected shower at an instant.
	async #loadSelected(id: string, time: number) {
		const request = this.#selectedGuard.begin()
		this.#selectedTime = time

		try {
			const response = await this.fetch('/api/meteor-showers/states', jsonInit('POST', { ids: [id], time }, request.signal))
			if (!request.current()) return
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			const answer = (await response.json()) as MeteorShowerStates
			if (!request.current()) return
			const state = answer.showers[0]
			const radiant = this.#radiants.find((candidate) => candidate.id === id)
			this.#selected = state?.radiantJ2000 ? { id, name: radiant?.name ?? this.#targets.selectedName ?? id, ...state.radiantJ2000, visual: radiant?.visual ?? false } : undefined
			this.redraw()
		} catch {
			if (!request.current()) return
			this.#selectedTime = undefined
			this.#retryAt = Date.now() + LOAD_RETRY_DELAY_MS
		}
	}
}

// Whether radiants asked for at `requested` (absent when never) are out of date at `time`.
export function outdated(requested: number | undefined, time: number) {
	return requested === undefined || Math.abs(time - requested) > REFRESH_SPAN_MS
}

// Whether the drift path asked for at `requested` (absent when never) no longer covers `time`: never asked, or the instant
// is more than PATH_MARGIN_MS outside the occurrence of the path (or of the request, for a shower without a path).
export function pathOutdated(path: MeteorRadiantPath | undefined, requested: number | undefined, time: number) {
	if (requested === undefined) return true
	const start = path?.start ?? requested
	const end = path?.end ?? requested
	return time < start - PATH_MARGIN_MS || time > end + PATH_MARGIN_MS
}
