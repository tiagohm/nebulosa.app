import type { PartialThemeOptions, ReferenceLinesOptions } from './celestial/types'

// Colours and font of the star map, read once from the design tokens of `web/src/index.css`, so the canvas draws in the
// same language as the rest of the console: ink and line neutrals for stars, labels, and lines, the low-chroma
// `map-*` hues to tell the kinds of objects and reference lines apart, Ember (`accent`) for the selection alone, and the
// success colour for the connected mount's marker. Outside a document (tests) every token reads a neutral gray.

// Colours and font of the star map, as CSS values.
export interface SkyMapPalette {
	// Font family of every label of the map.
	readonly font: string
	// Primary ink: the hover highlight and the field of view of the framing.
	readonly ink100: string
	// Secondary ink: satellites, the names of moving bodies, and the footprint and mark sent from an image.
	readonly ink200: string
	// Muted ink: star and constellation names and remembered catalog objects.
	readonly ink300: string
	// Graticule line: the grid and the constellation lines and boundaries.
	readonly line: string
	// Ember accent: the selection reticle.
	readonly accent: string
	// Marker of the connected mount.
	readonly mount: string
	// Local horizon.
	readonly horizon: string
	// Celestial equator.
	readonly equator: string
	// Ecliptic.
	readonly ecliptic: string
	// Local meridian.
	readonly meridian: string
	// Deep-sky symbols and names.
	readonly deepSky: string
	// Planets, the Sun, and the Moon.
	readonly planet: string
	// Asteroids.
	readonly asteroid: string
	// Comets.
	readonly comet: string
	// Meteor shower radiants.
	readonly radiant: string
}

// Value a token reads when no document defines it.
const FALLBACK = '#9c9a92'

// Font family used when no document defines one.
const FALLBACK_FONT = 'ui-monospace, monospace'

// Palette read on first use; the tokens never change while the page runs (the interface is dark only).
let palette: SkyMapPalette | undefined

// Returns the palette of the star map, reading the tokens of the document on first use.
export function skyMapPalette(): SkyMapPalette {
	if (palette) return palette

	const style = typeof document === 'undefined' ? undefined : getComputedStyle(document.documentElement)
	const token = (name: string, fallback = FALLBACK) => style?.getPropertyValue(name).trim() || fallback

	palette = {
		font: token('--font-mono', FALLBACK_FONT),
		ink100: token('--color-ink-100'),
		ink200: token('--color-ink-200'),
		ink300: token('--color-ink-300'),
		line: token('--color-line-200'),
		accent: token('--color-accent'),
		mount: token('--color-success'),
		horizon: token('--color-map-horizon'),
		equator: token('--color-map-equator'),
		ecliptic: token('--color-map-ecliptic'),
		meridian: token('--color-map-meridian'),
		deepSky: token('--color-map-deep-sky'),
		planet: token('--color-map-planet'),
		asteroid: token('--color-map-asteroid'),
		comet: token('--color-map-comet'),
		radiant: token('--color-map-radiant'),
	}

	return palette
}

// Returns the CSS font of a map label of `size` pixels.
export function skyMapFont(size: number) {
	return `${size}px ${skyMapPalette().font}`
}

// Theme of the star map in the palette. Lines stay faint behind the stars; names are muted so the selection and the
// bright objects lead.
export function skyMapTheme(): PartialThemeOptions {
	const p = skyMapPalette()

	return {
		fontFamily: p.font,
		stars: { labelColor: p.ink300, labelFont: skyMapFont(10) },
		grid: { color: p.line, opacity: 0.35 },
		horizon: { color: p.horizon },
		milkyWay: { lineColor: p.line, levelColors: [p.line, p.line, p.line, p.line, p.line] },
		constellations: { color: p.line, opacity: 0.6, labelColor: p.ink300, labelFont: skyMapFont(10), labelOpacity: 0.75, lineColor: p.line, lineOpacity: 0.55, boundaryColor: p.line, boundaryOpacity: 0.35 },
		deepSky: { color: p.deepSky, labelColor: p.deepSky },
		movingBodies: { planetColor: p.planet, asteroidColor: p.asteroid, cometColor: p.comet, satelliteColor: p.ink200, labelColor: p.ink200 },
		selectedObject: { color: p.accent },
		hoverHighlight: { color: p.ink100 },
	}
}

// Opacity of the reference lines, 0 to 1: present but behind the stars.
const REFERENCE_LINE_OPACITY = 0.75

// Returns a `#rrggbb` colour at an opacity from 0 to 1 as `rgb(r g b / a)`; any other colour is returned unchanged.
export function withAlpha(color: string, alpha: number) {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
	if (!match) return color
	const [r, g, b] = match.slice(1).map((hex) => Number.parseInt(hex, 16))
	return `rgb(${r} ${g} ${b} / ${alpha})`
}

// Styles of the reference lines in the palette, translucent so they sit behind the stars.
export function skyMapReferenceLines(): ReferenceLinesOptions {
	const p = skyMapPalette()

	return {
		localMeridian: { color: withAlpha(p.meridian, REFERENCE_LINE_OPACITY), lineWidth: 0.85 },
		celestialEquator: { color: withAlpha(p.equator, REFERENCE_LINE_OPACITY), lineWidth: 0.85 },
		ecliptic: { color: withAlpha(p.ecliptic, REFERENCE_LINE_OPACITY), lineWidth: 0.85 },
	}
}
