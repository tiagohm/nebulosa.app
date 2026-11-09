import { expect, test } from 'bun:test'
import type { Celestial, CelestialShape } from './celestial/celestial'
import { MeteorRadiantLayer, outdated, pathOutdated, REFRESH_SPAN_MS } from './meteors.sky'

const NOW = Date.UTC(2026, 11, 14, 3)

// A map recording the shapes the layer adds and removes.
function fakeCelestial() {
	const shapes = new Map<string, CelestialShape>()
	const celestial = { addShape: (shape: CelestialShape) => shapes.set(shape.id, shape), removeShape: (id: string) => shapes.delete(id) } as unknown as Celestial
	return { celestial, shapes }
}

test('radiants are asked for again only when the instant moves more than an hour', () => {
	expect(outdated(undefined, NOW)).toBe(true)
	expect(outdated(NOW, NOW + REFRESH_SPAN_MS)).toBe(false)
	expect(outdated(NOW, NOW - REFRESH_SPAN_MS - 1)).toBe(true)
})

test('the layer draws the active radiants in the map frame, keeps the selected one with the layer hidden, and asks nothing per update', async () => {
	const { celestial, shapes } = fakeCelestial()
	const requests: string[] = []
	const fetch = (url: string) => {
		requests.push(url)
		const body = url.endsWith('/radiants')
			? { time: NOW, radiants: [{ id: 'iau:4', code: 'GEM', name: 'Geminids', rightAscension: 2, declination: 0.56, visual: true }] }
			: url.endsWith('/path')
				? { support: { basis: 'imoVisual' }, start: NOW - 86400000, end: NOW + 86400000, segments: [[{ time: NOW, rightAscension: 0.8, declination: 1 }]] }
				: { showers: [{ id: 'iau:7', radiantJ2000: { rightAscension: 0.8, declination: 1 } }] }
		return Promise.resolve(new Response(JSON.stringify(body)))
	}
	const layer = new MeteorRadiantLayer(celestial, { time: () => NOW, toMapFrame: (rightAscension, declination) => ({ rightAscension: rightAscension + 0.01, declination }) }, fetch)

	layer.set({ visible: true, revision: 0 })
	await Bun.sleep(0)
	expect(requests).toEqual(['/api/meteor-showers/radiants'])
	expect([...shapes.keys()]).toEqual(['meteor-radiant:iau:4'])
	expect(shapes.get('meteor-radiant:iau:4')!.coordinate.rightAscension).toBeCloseTo(2.01, 12)

	layer.update(NOW + 60_000)
	expect(requests).toHaveLength(1)

	layer.set({ visible: false, revision: 0, selected: 'iau:7', selectedName: 'Perseids' })
	await Bun.sleep(0)
	expect(requests.slice(1).sort()).toEqual(['/api/meteor-showers/iau%3A7/path', '/api/meteor-showers/states'])
	expect([...shapes.keys()].sort()).toEqual(['meteor-radiant-path', 'meteor-radiant:iau:7'])

	// The path is not asked for again while the instant stays within a month of its occurrence.
	layer.update(NOW + 10 * 86400000)
	expect(requests.filter((url) => url.endsWith('/path'))).toHaveLength(1)
	expect(pathOutdated({ support: { basis: 'none' }, start: NOW, end: NOW, segments: [] }, NOW, NOW + 31 * 86400000)).toBe(true)

	layer.destroy()
	expect(shapes.size).toBe(0)
})
