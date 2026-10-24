import type { MinorBody, SkyObjectCategory, SkyObjectRef } from 'api'
import type { CelestialObject } from './celestial/celestial'
import type { SkySelectionRef } from './objects'

// Objects the star map does not draw from its own data but that were selected in the tab: minor bodies
// found in the Small-Body Database, and catalog stars and deep-sky objects fainter than the map data. They
// are remembered in memory for the tab, at most REMEMBERED_LIMIT of them, the least recently selected
// forgotten first, so they stay drawn and can be selected again on the map. Pure state, owned by the
// planetarium; positions are kept by its updates.

// Most objects remembered per tab.
export const REMEMBERED_LIMIT = 32

// Kind of the custom map shape drawing a remembered catalog object.
export const REMEMBERED_SHAPE_TYPE = 'remembered'

// Prefix of the map id of the shape of a remembered catalog object, followed by its reference key.
const REMEMBERED_SHAPE_PREFIX = 'remembered:'

// Object the map draws only because it was selected.
export interface RememberedObject {
	// Identity of the object: a catalog object or a minor body.
	readonly ref: SkyObjectRef
	// Stable key of the identity (refKey).
	readonly key: string
	// Display name.
	name: string
	// Object type, such as "Star" or "Planetary Nebula".
	typeName: string
	// Group of the object.
	category?: SkyObjectCategory
	// SBDB data of a minor body, kept so selecting it again needs no new lookup.
	minorBody?: MinorBody
	// Right ascension of date (JNOW) in radians, at the latest instant computed.
	rightAscension: number
	// Declination of date in radians, at the latest instant computed.
	declination: number
	// Visual magnitude, when known.
	magnitude?: number
}

// Data the shape of a remembered catalog object carries.
export interface RememberedShapeData {
	// Key of the remembered object.
	readonly key: string
	// The remembered object, whose name and position are updated in place.
	readonly object: RememberedObject
}

// Returns the map id of the shape of a remembered catalog object by its reference key.
export function rememberedShapeId(key: string) {
	return `${REMEMBERED_SHAPE_PREFIX}${key}`
}

// Whether a reference is of an object the map remembers when it does not draw it: catalog objects and
// minor bodies. Major bodies and constellations are always drawn; the mount has its own marker.
export function isRememberable(ref: SkySelectionRef): ref is SkyObjectRef {
	return ref.kind === 'catalog' || ref.kind === 'minorBody'
}

// Whether a shape's data is a remembered object's.
function isRememberedShapeData(value: unknown): value is RememberedShapeData {
	return typeof value === 'object' && value !== null && typeof (value as Partial<RememberedShapeData>).key === 'string' && typeof (value as Partial<RememberedShapeData>).object === 'object'
}

// Returns the remembered object of a picked shape; undefined for anything else.
export function rememberedOf(object: CelestialObject): RememberedObject | undefined {
	return object.type === 'shape' && object.shape.type === REMEMBERED_SHAPE_TYPE && isRememberedShapeData(object.shape.data) ? object.shape.data.object : undefined
}

// Remembered objects of a tab, the most recently remembered last.
export class RememberedObjects {
	readonly #objects = new Map<string, RememberedObject>()

	// Creates an empty set holding at most `limit` objects.
	constructor(readonly limit: number = REMEMBERED_LIMIT) {}

	// Number of objects remembered.
	get size() {
		return this.#objects.size
	}

	// Returns the remembered object of a reference key.
	get(key: string) {
		return this.#objects.get(key)
	}

	// Remembered objects, the least recently remembered first.
	values() {
		return this.#objects.values()
	}

	// Remembers an object, or updates the one of the same key and makes it the most recent. Returns the
	// objects forgotten to stay within the limit, never the one just remembered.
	remember(object: RememberedObject): RememberedObject[] {
		this.#objects.delete(object.key)
		this.#objects.set(object.key, object)

		const forgotten: RememberedObject[] = []

		for (const [key, oldest] of this.#objects) {
			if (this.#objects.size <= this.limit) break
			this.#objects.delete(key)
			forgotten.push(oldest)
		}

		return forgotten
	}
}
