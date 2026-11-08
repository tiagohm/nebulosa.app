import type { SatelliteTrack, SatelliteTracksResponse } from 'api'
import { jsonInit } from '../http'
import { type GeographicLocation, siteObserver } from '../location/site'
import type { Celestial, CelestialShape, MovingBody } from './celestial/celestial'
import { refKey } from './objects'
import { interpolateTrack, type TrackWindow, trackWindow, windowServes } from './satellites.track'
import { createRequestGuard } from './selection'

// Artificial satellites on the Sky map: the satellites asked for (the selected one and the favorites, while the
// satellites layer is shown) drawn as moving bodies of type `satellite`, which the `satellites` layer of the map draws,
// at the instant of the Sky clock, interpolated between the samples the server computes for a window around that
// instant, the selected one's track drawn on request, and the view kept on it while tracked. Only the samples of the
// window are requested, never the catalog, and never once per update: a new window is asked for when the clock leaves
// the current one, the satellites or the observer change, or the catalog changes.
// Markers move about four times a second (once a second with reduced motion) while the page is shown: each move of a
// moving body rebuilds the pick index of the map, so a per-frame update would cost more than the motion needs.

// Interval of the marker updates, in milliseconds, and with reduced motion.
const UPDATE_INTERVAL_MS = 250
const REDUCED_MOTION_INTERVAL_MS = 1000

// Wait after a request of the samples failed (the server away or answering an error) before asking again, in milliseconds;
// the updates would otherwise ask the server for a batch of SGP4 propagations at their own rate.
const LOAD_RETRY_DELAY_MS = 10000

// Id of the shape of the track of the selected satellite.
const TRAIL_SHAPE_ID = 'satellite-trail'

// What the map draws.
export interface SatelliteTargets {
	// NORAD ids to draw, the selected one included; at most 50 are sampled.
	readonly ids: readonly string[]
	// NORAD id of the selected satellite; absent when another object or nothing is selected.
	readonly selected?: string
	// Observer of the profile; absent for geocentric positions.
	readonly observer?: GeographicLocation
	// Revision of the satellite catalog, whose change asks for the samples again.
	readonly revision: number
	// Whether the view follows the selected satellite.
	readonly tracking: boolean
	// Whether the track of the selected satellite is drawn.
	readonly trail: boolean
}

// Services of the map the layer uses.
export interface SatelliteMap {
	// Instant the map shows, Unix milliseconds (UTC).
	readonly time: () => number
	// Rate of the clock, simulated seconds per second; 1 while following the real time, 0 for a fixed instant.
	readonly rate: () => number
	// Pans the view to a point of date, radians.
	readonly centerOn: (point: { rightAscension: number; declination: number }) => void
}

// Satellites drawn on one map.
export class SatelliteLayer {
	readonly #bodies = new Map<string, MovingBody>()
	readonly #tracks = new Map<string, { readonly name: string; readonly track: SatelliteTrack }>()
	readonly #guard = createRequestGuard()
	#targets: SatelliteTargets = { ids: [], revision: 0, tracking: false, trail: false }
	#window?: TrackWindow
	// Key of the targets the samples were asked for; another key asks again.
	#key = ''
	#loading = false
	// Instant before which a failed request of the samples is not asked again, in Unix milliseconds.
	#retryAt = 0
	#timer?: Timer
	#running = false

	// Creates the layer of a map.
	constructor(
		private readonly celestial: Celestial,
		private readonly map: SatelliteMap,
		private readonly fetch: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => globalThis.fetch(input, init),
	) {}

	// Sets what is drawn; samples are asked for again when the satellites, the observer, or the catalog changed.
	set(targets: SatelliteTargets) {
		this.#targets = targets
		const key = `${targets.ids.join(',')}|${targets.observer ? `${targets.observer.latitude},${targets.observer.longitude},${targets.observer.elevation}` : ''}|${targets.revision}`

		if (key !== this.#key) {
			this.#key = key
			this.#window = undefined
			this.#tracks.clear()
			this.#guard.cancel()
			this.#loading = false
			this.#retryAt = 0
		}

		this.#schedule()
		this.update()
	}

	// Starts the updates while the map is shown.
	start() {
		this.#running = true
		this.#schedule()
	}

	// Stops the updates while the map is hidden.
	stop() {
		this.#running = false
		this.#schedule()
	}

	// Releases the layer for good.
	destroy() {
		this.stop()
		this.#guard.cancel()
	}

	// Runs the timer while the map is shown and something is drawn.
	#schedule() {
		clearInterval(this.#timer)
		this.#timer = undefined
		if (!this.#running || this.#targets.ids.length === 0) return
		const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
		this.#timer = setInterval(() => this.update(), reduced ? REDUCED_MOTION_INTERVAL_MS : UPDATE_INTERVAL_MS)
	}

	// Moves the markers to the instant of the map, asking for a new window when the instant leaves the current one.
	update() {
		if (typeof document !== 'undefined' && document.hidden) return
		const time = this.map.time()
		const rate = this.map.rate()
		if (this.#targets.ids.length > 0 && !this.#loading && Date.now() >= this.#retryAt && !windowServes(this.#window, time, rate)) void this.#load(time, rate)
		this.#draw(time)
	}

	// Asks the server for the samples of the window around an instant.
	async #load(time: number, rate: number) {
		const window = trackWindow(time, rate)
		const request = this.#guard.begin()
		this.#loading = true

		try {
			const response = await this.fetch('/api/satellites/tracks', jsonInit('POST', { ids: this.#targets.ids, observer: siteObserver(this.#targets.observer), start: window.start, end: window.end, step: window.step }, request.signal))
			if (!request.current()) return

			if (!response.ok) {
				this.#retryAt = Date.now() + LOAD_RETRY_DELAY_MS
				return
			}

			const { tracks } = (await response.json()) as SatelliteTracksResponse
			if (!request.current()) return
			this.#tracks.clear()
			for (const entry of tracks) if ('track' in entry) this.#tracks.set(entry.noradId, { name: entry.name, track: entry.track })
			this.#window = window
		} catch {
			// The markers stay where they were; an update asks again once the retry delay passed.
			if (request.current()) this.#retryAt = Date.now() + LOAD_RETRY_DELAY_MS
		} finally {
			if (request.current()) this.#loading = false
		}

		this.#draw(this.map.time())
	}

	// Places the markers at an instant, removes those no longer asked for, and draws the track and follows the selected
	// satellite when asked.
	#draw(time: number) {
		const wanted = new Set(this.#targets.ids)
		let changed = false

		for (const [noradId, body] of this.#bodies) {
			if (wanted.has(noradId) && this.#tracks.has(noradId)) continue
			this.celestial.removeMovingBody(body.id)
			this.#bodies.delete(noradId)
			changed = true
		}

		let selected: { rightAscension: number; declination: number } | undefined

		for (const [noradId, { name, track }] of this.#tracks) {
			if (!wanted.has(noradId)) continue
			const point = interpolateTrack(track, time)
			let body = this.#bodies.get(noradId)

			if (!body) {
				body = { id: refKey({ kind: 'satellite', noradId }), type: 'satellite', name, alwaysVisible: true, position: { rightAscension: 0, declination: 0 }, visible: false }
				this.#bodies.set(noradId, body)
				this.celestial.addMovingBody(body)
			}

			body.visible = point !== undefined
			if (point) Object.assign(body.position, { rightAscension: point.rightAscension, declination: point.declination })
			if (point && noradId === this.#targets.selected) selected = point
			changed = true
		}

		if (changed) this.celestial.markMovingBodyDirty()
		this.#drawTrail(selected)
		if (selected && this.#targets.tracking) this.map.centerOn(selected)
	}

	// Draws the samples of the selected satellite's window as a line, anchored at its position; removes it otherwise.
	#drawTrail(anchor: { rightAscension: number; declination: number } | undefined) {
		const entry = this.#targets.selected ? this.#tracks.get(this.#targets.selected) : undefined

		if (!anchor || !entry || !this.#targets.trail) {
			this.celestial.removeShape(TRAIL_SHAPE_ID)
			return
		}

		const { track } = entry
		const shape: CelestialShape = {
			id: TRAIL_SHAPE_ID,
			coordinate: anchor,
			selectable: false,
			render: (_, ctx, { state }) => {
				const point: [number, number] = [0, 0]
				let drawing = false
				ctx.strokeStyle = state.theme.movingBodies.satelliteColor
				ctx.globalAlpha = 0.9
				ctx.lineWidth = 1.5
				ctx.setLineDash([6, 4])
				ctx.beginPath()

				for (let i = 0; i < track.times.length; i++) {
					// A sample the projection cannot place (below the horizon) breaks the line.
					if (!state.projectEquatorialToScreen(track.rightAscension[i], track.declination[i], point)) {
						drawing = false
						continue
					}

					if (drawing) ctx.lineTo(point[0], point[1])
					else ctx.moveTo(point[0], point[1])
					drawing = true
				}

				ctx.stroke()
			},
		}

		this.celestial.addShape(shape)
	}
}
