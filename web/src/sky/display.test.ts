import { expect, test } from 'bun:test'
import { applySkyDisplay, type SkyDisplayTarget } from './display'

// Map that records the calls of the display preferences.
function fakeMap() {
	const layers: Record<string, boolean> = {}
	const lines: Record<string, boolean> = {}
	const state = { labels: undefined as boolean | undefined, magnitude: undefined as number | undefined }

	const target: SkyDisplayTarget = {
		setLayerVisible: (id, visible) => (layers[id] = visible),
		setReferenceLineVisible: (line, visible) => (lines[line] = visible),
		setStarLabelsVisible: (visible) => (state.labels = visible),
		setMagnitudeLimit: (limit) => (state.magnitude = limit),
	}

	return { target, layers, lines, state }
}

test('defaults keep the map as it was', () => {
	const { target, layers, lines, state } = fakeMap()
	applySkyDisplay(target, undefined, true, 7)

	expect(layers).toEqual({ stars: true, deepSky: true, movingBodies: true, constellations: true, constellationBoundaries: false, constellationLabels: true, grid: true })
	expect(lines).toEqual({ celestialEquator: true, ecliptic: true, localMeridian: true })
	expect(state).toEqual({ labels: true, magnitude: 7 })
})

test('preferences are applied, and the local meridian only on the local sky', () => {
	const { target, layers, lines, state } = fakeMap()
	applySkyDisplay(target, { layers: { deepSky: false, starLabels: false, ecliptic: false, constellationBoundaries: true }, magnitudeLimit: 4.5 }, false, 7)

	expect(layers.deepSky).toBe(false)
	expect(layers.constellationBoundaries).toBe(true)
	expect(lines).toEqual({ celestialEquator: true, ecliptic: false, localMeridian: false })
	expect(state).toEqual({ labels: false, magnitude: 4.5 })
})
