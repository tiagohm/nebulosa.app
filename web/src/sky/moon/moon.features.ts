import type { LunarFeatureCategory, MoonFeatureCatalog } from 'api'
import type { Mat3 } from 'nebulosa/src/math/linear-algebra/mat3'
import type { Vec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { type DiscViewport, discToScreen, projectPoint, surfaceVector } from './moon.geometry'

// Lunar surface features of the Lunar Surface Explorer: the catalog rows made into features, the markers and labels
// drawn at a zoom (only features large enough to tell apart on screen, the larger first, labels never overlapping),
// and the search by name. Pure functions over CSS pixels, y down; the markers use the projection of moon.geometry.ts,
// so they stay on the drawing at every zoom, pan, orientation, and instant.

// Version of the catalog layout this client reads (MOON_FEATURE_CATALOG_SCHEMA of the API).
export const SUPPORTED_CATALOG_SCHEMA = 1

// Mean radius of the Moon in km, the sphere of the catalog's coordinates.
const MOON_RADIUS_KM = 1737.4

// Smallest apparent size in CSS pixels of a feature drawn as a marker (about 140 km on a 650-pixel disk);
// satellite craters need SATELLITE_MIN_PX.
const MIN_MARKER_PX = 16

// Smallest apparent size in CSS pixels of a satellite crater drawn as a marker.
const SATELLITE_MIN_PX = 20

// Most markers drawn at once, so the overlay stays a few hundred elements whatever the zoom.
export const MAX_MARKERS = 300

// Most labels drawn at once.
const MAX_LABELS = 80

// Weight of each category in the drawing priority: maria and mountains are named before craters of the same size.
const CATEGORY_WEIGHTS: Readonly<Record<LunarFeatureCategory, number>> = { mare: 3, mons: 1.5, rima: 1.2, crater: 1, other: 0.8 }

// Approximate width in CSS pixels of one character of a label at the overlay's font size.
const LABEL_CHAR_PX = 6.2

// Height in CSS pixels of a label box.
const LABEL_HEIGHT_PX = 14

// Gap in CSS pixels between a marker and its label.
const LABEL_GAP_PX = 6

// A named feature of the Moon.
export interface LunarFeature {
	// Gazetteer feature id.
	readonly id: number
	// Official name with its diacritics.
	readonly name: string
	// Name without diacritics, in lower case, for the search.
	readonly key: string
	// Official descriptor ("Crater, craters").
	readonly descriptor: string
	// Category of the filters.
	readonly category: LunarFeatureCategory
	// Whether it is a satellite crater ("Copernicus A").
	readonly satellite: boolean
	// Whether its dimension is a longest extent rather than a diameter.
	readonly elongated: boolean
	// Planetocentric latitude in degrees, north positive.
	readonly latitude: number
	// East longitude in degrees, in [-180, 180).
	readonly longitude: number
	// Approximate diameter or longest extent in km; absent when unknown.
	readonly dimension?: number
	// Year of IAU approval; absent when unknown.
	readonly approvalYear?: number
	// Origin of the name; absent when none is given.
	readonly origin?: string
	// Body-fixed unit vector of the center point.
	readonly vector: Vec3
}

// A feature drawn on the overlay.
export interface FeatureMarker {
	// Feature.
	readonly feature: LunarFeature
	// Horizontal position in CSS pixels.
	readonly x: number
	// Vertical position in CSS pixels, from the top.
	readonly y: number
	// Whether the point is on the night side.
	readonly dark: boolean
	// Whether its label is drawn.
	readonly labeled: boolean
	// Whether the label is drawn on the left of the marker, because it would not fit on the right.
	readonly labelLeft: boolean
}

// A search result.
export interface FeatureMatch {
	// Feature.
	readonly feature: LunarFeature
	// Whether its center point is on the visible hemisphere now.
	readonly visible: boolean
}

// Returns a name without diacritics, in lower case.
export function searchKey(name: string) {
	return name.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase()
}

// Returns the features of a catalog file; throws for a layout this client does not read.
export function catalogFeatures(catalog: MoonFeatureCatalog): LunarFeature[] {
	if (catalog.schema !== SUPPORTED_CATALOG_SCHEMA) throw new Error(`Unsupported feature catalog version ${catalog.schema}`)

	return catalog.features.map(([id, name, descriptor, category, flags, latitude, longitude, dimension, approvalYear, origin]) => ({
		id,
		name,
		key: searchKey(name),
		descriptor,
		category,
		satellite: (flags & 1) !== 0,
		elongated: (flags & 2) !== 0,
		latitude,
		longitude,
		dimension: dimension ?? undefined,
		approvalYear: approvalYear ?? undefined,
		origin: origin ?? undefined,
		vector: surfaceVector(latitude, longitude),
	}))
}

// Returns the apparent size in CSS pixels of a feature's dimension on a viewport (not foreshortened).
function apparentSize(feature: LunarFeature, viewport: DiscViewport) {
	return ((feature.dimension ?? 0) / MOON_RADIUS_KM) * viewport.radius
}

// Whether a box in CSS pixels overlaps any of the boxes taken.
function overlaps(boxes: readonly (readonly [number, number, number, number])[], [x0, y0, x1, y1]: readonly [number, number, number, number]) {
	return boxes.some(([a0, b0, a1, b1]) => x0 < a1 && a0 < x1 && y0 < b1 && b0 < y1)
}

// Returns the markers to draw for a view: features of the categories shown on the visible hemisphere and inside the
// viewport, large enough on screen, by priority (apparent size times the category weight), at most MAX_MARKERS; the
// selected feature is always drawn when visible. Labels are given, by priority, to markers whose label box overlaps
// no label and no marker of a higher priority, at most MAX_LABELS, so the larger features keep their names over the
// dots of smaller ones, on the left of a marker when the right has no room; the selected feature's label is always drawn.
export function featureMarkers(features: readonly LunarFeature[], view: Mat3, sun: Vec3, viewport: DiscViewport, categories: ReadonlySet<LunarFeatureCategory>, selectedId?: number, labels = true): FeatureMarker[] {
	const candidates: { readonly feature: LunarFeature; readonly x: number; readonly y: number; readonly dark: boolean; readonly priority: number }[] = []

	for (const feature of features) {
		const selected = feature.id === selectedId
		if (!selected && !categories.has(feature.category)) continue

		const size = apparentSize(feature, viewport)
		if (!selected && size < (feature.satellite ? SATELLITE_MIN_PX : MIN_MARKER_PX)) continue

		const point = projectPoint(view, feature.vector)
		if (point.z <= 0) continue

		const [x, y] = discToScreen(viewport, point)
		if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) continue

		const dark = feature.vector[0] * sun[0] + feature.vector[1] * sun[1] + feature.vector[2] * sun[2] < 0
		candidates.push({ feature, x, y, dark, priority: selected ? Number.POSITIVE_INFINITY : size * CATEGORY_WEIGHTS[feature.category] })
	}

	candidates.sort((a, b) => b.priority - a.priority)
	const taken: (readonly [number, number, number, number])[] = []
	let count = 0

	return candidates.slice(0, MAX_MARKERS).map(({ feature, x, y, dark }) => {
		const width = feature.name.length * LABEL_CHAR_PX
		const labelLeft = x + LABEL_GAP_PX + width > viewport.width
		const left = labelLeft ? x - LABEL_GAP_PX - width : x + LABEL_GAP_PX
		const box = [left, y - LABEL_HEIGHT_PX / 2, left + width, y + LABEL_HEIGHT_PX / 2] as const
		const selected = feature.id === selectedId
		const labeled = selected || (labels && count < MAX_LABELS && !overlaps(taken, box))
		taken.push([x - 3, y - 3, x + 3, y + 3])

		if (labeled) {
			taken.push(box)
			count++
		}

		return { feature, x, y, dark, labeled, labelLeft }
	})
}

// Returns at most `limit` features whose name contains the query, ignoring case and diacritics: names starting with
// it first, then those on the visible hemisphere, then the larger ones.
export function searchFeatures(features: readonly LunarFeature[], query: string, view: Mat3, limit = 20): FeatureMatch[] {
	const key = searchKey(query.trim())
	if (!key) return []

	const matches: (FeatureMatch & { readonly prefix: boolean })[] = []

	for (const feature of features) {
		const index = feature.key.indexOf(key)
		if (index < 0) continue
		matches.push({ feature, visible: projectPoint(view, feature.vector).z > 0, prefix: index === 0 })
	}

	matches.sort((a, b) => Number(b.prefix) - Number(a.prefix) || Number(b.visible) - Number(a.visible) || (b.feature.dimension ?? 0) - (a.feature.dimension ?? 0) || a.feature.name.localeCompare(b.feature.name))
	return matches.slice(0, limit).map(({ feature, visible }) => ({ feature, visible }))
}
