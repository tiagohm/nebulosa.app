import type { StarProfileRequest } from 'api'

// Star Profile Inspector settings, kept per profile: what its measurements ask for and how they are drawn. Editing them
// never measures anything. The ranges are the only limits of these values, since the API takes them as they come.

// Settings of a measurement.
export type StarProfileMeasurementSettings = Pick<StarProfileRequest, 'model' | 'searchRadius' | 'maximumRadius' | 'minSNR'>

// Settings of the Star Profile Inspector.
export interface StarProfileSettings extends StarProfileMeasurementSettings {
	// Whether the preview draws its pixel grid.
	readonly grid: boolean
	// Whether the ellipse of the FWHM axes is drawn.
	readonly ellipse: boolean
	// Whether the half-flux circle is drawn.
	readonly halfFlux: boolean
	// Whether the plot draws the accepted Moffat fit.
	readonly modelCurves: boolean
}

// Profile models, in selector order.
export const STAR_PROFILE_MODELS: readonly StarProfileRequest['model'][] = ['moffat', 'moments']

// Defaults: the Moffat model, with a search close to the point and the aperture of the star detection of a profile. An
// SNR of 5 keeps the noise peaks of a bare sky out of the search.
export const DEFAULT_STAR_PROFILE_SETTINGS: StarProfileSettings = { model: 'moffat', searchRadius: 8, maximumRadius: 32, minSNR: 5, grid: true, ellipse: true, halfFlux: true, modelCurves: true }

// Range of the search radius, in pixels.
export const SEARCH_RADIUS_RANGE = [1, 16] as const

// Range of the largest aperture radius, in pixels: the fixed aperture of the toolkit's detector, up to what the cuts and
// the preview reach.
export const MAXIMUM_RADIUS_RANGE = [4, 32] as const

// Range of the minimum SNR.
export const MINIMUM_SNR_RANGE = [0, 100] as const

// Returns whether two sets of settings ask for the same measurement.
export function sameMeasurement(a: StarProfileMeasurementSettings, b: StarProfileMeasurementSettings): boolean {
	return a.model === b.model && a.searchRadius === b.searchRadius && a.maximumRadius === b.maximumRadius && a.minSNR === b.minSNR
}
