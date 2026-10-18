import type { SkyObjectRef, SkySearchResult } from 'api'
import type { CelestialObject, MovingBodyType, SelectionTarget } from './celestial/celestial'

// Identity of sky objects in the web client: the stable key of an API object reference, the map ids of
// moving bodies, and conversions between objects picked on the Celestial map and API references. Pure
// functions, shared by the store and the workspace.

// Prefix of the map id of a major solar-system body, followed by its Horizons command.
const BODY_ID_PREFIX = 'body:'

// Prefix of the map id of a minor body, followed by its SPK-ID.
const MINOR_ID_PREFIX = 'minor:'

// Map data that names the objects the map draws.
export interface MapNames {
	// Deep-sky type names by Stellarium type, sent with the deep-sky data.
	readonly typeNames: readonly string[]
	// Catalog designation of each star by its index in the star data.
	readonly starDesignations: readonly string[]
	// Upper-case IAU constellation code of each constellation label, by label name.
	readonly constellationCodes: ReadonlyMap<string, string>
}

// Returns the stable key of an object reference: "catalog:32263", "body:499", "minor:20000001", or
// "constellation:ORI".
export function refKey(ref: SkyObjectRef): string {
	if (ref.kind === 'catalog') return `catalog:${ref.id}`
	if (ref.kind === 'body') return `${BODY_ID_PREFIX}${ref.code}`
	if (ref.kind === 'constellation') return `constellation:${ref.code}`
	return `${MINOR_ID_PREFIX}${ref.spkId}`
}

// Returns the map id of the moving body of a solar-system reference; undefined for other objects.
export function movingBodyId(ref: SkyObjectRef): string | undefined {
	return ref.kind === 'body' || ref.kind === 'minorBody' ? refKey(ref) : undefined
}

// Returns the API reference of an object picked on the map; undefined for custom shapes and labels of
// unknown constellations.
export function refOfCelestialObject(object: CelestialObject, names: MapNames): SkyObjectRef | undefined {
	switch (object.type) {
		case 'star':
			return { kind: 'catalog', id: +object.id }
		case 'deepSky':
			return { kind: 'catalog', id: +object.object.id }
		case 'movingBody': {
			const id = object.object.id
			if (id.startsWith(BODY_ID_PREFIX)) return { kind: 'body', code: id.slice(BODY_ID_PREFIX.length) as Extract<SkyObjectRef, { kind: 'body' }>['code'] }
			if (id.startsWith(MINOR_ID_PREFIX)) return { kind: 'minorBody', spkId: id.slice(MINOR_ID_PREFIX.length), designation: object.object.name ?? id }
			return undefined
		}
		case 'constellationLabel': {
			const code = names.constellationCodes.get(object.label.name)
			return code ? { kind: 'constellation', code } : undefined
		}
		default:
			return undefined
	}
}

// Returns the map objects a reference may select, in the order to try: a catalog id may be a star or a
// deep-sky object; solar-system objects are moving bodies; a constellation is any of its labels.
export function selectionTargets(ref: SkyObjectRef, category: SkySearchResult['category'] | undefined, names: MapNames): SelectionTarget[] {
	if (ref.kind === 'constellation') {
		return [...names.constellationCodes].filter(([, code]) => code === ref.code).map(([name]) => ({ type: 'constellationLabel', id: name }))
	}

	if (ref.kind !== 'catalog') return [{ type: 'movingBody', id: refKey(ref) }]
	if (category === 'star') return [{ type: 'star', id: ref.id }]
	if (category === 'deepSky') return [{ type: 'deepSky', id: ref.id }]
	return [
		{ type: 'star', id: ref.id },
		{ type: 'deepSky', id: ref.id },
	]
}

// Short description of a hovered object, from the data the map already holds.
export interface HoverLabel {
	// Name, or a generic name when the object has none.
	readonly name: string
	// Object type, such as "Star" or "Open Star Cluster".
	readonly typeName: string
	// Visual magnitude, when known.
	readonly magnitude?: number
}

// Name of each moving body type.
const MOVING_BODY_TYPE_NAMES: Readonly<Record<MovingBodyType, string>> = {
	sun: 'Star',
	moon: 'Natural Satellite',
	mercury: 'Planet',
	venus: 'Planet',
	mars: 'Planet',
	jupiter: 'Planet',
	saturn: 'Planet',
	uranus: 'Planet',
	neptune: 'Planet',
	asteroid: 'Minor Body',
	comet: 'Comet',
}

// Returns the hover label of a picked object; undefined for objects without one (custom shapes). A star
// without a proper name is named by its catalog designation.
export function hoverLabel(object: CelestialObject, names: MapNames): HoverLabel | undefined {
	switch (object.type) {
		case 'star': {
			const designation = names.starDesignations[object.index]
			return { name: object.name || designation || `Star ${object.id}`, typeName: object.name && designation ? `Star · ${designation}` : 'Star', magnitude: object.mag }
		}
		case 'deepSky':
			return { name: object.object.name, typeName: names.typeNames[object.object.type] ?? 'Deep-Sky Object', magnitude: object.object.magnitude }
		case 'movingBody':
			return { name: object.object.name ?? object.object.id, typeName: object.object.id === 'body:999' ? 'Dwarf Planet' : MOVING_BODY_TYPE_NAMES[object.object.type], magnitude: object.object.magnitude }
		case 'constellationLabel':
			return { name: object.label.name, typeName: 'Constellation' }
		default:
			return undefined
	}
}
