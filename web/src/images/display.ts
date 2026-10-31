import type { DisplayDebayer, DisplayScnr, DisplaySettings, DisplayStretch } from 'api'

// Choices and limits of the display settings of an image document, shared by the display controls of the viewer
// toolbar and by the reading of the settings a profile saved, so both accept exactly the same values.

// CFA pattern a mosaic can be debayered with explicitly.
export type CfaPatternChoice = Exclude<Extract<DisplayDebayer, { enabled: true }>['pattern'], 'auto'>

// SCNR settings of an enabled color cast removal.
export type EnabledScnr = Extract<DisplayScnr, { enabled: true }>

// Named profile of an auto stretch.
export type AutoStretchPreset = Extract<DisplayStretch, { mode: 'auto' }>['preset']

// Group of display settings a popup of the viewer toolbar edits and applies together.
export type DisplaySection = 'stretch' | 'tone' | 'color'

// Inclusive range of a numeric display setting.
export interface DisplayRange {
	// Smallest value.
	readonly min: number
	// Largest value.
	readonly max: number
	// Increment of its control, positive.
	readonly step: number
}

// Every known CFA pattern, in selector order.
export const CFA_PATTERNS = ['RGGB', 'BGGR', 'GBRG', 'GRBG', 'GRGB', 'GBGR', 'RGBG', 'BGRG'] as const satisfies readonly CfaPatternChoice[]

// Stretch modes, in selector order.
export const STRETCH_MODES = ['auto', 'manual', 'linear'] as const satisfies readonly DisplayStretch['mode'][]

// Auto stretch profiles, in selector order.
export const AUTO_STRETCH_PRESETS = ['low', 'medium', 'high', 'moon', 'planet'] as const satisfies readonly AutoStretchPreset[]

// Auto stretch profile of an image with no saved choice: the toolkit's default adaptive display function.
export const DEFAULT_AUTO_STRETCH_PRESET: AutoStretchPreset = 'medium'

// SCNR channels, in selector order.
export const SCNR_CHANNELS = ['GREEN', 'RED', 'BLUE'] as const satisfies readonly EnabledScnr['channel'][]

// SCNR protection methods, in selector order.
export const SCNR_METHODS = ['AVERAGE_NEUTRAL', 'MAXIMUM_NEUTRAL', 'MINIMUM_NEUTRAL', 'MAXIMUM_MASK', 'ADDITIVE_MASK'] as const satisfies readonly EnabledScnr['method'][]

// Ranges of the numeric display settings: brightness, contrast, and saturation factors (1 neutral), gamma (1
// neutral), the SCNR amount, and the levels of a manual stretch, all dimensionless.
export const DISPLAY_RANGES = {
	brightness: { min: 0, max: 3, step: 0.01 },
	contrast: { min: 0, max: 3, step: 0.01 },
	gamma: { min: 0.1, max: 5, step: 0.01 },
	saturation: { min: 0, max: 3, step: 0.01 },
	scnrAmount: { min: 0, max: 1, step: 0.01 },
	stretch: { min: 0, max: 1, step: 0.0001 },
} as const satisfies Readonly<Record<string, DisplayRange>>

// Settings of the unprocessed image: no debayering, a linked auto stretch with the default profile, and neutral
// adjustments. Shown by Show Original, and the values Reset Parameters restores in a popup.
export const ORIGINAL_DISPLAY_SETTINGS: DisplaySettings = { debayer: { enabled: false }, stretch: { mode: 'auto', preset: DEFAULT_AUTO_STRETCH_PRESET, linked: true }, brightness: 1, contrast: 1, gamma: 1, saturation: 1, scnr: { enabled: false }, invert: false }

// Settings each popup section edits and applies.
export const DISPLAY_SECTION_FIELDS = {
	stretch: ['stretch'],
	tone: ['brightness', 'contrast', 'gamma'],
	color: ['saturation', 'scnr'],
} as const satisfies Readonly<Record<DisplaySection, readonly (keyof DisplaySettings)[]>>

// Returns the settings of a section taken from settings, as a patch that applies only them.
export function sectionPatch(settings: DisplaySettings, section: DisplaySection): Partial<DisplaySettings> {
	return Object.fromEntries(DISPLAY_SECTION_FIELDS[section].map((field) => [field, settings[field]]))
}
