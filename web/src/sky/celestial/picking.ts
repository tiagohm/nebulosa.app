import { clamp } from 'nebulosa/src/math/numerical/math'
import type { CelestialObject } from './types'

// Screen-space picking for the star map: a fixed-grid spatial index over projected objects and the helpers
// that relate pick results, picked objects, and the layers that own them. Positions are screen pixels.

// Pick type of a star.
export const PICK_TYPE_STAR = 1
// Pick type of a deep-sky object.
export const PICK_TYPE_DSO = 2
// Pick type of a planet, asteroid, or comet.
export const PICK_TYPE_MOVING_BODY = 3
// Pick type of a constellation label.
export const PICK_TYPE_CONSTELLATION_LABEL = 4
// Pick type of a custom shape.
export const PICK_TYPE_SHAPE = 5

// Nearest pick result; the index refers to the collection of its type.
export interface PickIndex {
	// One of the PICK_TYPE_* values.
	readonly type: number
	// Index in the collection of that type.
	readonly index: number
}

// Pick result reused by the index to avoid allocation.
type MutablePickIndex = {
	-readonly [K in keyof PickIndex]: PickIndex[K]
}

// Fixed-grid spatial index of pickable screen positions, rebuilt after projection and view changes.
export class FixedGridSpatialIndex {
	// Grid cell size in pixels.
	private cellSize = 24
	// Number of grid columns.
	private columns = 1
	// Number of grid rows.
	private rows = 1
	// First entry of each cell's linked list, or -1.
	private heads = new Int32Array(1)
	// Next entry in the same cell, or -1.
	private next = new Int32Array(0)
	// Pick type of each entry.
	private type = new Uint8Array(0)
	// Collection index of each entry.
	private index = new Int32Array(0)
	// Screen x of each entry in pixels.
	private x = new Float32Array(0)
	// Screen y of each entry in pixels.
	private y = new Float32Array(0)
	// Magnitude of each entry, which biases picking toward brighter objects.
	private mag = new Float32Array(0)
	// Reused nearest result.
	private readonly nearest: MutablePickIndex = { type: 0, index: 0 }
	// Number of entries.
	private count = 0

	// Clears the index and sizes the grid for a canvas of the given pixel size and cell size (at least 4).
	reset(width: number, height: number, cellSize: number) {
		this.cellSize = Math.max(4, cellSize)
		this.columns = Math.max(1, Math.ceil(width / this.cellSize))
		this.rows = Math.max(1, Math.ceil(height / this.cellSize))
		const neededCells = this.columns * this.rows

		if (this.heads.length !== neededCells) {
			this.heads = new Int32Array(neededCells)
		}

		this.heads.fill(-1)
		this.count = 0
	}

	// Adds a pickable object at screen position (x, y); positions outside the canvas are ignored.
	add(type: number, index: number, x: number, y: number, mag = 99) {
		if (x < 0 || y < 0) return

		const cellX = Math.floor(x / this.cellSize)
		const cellY = Math.floor(y / this.cellSize)
		if (cellX < 0 || cellY < 0 || cellX >= this.columns || cellY >= this.rows) return

		this.ensureCapacity(this.count + 1)
		const entry = this.count++
		const cell = cellY * this.columns + cellX
		this.type[entry] = type
		this.index[entry] = index
		this.x[entry] = x
		this.y[entry] = y
		this.mag[entry] = mag
		this.next[entry] = this.heads[cell]
		this.heads[cell] = entry
	}

	// Returns the best object within `radius` pixels of (x, y), favoring closer and brighter stars and any
	// non-star object; the result is reused by the next call.
	findNearest(x: number, y: number, radius: number): PickIndex | null {
		const minCellX = clamp(Math.floor((x - radius) / this.cellSize), 0, this.columns - 1)
		const maxCellX = clamp(Math.floor((x + radius) / this.cellSize), 0, this.columns - 1)
		const minCellY = clamp(Math.floor((y - radius) / this.cellSize), 0, this.rows - 1)
		const maxCellY = clamp(Math.floor((y + radius) / this.cellSize), 0, this.rows - 1)
		const radiusSq = radius * radius
		let bestEntry = -1
		let bestScore = Number.POSITIVE_INFINITY

		for (let cy = minCellY; cy <= maxCellY; cy++) {
			for (let cx = minCellX; cx <= maxCellX; cx++) {
				let entry = this.heads[cy * this.columns + cx]

				while (entry >= 0) {
					const dx = this.x[entry] - x
					const dy = this.y[entry] - y
					const distanceSq = dx * dx + dy * dy

					if (distanceSq <= radiusSq) {
						const priority = this.type[entry] === PICK_TYPE_STAR ? Math.max(0, this.mag[entry] + 2) : Math.min(-4, this.mag[entry])
						const score = distanceSq + priority

						if (score < bestScore) {
							bestScore = score
							bestEntry = entry
						}
					}

					entry = this.next[entry]
				}
			}
		}

		if (bestEntry < 0) {
			return null
		}

		this.nearest.type = this.type[bestEntry]
		this.nearest.index = this.index[bestEntry]
		return this.nearest
	}

	// Grows the entry arrays to hold at least `capacity` entries, doubling to amortize growth.
	private ensureCapacity(capacity: number) {
		if (this.x.length >= capacity) return

		const nextCapacity = Math.max(capacity, Math.max(1024, this.x.length * 2))
		this.x = grow(this.x, new Float32Array(nextCapacity))
		this.y = grow(this.y, new Float32Array(nextCapacity))
		this.mag = grow(this.mag, new Float32Array(nextCapacity))
		this.index = grow(this.index, new Int32Array(nextCapacity))
		this.next = grow(this.next, new Int32Array(nextCapacity))
		this.type = grow(this.type, new Uint8Array(nextCapacity))
	}
}

// Copies `source` into the larger `output` array and returns it.
function grow<T extends Float32Array | Int32Array | Uint8Array>(source: T, output: T) {
	output.set(source)
	return output
}

// Returns whether a pick result refers to the given object; shapes never match because their pick indices
// are rebuilt on every index rebuild.
export function pickMatchesObject(index: PickIndex | null, object: CelestialObject | null) {
	if (!index || !object) {
		return index === null && object === null
	}

	switch (index.type) {
		case PICK_TYPE_STAR:
			return object.type === 'star' && object.index === index.index
		case PICK_TYPE_DSO:
			return object.type === 'deepSky' && object.index === index.index
		case PICK_TYPE_MOVING_BODY:
			return object.type === 'movingBody' && object.index === index.index
		case PICK_TYPE_CONSTELLATION_LABEL:
			return object.type === 'constellationLabel' && object.index === index.index
		default:
			return false
	}
}

// Returns whether a layer holds pickable objects.
export function isPickableLayerId(layerId: string) {
	switch (layerId) {
		case 'stars':
		case 'deepSky':
		case 'movingBodies':
		case 'constellationLabels':
		case 'shapes':
			return true
		default:
			return false
	}
}

// Returns the id of the layer that draws an object.
export function objectLayerId(object: CelestialObject) {
	switch (object.type) {
		case 'star':
			return 'stars'
		case 'deepSky':
			return 'deepSky'
		case 'movingBody':
			return 'movingBodies'
		case 'constellationLabel':
			return 'constellationLabels'
		case 'shape':
			return 'shapes'
	}
}

// Returns whether two nullable objects are the same: shapes and moving bodies by id, others by index.
export function sameObject(a: CelestialObject | null, b: CelestialObject | null) {
	if (a === b) {
		return true
	}

	if (!a || !b || a.type !== b.type) return false

	if (a.type === 'shape' && b.type === 'shape') {
		return a.id === b.id
	}

	if (a.type === 'movingBody' && b.type === 'movingBody') {
		return a.object.id === b.object.id
	}

	return 'index' in a && 'index' in b && a.index === b.index
}
