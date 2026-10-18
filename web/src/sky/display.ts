import type { ResolvedReferenceLinesOptions } from './celestial/celestial'

// What the star map shows: the layers the map really has that a user may turn on and off, and the
// faintest stars drawn. Preferences are kept in the profile and applied to the map in place, so changing
// them never recreates the map, reloads its data, or moves its view. Every moving body (Sun, Moon,
// planets, asteroids, and comets) shares one layer of the map, so they are shown or hidden together.

// Layer of the star map a user can show or hide.
export type SkyLayerId = 'stars' | 'starLabels' | 'deepSky' | 'movingBodies' | 'constellations' | 'constellationBoundaries' | 'constellationLabels' | 'grid' | 'celestialEquator' | 'ecliptic' | 'localMeridian'

// Display preferences of the star map.
export interface SkyDisplaySettings {
	// Visibility chosen for each layer; an absent layer has its default.
	layers: Partial<Record<SkyLayerId, boolean>>
	// Faintest star magnitude drawn, [MIN_MAGNITUDE_LIMIT, MAP_STAR_MAGNITUDE_LIMIT]; absent draws every
	// star downloaded.
	magnitudeLimit?: number
}

// Definition of a layer.
export interface SkyLayerDefinition {
	// Layer identifier.
	readonly id: SkyLayerId
	// Display name.
	readonly label: string
	// Visibility before the user changes it.
	readonly visible: boolean
	// Whether the layer exists only on the observer's local sky.
	readonly localOnly?: boolean
}

// Map operations the preferences are applied through; the Celestial map implements them.
export interface SkyDisplayTarget {
	// Shows or hides a map layer by id.
	readonly setLayerVisible: (layerId: string, visible: boolean) => void
	// Shows or hides one reference line.
	readonly setReferenceLineVisible: (line: keyof ResolvedReferenceLinesOptions, visible: boolean) => void
	// Shows or hides star names.
	readonly setStarLabelsVisible: (visible: boolean) => void
	// Sets the faintest star magnitude drawn.
	readonly setMagnitudeLimit: (limit: number) => void
}

// Layers in display order, with their defaults (the map's look before preferences existed).
export const SKY_LAYERS: readonly SkyLayerDefinition[] = [
	{ id: 'stars', label: 'Stars', visible: true },
	{ id: 'starLabels', label: 'Star names', visible: true },
	{ id: 'deepSky', label: 'Deep-sky objects', visible: true },
	{ id: 'movingBodies', label: 'Solar system, asteroids & comets', visible: true },
	{ id: 'constellations', label: 'Constellation lines', visible: true },
	{ id: 'constellationBoundaries', label: 'Constellation boundaries', visible: false },
	{ id: 'constellationLabels', label: 'Constellation names', visible: true },
	{ id: 'grid', label: 'Equatorial grid', visible: true },
	{ id: 'celestialEquator', label: 'Celestial equator', visible: true },
	{ id: 'ecliptic', label: 'Ecliptic', visible: true },
	{ id: 'localMeridian', label: 'Local meridian', visible: true, localOnly: true },
]

// Ids of the layers, for validating stored preferences.
export const SKY_LAYER_IDS: ReadonlySet<string> = new Set(SKY_LAYERS.map((layer) => layer.id))

// Faintest star magnitude downloaded for the map, and so the faintest that can be drawn; fainter stars
// are still found by search.
export const MAP_STAR_MAGNITUDE_LIMIT = 7

// Brightest choice of the faintest star magnitude drawn.
export const MIN_MAGNITUDE_LIMIT = 1

// Whether a layer is shown under the preferences.
export function isSkyLayerVisible(display: Readonly<SkyDisplaySettings> | undefined, layer: SkyLayerDefinition) {
	return display?.layers[layer.id] ?? layer.visible
}

// Applies display preferences to a map of the observer's local sky or of the whole sky, starting from
// a faintest magnitude of `maxMagnitude` when none is chosen.
export function applySkyDisplay(target: SkyDisplayTarget, display: Readonly<SkyDisplaySettings> | undefined, local: boolean, maxMagnitude: number) {
	for (const layer of SKY_LAYERS) {
		const visible = isSkyLayerVisible(display, layer) && (local || !layer.localOnly)

		switch (layer.id) {
			case 'starLabels':
				target.setStarLabelsVisible(visible)
				break
			case 'celestialEquator':
			case 'ecliptic':
			case 'localMeridian':
				target.setReferenceLineVisible(layer.id, visible)
				break
			default:
				target.setLayerVisible(layer.id, visible)
		}
	}

	target.setMagnitudeLimit(display?.magnitudeLimit ?? maxMagnitude)
}
