// Appearance of the astrometric aids of a solved image (coordinates, grid, crosshair, scale bar, orientation), kept
// per profile. They only change how the aids are drawn: whether a document shows its grid, and its measurements, belong
// to the document. Nothing here solves or changes a solution.

// How sky coordinates are written: hours, minutes, and seconds of right ascension with signed degrees, minutes, and
// seconds of declination, or both in decimal degrees.
export type CoordinateFormat = 'sexagesimal' | 'decimal'

// Color of the grid: one theme color for both axes, or a color per axis, reddish meridians (right ascension) and
// bluish parallels (declination).
export type GridColor = 'neutral' | 'accent' | 'success' | 'axes'

// Colors of the lines and labels of each axis of the grid, CSS colors.
export interface GridAxisColors {
	// Meridians, lines of constant right ascension.
	readonly rightAscension: string
	// Parallels, lines of constant declination.
	readonly declination: string
}

// Where the north and east arrows are drawn: nowhere, in a corner of the visible image, or at the solved centre.
export type OrientationMode = 'hidden' | 'corner' | 'center'

// Formats of the coordinates, in display order.
export const COORDINATE_FORMATS: readonly CoordinateFormat[] = ['sexagesimal', 'decimal']

// Grid colors, in display order.
export const GRID_COLORS: readonly GridColor[] = ['neutral', 'accent', 'success', 'axes']

// Orientation modes, in display order.
export const ORIENTATION_MODES: readonly OrientationMode[] = ['hidden', 'corner', 'center']

// Range of the decimals of coordinates: of the seconds in sexagesimal (0 to 3), of the degrees in decimal, which get
// four more.
export const COORDINATE_PRECISION_RANGE = [0, 3] as const

// Range of the opacity of the major grid lines; minor lines are drawn at half of it.
export const GRID_OPACITY_RANGE = [0.15, 1] as const

// Appearance of the grid.
export interface AstrometryGridSettings {
	// Whether the major lines are labelled.
	readonly labels: boolean
	// Whether minor lines are drawn between the major ones, when they are far enough apart.
	readonly minor: boolean
	// Opacity of the major lines, within GRID_OPACITY_RANGE.
	readonly opacity: number
	// Color of the lines and labels.
	readonly color: GridColor
}

// Appearance of the astrometric aids of the solved images of a profile.
export interface ImageAstrometrySettings {
	// How coordinates are written: format, and decimals within COORDINATE_PRECISION_RANGE.
	readonly coordinates: { readonly format: CoordinateFormat; readonly precision: number }
	// Appearance of the grid.
	readonly grid: AstrometryGridSettings
	// Whether a crosshair follows the pointer over a solved image.
	readonly crosshair: boolean
	// Whether the angular scale bar is drawn.
	readonly scaleBar: boolean
	// Where the north and east arrows are drawn.
	readonly orientation: OrientationMode
}

// Appearance of a profile that never changed it.
export const DEFAULT_IMAGE_ASTROMETRY: ImageAstrometrySettings = {
	coordinates: { format: 'sexagesimal', precision: 1 },
	grid: { labels: true, minor: true, opacity: 0.45, color: 'neutral' },
	crosshair: false,
	scaleBar: true,
	orientation: 'corner',
}

// Colors of the axes of each grid color; the axes one is a soft red and a soft blue, both readable over a dark sky.
export const GRID_COLOR_VALUES: Readonly<Record<GridColor, GridAxisColors>> = {
	neutral: { rightAscension: 'var(--color-ink-200)', declination: 'var(--color-ink-200)' },
	accent: { rightAscension: 'var(--color-accent)', declination: 'var(--color-accent)' },
	success: { rightAscension: 'var(--color-success)', declination: 'var(--color-success)' },
	axes: { rightAscension: '#f07a6e', declination: '#6aa8f0' },
}
