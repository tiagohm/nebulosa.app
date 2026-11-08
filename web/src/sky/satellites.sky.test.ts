import { expect, test } from 'bun:test'
import type { Celestial } from './celestial/celestial'
import { SatelliteLayer } from './satellites.sky'

// A drawing surface that ignores what the layer draws.
const celestial = { addMovingBody: () => undefined, removeMovingBody: () => undefined, markMovingBodyDirty: () => undefined, addShape: () => undefined, removeShape: () => undefined } as unknown as Celestial

test('a failed request of the samples is not asked again at every update', async () => {
	const requests: string[] = []
	const layer = new SatelliteLayer(celestial, { time: () => Date.UTC(2026, 10, 8), rate: () => 1, centerOn: () => undefined }, (input) => {
		requests.push(input)
		return Promise.resolve(Response.json({ error: 'Unavailable', code: 'serviceUnavailable' }, { status: 503 }))
	})

	layer.set({ ids: ['25544'], revision: 1, tracking: false, trail: false })
	await Bun.sleep(0)
	expect(requests).toHaveLength(1)

	for (let i = 0; i < 5; i++) {
		layer.update()
		await Bun.sleep(0)
	}

	expect(requests).toHaveLength(1)
	layer.destroy()
})
