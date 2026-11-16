import { positionSkyLabel, STAR_LABEL_OFFSET_X, STAR_LABEL_OFFSET_Y } from './drawing'
import { applyViewTransform, writeBaseViewportBounds } from './geometry'
import type { RenderState } from './types'
import { starLabelMagnitudeLimit } from './visibility'

// Placement of the star names of a frame, shared by the layers that draw names: the star layer draws them, and the
// deep-sky layer leaves out a name that would overlap one, so bright star names, the map's landmarks, win over deep-sky
// names. Both layers draw on different canvases, so the names are placed once per frame (RenderState.frame), whichever
// layer asks first, from the frame's state alone; the renderer redraws the two layers together, so neither canvas keeps
// names placed against the other's previous frame.

// Minimum screen distance in pixels between star labels; higher reduces overlap but shows fewer labels.
const STAR_LABEL_MIN_SPACING = 36

// Height in pixels of the box a star name occupies, at the 10 px star label font.
const STAR_LABEL_BOX_HEIGHT = 13

// Star names placed for one frame: the catalog index of each star, where its name starts (pixels, the left end on the
// text's middle line), and its width in pixels.
export class StarLabelPlacement {
	// Frame the placement was computed for; -1 before the first.
	private frame = -1
	private placedCount = 0
	private indices = new Int32Array(0)
	private x = new Float32Array(0)
	private y = new Float32Array(0)
	private widths = new Float32Array(0)
	// Scratch of the candidates of a placement, in base screen pixels.
	private candidateIndices = new Int32Array(0)
	private candidateX = new Float32Array(0)
	private candidateY = new Float32Array(0)
	private readonly point = new Float32Array(2)
	private readonly labelPoint = new Float32Array(2)
	private readonly baseViewportBounds = new Float64Array(4)

	// Number of names placed in the frame last computed.
	get count() {
		return this.placedCount
	}

	// Returns the catalog index of the star of placed name `i`.
	index(i: number) {
		return this.indices[i]
	}

	// Returns the left end, in pixels, of placed name `i`.
	labelX(i: number) {
		return this.x[i]
	}

	// Returns the middle line, in pixels, of placed name `i`.
	labelY(i: number) {
		return this.y[i]
	}

	// Places the star names of the state's frame, unless already placed for it: named stars bright enough for the zoom
	// and inside the viewport, in the order the catalog names them, each beside its star and skipped when it would sit
	// closer than STAR_LABEL_MIN_SPACING to one placed before. Nothing is placed while the star layer or its names are
	// hidden. The context only measures the names, in the star label font; its state is restored.
	place(ctx: CanvasRenderingContext2D, state: RenderState) {
		if (this.frame === state.frame) return this
		this.frame = state.frame
		this.placedCount = 0

		const catalog = state.starCatalog
		if (!catalog || !state.stars.labels || !state.celestial.isLayerVisible('stars') || !catalog.namedIndices || catalog.namedIndices.length === 0) return this

		const maxMagnitude = starLabelMagnitudeLimit(state)
		this.ensureCapacity(catalog.namedIndices.length)
		writeBaseViewportBounds(state.width, state.height, state.transform, 0, this.baseViewportBounds)
		let candidates = 0

		for (let i = 0; i < catalog.namedIndices.length; i++) {
			const index = catalog.namedIndices[i]
			if (!catalog.visible[index] || catalog.mag[index] > maxMagnitude) continue

			const x = catalog.screenX[index]
			const y = catalog.screenY[index]
			if (x < this.baseViewportBounds[0] || x > this.baseViewportBounds[1] || y < this.baseViewportBounds[2] || y > this.baseViewportBounds[3]) continue

			applyViewTransform(x, y, state.width, state.height, state.transform, this.point)
			this.candidateIndices[candidates] = index
			this.candidateX[candidates] = this.point[0]
			this.candidateY[candidates] = this.point[1]
			candidates++
		}

		if (candidates === 0) return this

		ctx.save()
		ctx.font = state.theme.stars.labelFont

		for (let i = 0; i < candidates; i++) {
			const index = this.candidateIndices[i]
			const name = catalog.names[index]
			if (!name || !positionSkyLabel(ctx, state, name, this.candidateX[i], this.candidateY[i], STAR_LABEL_OFFSET_X, STAR_LABEL_OFFSET_Y, this.labelPoint)) continue

			const x = this.labelPoint[0]
			const y = this.labelPoint[1]
			if (this.hasNearby(x, y)) continue

			this.indices[this.placedCount] = index
			this.x[this.placedCount] = x
			this.y[this.placedCount] = y
			this.widths[this.placedCount] = ctx.measureText(name).width
			this.placedCount++
		}

		ctx.restore()
		return this
	}

	// Returns whether the box from (left, top) to (right, bottom), in pixels, overlaps a placed star name.
	overlaps(left: number, top: number, right: number, bottom: number) {
		const half = STAR_LABEL_BOX_HEIGHT / 2

		for (let i = 0; i < this.placedCount; i++) {
			if (left < this.x[i] + this.widths[i] && right > this.x[i] && top < this.y[i] + half && bottom > this.y[i] - half) return true
		}

		return false
	}

	// Returns whether a name placed so far starts closer than STAR_LABEL_MIN_SPACING to (x, y).
	private hasNearby(x: number, y: number) {
		const minDistanceSquared = STAR_LABEL_MIN_SPACING * STAR_LABEL_MIN_SPACING

		for (let i = 0; i < this.placedCount; i++) {
			const dx = this.x[i] - x
			const dy = this.y[i] - y
			if (dx * dx + dy * dy < minDistanceSquared) return true
		}

		return false
	}

	// Grows the arrays to at least `capacity` names.
	private ensureCapacity(capacity: number) {
		if (this.indices.length >= capacity) return

		this.indices = new Int32Array(capacity)
		this.x = new Float32Array(capacity)
		this.y = new Float32Array(capacity)
		this.widths = new Float32Array(capacity)
		this.candidateIndices = new Int32Array(capacity)
		this.candidateX = new Float32Array(capacity)
		this.candidateY = new Float32Array(capacity)
	}
}
