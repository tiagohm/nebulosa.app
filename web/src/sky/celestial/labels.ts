import { clamp } from 'nebulosa/src/math/numerical/math'
import { positionSkyLabel, skyLabelFont, skyLabelSize, STAR_LABEL_OFFSET_X, STAR_LABEL_OFFSET_Y } from './drawing'
import { applyViewTransform, isPointInsideViewportMargin, writeBaseViewportBounds } from './geometry'
import { movingBodyLayerId } from './picking'
import type { RenderState } from './types'
import { isMovingBodyVisible, isMovingLabelOptional, isOptionalMovingLabelVisible, isSmallBody, starLabelMagnitudeLimit } from './visibility'

// Space the names of the star map share, so no name is drawn over another, in a fixed priority: the names of the Sun,
// the Moon, the planets, and the asteroids and comets always visible (looked for) are always drawn; then star names, the
// map's landmarks; then the names of the other asteroids and comets (those of the kernels of the library), bright enough
// for the zoom; then deep-sky names; then satellite names (the selected satellite's always); then constellation names. A name that would overlap
// one of a higher priority, or one of its own kind drawn before, is left out (the hover and selection overlay still names
// a star or a deep-sky object).
//
// The layers draw on three canvases that redraw independently. Moving-body and star names are placed once per frame
// (RenderState.frame) from the frame's state alone, by whichever layer asks first; deep-sky names are kept as their layer
// last drew them; satellite and constellation names, drawn last on the dynamic canvas, are placed against both. The
// renderer redraws the moving-body, star, deep-sky, and constellation-name layers together, so no canvas keeps names
// placed against another's previous frame; a satellite update redraws only its own canvas, against names that did not
// change.

// Minimum screen distance in pixels between star labels; higher reduces overlap but shows fewer labels.
const STAR_LABEL_MIN_SPACING = 36

// Height in pixels of the box of a name per pixel of its font size: the text and a little air above and below.
const LABEL_BOX_HEIGHT_PER_FONT_PX = 1.3

// Gap in pixels kept around the box of a deep-sky, satellite, or constellation name, so two names never touch.
const LABEL_GAP = 4

// Distance in pixels a moved moving-body name keeps from the left and right sides of the view, as positionSkyLabel keeps.
const LABEL_EDGE_INSET = 2

// Font size in pixels of the star and constellation names (the 10 px label fonts of the theme).
const FIXED_LABEL_FONT_PX = 10

// Base font size in pixels of the moving-body names, which grows with zoom (skyLabelSize).
const MOVING_LABEL_BASE_PX = 9

// Boxes of names, as left, top, right, bottom in pixels, four values per name.
class Boxes {
	private values = new Float32Array(64)
	count = 0

	// Forgets every box.
	clear() {
		this.count = 0
	}

	// Adds a box.
	add(left: number, top: number, right: number, bottom: number) {
		if ((this.count + 1) * 4 > this.values.length) {
			const grown = new Float32Array(this.values.length * 2)
			grown.set(this.values)
			this.values = grown
		}

		const at = this.count++ * 4
		this.values[at] = left
		this.values[at + 1] = top
		this.values[at + 2] = right
		this.values[at + 3] = bottom
	}

	// Returns whether a box overlaps one of these.
	overlaps(left: number, top: number, right: number, bottom: number) {
		for (let i = 0; i < this.count * 4; i += 4) {
			if (left < this.values[i + 2] && right > this.values[i] && top < this.values[i + 3] && bottom > this.values[i + 1]) return true
		}

		return false
	}
}

// Names of a frame and of the layers that drew last; one per map.
export class SkyLabelSpace {
	// Frame the moving-body and star names were placed for; -1 before the first.
	private frame = -1
	// Frame the dynamic-canvas names (satellites, constellations) were claimed in; -1 before the first.
	private dynamicFrame = -1
	// Boxes of the moving-body and star names of the frame.
	private readonly placed = new Boxes()
	// Boxes of the deep-sky names the deep-sky layer drew last.
	private readonly deepSky = new Boxes()
	// Boxes of the satellite and constellation names of the dynamic canvas's frame.
	private readonly dynamic = new Boxes()
	// Moving-body names of the frame: the slot of the name of each body by its index in RenderState.movingBodies (-1 when
	// it has none) for the frame's `movingBodyCount` bodies, and where each name starts (pixels), by slot.
	private movingBodyCount = 0
	private movingCount = 0
	private movingSlots = new Int32Array(0)
	private movingX = new Float32Array(0)
	private movingY = new Float32Array(0)
	// Star names of the frame: catalog index, and where each starts (pixels, the left end on the text's middle line).
	private starCount = 0
	private starIndices = new Int32Array(0)
	private starX = new Float32Array(0)
	private starY = new Float32Array(0)
	// Scratch of the star candidates of a placement, in screen pixels.
	private candidateIndices = new Int32Array(0)
	private candidateX = new Float32Array(0)
	private candidateY = new Float32Array(0)
	private readonly point = new Float32Array(2)
	private readonly labelPoint = new Float32Array(3)
	private readonly baseViewportBounds = new Float64Array(4)

	// Number of star names placed for the frame.
	get starNames() {
		return this.starCount
	}

	// Returns the catalog index of the star of placed star name `i`.
	starIndex(i: number) {
		return this.starIndices[i]
	}

	// Returns where placed star name `i` starts, as x then y in pixels.
	starAt(i: number, axis: 0 | 1) {
		return axis === 0 ? this.starX[i] : this.starY[i]
	}

	// Returns where the name of moving body `index` (of RenderState.movingBodies) starts, as x then y in pixels; undefined
	// when it has no name placed in the frame.
	movingAt(index: number, out: Float32Array) {
		const slot = index < this.movingBodyCount ? this.movingSlots[index] : -1
		if (slot < 0) return undefined
		out[0] = this.movingX[slot]
		out[1] = this.movingY[slot]
		return out
	}

	// Places the moving-body and star names of the state's frame, unless already placed for it: every visible moving body
	// of the movingBodies layer whose name is always drawn, then the named stars bright enough for the zoom and inside the
	// viewport, in the order the catalog names them, each beside its star and left out when it would overlap a
	// moving-body name or sit closer than STAR_LABEL_MIN_SPACING to a star name placed before, then the optional names of
	// the other asteroids and comets bright enough for the zoom, each left out when it would overlap any name placed before.
	// Hidden layers and hidden star names place nothing. The context only measures names; its state is restored.
	place(ctx: CanvasRenderingContext2D, state: RenderState) {
		if (this.frame === state.frame) return this
		this.frame = state.frame
		this.placed.clear()
		this.movingCount = 0
		this.starCount = 0

		this.movingBodyCount = state.movingBodies.length
		this.ensureMovingCapacity(this.movingBodyCount)
		this.movingSlots.fill(-1, 0, this.movingBodyCount)

		ctx.save()
		this.placeMovingBodies(ctx, state, false)
		this.placeStars(ctx, state)
		this.placeMovingBodies(ctx, state, true)
		ctx.restore()
		return this
	}

	// Records a deep-sky name's box starting at (x, y), vertically centred, `width` by `height` pixels, and returns true,
	// unless it would overlap a moving-body or star name of the frame or a deep-sky name drawn before in the deep-sky
	// layer's frame (cleared by beginDeepSky), which returns false.
	claimDeepSky(x: number, y: number, width: number, height: number) {
		const left = x - LABEL_GAP
		const top = y - height / 2 - LABEL_GAP
		const right = x + width + LABEL_GAP
		const bottom = y + height / 2 + LABEL_GAP
		if (this.placed.overlaps(left, top, right, bottom) || this.deepSky.overlaps(left, top, right, bottom)) return false
		this.deepSky.add(left, top, right, bottom)
		return true
	}

	// Forgets the deep-sky names, as the deep-sky layer starts drawing a frame.
	beginDeepSky() {
		this.deepSky.clear()
	}

	// Records the box of a dynamic-canvas name (a satellite or a constellation) from `left` to `right` and centred on `y`,
	// `height` pixels tall, and returns true, unless it would overlap a moving-body or star name of the frame, a deep-sky
	// name, or a dynamic-canvas name claimed before in the frame, which returns false. A `forced` name (the selected
	// satellite) is recorded whatever it overlaps.
	claimDynamic(state: RenderState, left: number, right: number, y: number, height: number, forced = false) {
		if (this.dynamicFrame !== state.frame) {
			this.dynamicFrame = state.frame
			this.dynamic.clear()
		}

		const l = left - LABEL_GAP
		const t = y - height / 2 - LABEL_GAP
		const r = right + LABEL_GAP
		const b = y + height / 2 + LABEL_GAP
		// A hidden deep-sky layer draws nothing, so its last names no longer take space.
		const deepSky = state.celestial.isLayerVisible('deepSky') && this.deepSky.overlaps(l, t, r, b)
		if (!forced && (this.placed.overlaps(l, t, r, b) || deepSky || this.dynamic.overlaps(l, t, r, b))) return false
		this.dynamic.add(l, t, r, b)
		return true
	}

	// Places the names of the visible moving bodies of the movingBodies layer, those of asteroids and comets only inside
	// the view: those always drawn, each moved around its body to fit where it can, or the `optional` ones, bright enough
	// for the zoom, each left out when it would overlap a name placed before.
	private placeMovingBodies(ctx: CanvasRenderingContext2D, state: RenderState, optional: boolean) {
		if (!state.celestial.isLayerVisible('movingBodies')) return

		ctx.font = skyLabelFont(state, MOVING_LABEL_BASE_PX)
		const height = skyLabelSize(state, MOVING_LABEL_BASE_PX) * LABEL_BOX_HEIGHT_PER_FONT_PX

		for (let i = 0; i < state.movingBodies.length; i++) {
			const object = state.movingBodies[i]
			if (movingBodyLayerId(object.type) !== 'movingBodies' || isMovingLabelOptional(object) !== optional || !isMovingBodyVisible(object, state)) continue
			if (optional && !isOptionalMovingLabelVisible(object, state)) continue
			if (!state.projectEquatorialToScreen(object.position.rightAscension, object.position.declination, this.point)) continue
			// An asteroid or comet outside the view has no name, which positionSkyLabel would pin to the nearest edge; the
			// Sun, the Moon, and the planets keep theirs there, pointing where they are.
			if (isSmallBody(object) && !isPointInsideViewportMargin(this.point[0], this.point[1], state.width, state.height, 0)) continue

			const name = object.name ?? object.type
			if (!positionSkyLabel(ctx, state, name, this.point[0], this.point[1], STAR_LABEL_OFFSET_X, STAR_LABEL_OFFSET_Y, this.labelPoint)) continue
			if (optional && this.placed.overlaps(this.labelPoint[0], this.labelPoint[1] - height / 2, this.labelPoint[0] + this.labelPoint[2], this.labelPoint[1] + height / 2)) continue

			// A name that would overlap an earlier moving body's (two planets in conjunction) tries the other side of its
			// body, then just below and above it, and is drawn where it first fits, or where it was placed when none does.
			const width = this.labelPoint[2]
			let x = this.labelPoint[0]
			let y = this.labelPoint[1]

			if (this.placed.overlaps(x, y - height / 2, x + width, y + height / 2)) {
				const left = this.point[0] - STAR_LABEL_OFFSET_X - width
				const right = this.point[0] + STAR_LABEL_OFFSET_X
				const alternatives = [
					[left, y],
					[right, this.point[1] + height],
					[left, this.point[1] + height],
					[right, this.point[1] - height],
					[left, this.point[1] - height],
				] as const
				// Kept inside the view as positionSkyLabel keeps a name, so a body near an edge can still move its name below
				// or above.
				for (const [ax, ay] of alternatives) {
					const cx = clamp(ax, LABEL_EDGE_INSET, state.width - width - LABEL_EDGE_INSET)
					const cy = clamp(ay, height / 2, state.height - height / 2)
					if (this.placed.overlaps(cx, cy - height / 2, cx + width, cy + height / 2)) continue
					x = cx
					y = cy
					break
				}
			}

			this.movingSlots[i] = this.movingCount
			this.movingX[this.movingCount] = x
			this.movingY[this.movingCount] = y
			this.movingCount++
			this.placed.add(x, y - height / 2, x + width, y + height / 2)
		}
	}

	// Places the star names that fit, after the moving-body names.
	private placeStars(ctx: CanvasRenderingContext2D, state: RenderState) {
		const catalog = state.starCatalog
		if (!catalog || !state.stars.labels || !state.celestial.isLayerVisible('stars') || !catalog.namedIndices || catalog.namedIndices.length === 0) return

		const maxMagnitude = starLabelMagnitudeLimit(state)
		this.ensureStarCapacity(catalog.namedIndices.length)
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

		ctx.font = state.theme.stars.labelFont
		const half = (FIXED_LABEL_FONT_PX * LABEL_BOX_HEIGHT_PER_FONT_PX) / 2

		for (let i = 0; i < candidates; i++) {
			const index = this.candidateIndices[i]
			const name = catalog.names[index]
			if (!name || !positionSkyLabel(ctx, state, name, this.candidateX[i], this.candidateY[i], STAR_LABEL_OFFSET_X, STAR_LABEL_OFFSET_Y, this.labelPoint)) continue

			const x = this.labelPoint[0]
			const y = this.labelPoint[1]
			const right = x + this.labelPoint[2]
			if (this.hasNearbyStar(x, y) || this.placed.overlaps(x, y - half, right, y + half)) continue

			this.starIndices[this.starCount] = index
			this.starX[this.starCount] = x
			this.starY[this.starCount] = y
			this.starCount++
			this.placed.add(x, y - half, right, y + half)
		}
	}

	// Returns whether a star name placed so far starts closer than STAR_LABEL_MIN_SPACING to (x, y).
	private hasNearbyStar(x: number, y: number) {
		const minDistanceSquared = STAR_LABEL_MIN_SPACING * STAR_LABEL_MIN_SPACING

		for (let i = 0; i < this.starCount; i++) {
			const dx = this.starX[i] - x
			const dy = this.starY[i] - y
			if (dx * dx + dy * dy < minDistanceSquared) return true
		}

		return false
	}

	// Grows the moving-body arrays to at least `capacity` names.
	private ensureMovingCapacity(capacity: number) {
		if (this.movingSlots.length >= capacity) return

		this.movingSlots = new Int32Array(capacity)
		this.movingX = new Float32Array(capacity)
		this.movingY = new Float32Array(capacity)
	}

	// Grows the star arrays to at least `capacity` names.
	private ensureStarCapacity(capacity: number) {
		if (this.starIndices.length >= capacity) return

		this.starIndices = new Int32Array(capacity)
		this.starX = new Float32Array(capacity)
		this.starY = new Float32Array(capacity)
		this.candidateIndices = new Int32Array(capacity)
		this.candidateX = new Float32Array(capacity)
		this.candidateY = new Float32Array(capacity)
	}
}

// Height in pixels of the box of a constellation name, at the 10 px constellation label font.
export const CONSTELLATION_LABEL_BOX_HEIGHT = FIXED_LABEL_FONT_PX * LABEL_BOX_HEIGHT_PER_FONT_PX

// Returns the height in pixels of the box of a zoom-scaled name (moving bodies, satellites, deep-sky objects) of a base
// font size in pixels.
export function scaledLabelBoxHeight(state: RenderState, baseSize: number) {
	return skyLabelSize(state, baseSize) * LABEL_BOX_HEIGHT_PER_FONT_PX
}
