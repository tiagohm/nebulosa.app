import { expect, test } from 'bun:test'
import type { LunarFeatureCategory, LunarFeatureRow, MoonFeatureCatalog } from 'api'
import type { Mat3 } from 'nebulosa/src/math/linear-algebra/mat3'
import { proxy } from 'valtio'
import { initialMoonState, loadMoonFeatures, type MoonState } from './moon'
import { catalogFeatures, featureMarkers, MAX_MARKERS, searchFeatures, searchKey } from './moon.features'
import { discViewport, projectPoint, surfaceVector } from './moon.geometry'

// North-up view of a Moon whose sub-observer point is (0°, 0°): lunar east to the right, north up.
const FACE_ON: Mat3 = [0, 1, 0, 0, 0, 1, 1, 0, 0]
const SUN_EAST = surfaceVector(0, 90)
const ALL = new Set<LunarFeatureCategory>(['crater', 'mare', 'mons', 'rima', 'other'])

const ROWS: LunarFeatureRow[] = [
	[1296, 'Copernicus', 'Crater, craters', 'crater', 0, 9.6209, -20.0786, 96.07, 1935, 'Nicholas; Polish astronomer (1473-1543).'],
	[8421, 'Copernicus A', 'Satellite Feature', 'crater', 1, 9.5224, -18.9003, 3.22, 2006, 'Nicholas; Polish astronomer (1473-1543).'],
	[6163, 'Tycho', 'Crater, craters', 'crater', 0, -43.2958, -11.2153, 85.29, 1935, null],
	[3671, 'Mare Crisium', 'Mare, maria', 'mare', 2, 16.1774, 59.1037, 555.92, 1935, '"Sea of Crises."'],
	[233, 'Ångström', 'Crater, craters', 'crater', 0, 29.88, -41.88, 9.5, 1935, null],
	[9000, 'Far Away', 'Crater, craters', 'crater', 0, 0, 179, 300, null, null],
]

const FEATURES = catalogFeatures({ schema: 1, generatedAt: '2026-10-28T00:00:00Z', features: ROWS })

test('catalog rows become features with their flags and vectors', () => {
	const [copernicus, satellite, , crisium] = FEATURES
	expect(copernicus).toMatchObject({ id: 1296, name: 'Copernicus', key: 'copernicus', category: 'crater', satellite: false, elongated: false, dimension: 96.07, approvalYear: 1935 })
	expect(satellite.satellite).toBe(true)
	expect(crisium.elongated).toBe(true)
	expect(FEATURES[2].origin).toBeUndefined()
	expect(FEATURES[5].approvalYear).toBeUndefined()
	expect(crisium.vector).toEqual(surfaceVector(16.1774, 59.1037))
	expect(() => catalogFeatures({ schema: 2, generatedAt: '', features: [] })).toThrow('Unsupported')
})

test('markers keep the visible features large enough on screen, by priority, and drop the far side', () => {
	const viewport = discViewport(800, 800)
	const markers = featureMarkers(FEATURES, FACE_ON, SUN_EAST, viewport, ALL)
	expect(markers.map((e) => e.feature.name)).toEqual(['Mare Crisium', 'Copernicus', 'Tycho'])

	// Mare Crisium, east of the center, is on the right and lit by a Sun in the east; Copernicus is on the night side.
	const crisium = markers[0]
	expect(crisium.x).toBeGreaterThan(viewport.centerX)
	expect(crisium.y).toBeLessThan(viewport.centerY)
	expect(crisium.dark).toBe(false)
	expect(markers[1].dark).toBe(true)

	// Zoomed in on Copernicus as far as the explorer goes, its 3 km satellite crater appears.
	const k = 32
	const { x, y } = projectPoint(FACE_ON, FEATURES[0].vector)
	const zoomed = featureMarkers(FEATURES, FACE_ON, SUN_EAST, discViewport(800, 800, { x: -x * viewport.radius * k, y: y * viewport.radius * k, k }), ALL)
	expect(zoomed.map((e) => e.feature.name)).toEqual(['Copernicus', 'Copernicus A'])
	expect(zoomed.every((e) => e.x >= 0 && e.x <= 800 && e.y >= 0 && e.y <= 800)).toBe(true)
})

test('a filter keeps its category, but the selected feature is always drawn and labeled', () => {
	const viewport = discViewport(400, 400)
	const maria = featureMarkers(FEATURES, FACE_ON, SUN_EAST, viewport, new Set(['mare']), 233)
	expect(maria.map((e) => [e.feature.name, e.labeled])).toEqual([
		['Ångström', true],
		['Mare Crisium', true],
	])
	expect(featureMarkers(FEATURES, FACE_ON, SUN_EAST, viewport, ALL, undefined, false).some((e) => e.labeled)).toBe(false)
})

test('markers are capped and their labels never overlap', () => {
	const crowd = catalogFeatures({ schema: 1, generatedAt: '', features: Array.from({ length: 2000 }, (_, i): LunarFeatureRow => [i + 1, `Crater ${i}`, 'Crater, craters', 'crater', 0, ((i % 40) - 20) * 2, Math.floor(i / 40) * 2 - 50, 100 + (i % 7), null, null]) })
	const markers = featureMarkers(crowd, FACE_ON, SUN_EAST, discViewport(800, 800), ALL)
	expect(markers.length).toBe(MAX_MARKERS)

	const boxes = markers
		.filter((e) => e.labeled)
		.map((e) => {
			const width = e.feature.name.length * 6.2
			const left = e.labelLeft ? e.x - 6 - width : e.x + 6
			return [left, e.y - 7, left + width, e.y + 7]
		})
	expect(boxes.every(([left, , right]) => left >= -1e-9 || right <= 800)).toBe(true)
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const [a, b] = [boxes[i], boxes[j]]
			expect(a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]).toBe(false)
		}
	}
})

test('search ignores case and diacritics, puts prefixes and visible features first, and says what is turned away', () => {
	expect(searchKey('Ångström')).toBe('angstrom')
	expect(searchFeatures(FEATURES, 'angs', FACE_ON).map((e) => e.feature.name)).toEqual(['Ångström'])
	expect(searchFeatures(FEATURES, 'COPER', FACE_ON).map((e) => e.feature.name)).toEqual(['Copernicus', 'Copernicus A'])
	expect(searchFeatures(FEATURES, 'a', FACE_ON).at(-1)).toMatchObject({ feature: { name: 'Far Away' }, visible: false })
	expect(searchFeatures(FEATURES, 'away', FACE_ON)).toEqual([{ feature: FEATURES[5], visible: false }])
	expect(searchFeatures(FEATURES, '  ', FACE_ON)).toEqual([])
})

test('the catalog loads once from its gzipped file, and a failure can be retried', async () => {
	const state = proxy<MoonState>(initialMoonState())
	const catalog: MoonFeatureCatalog = { schema: 1, generatedAt: '', features: ROWS }
	let calls = 0
	let fail = true
	const io = {
		fetch: () => {
			calls++
			return Promise.resolve(fail ? new Response('missing', { status: 404 }) : new Response(Bun.gzipSync(JSON.stringify(catalog))))
		},
	}

	await loadMoonFeatures(state, '/moon.features.json.gz', io)
	expect(state.features.error).toBe('The feature catalog could not be loaded (404)')

	fail = false
	await loadMoonFeatures(state, '/moon.features.json.gz', io)
	expect(state.features.value).toHaveLength(ROWS.length)
	expect(state.features.error).toBeUndefined()

	await loadMoonFeatures(state, '/moon.features.json.gz', io)
	expect(calls).toBe(2)
})
