import { expect, test } from 'bun:test'
import type { GeographicLocation } from '../../location/site'
import { findNextSatellitePass, inspectSatellite, type SkySatelliteState } from './satellite'

const OBSERVER = { latitude: -0.4, longitude: -0.8, elevation: 800 } satisfies GeographicLocation

function pass(start: number, startsBeforeWindow: boolean) {
	const point = { time: start, altitude: 0, azimuth: 0 }
	return { start: point, culmination: point, end: point, startsBeforeWindow, endsAfterWindow: false, visible: [] }
}

function state(): SkySatelliteState {
	return { nextPassLoading: false, tracking: false, trail: false }
}

test('details are read once per satellite, and again after a failure', async () => {
	const urls: string[] = []
	let ok = false
	const fetch = (input: string) => {
		urls.push(input)
		return Promise.resolve(ok ? Response.json({ object: { noradId: '25544', name: 'ISS (ZARYA)' } }) : Response.json({ error: 'Not found', code: 'notFound' }, { status: 404 }))
	}
	const inspector = state()
	inspector.tracking = true

	await inspectSatellite(inspector, '25544', fetch)
	expect(inspector.detailsError).toBeDefined()
	expect(inspector.tracking).toBeFalse()

	ok = true
	await inspectSatellite(inspector, '25544', fetch)
	expect(inspector.details?.object.name).toBe('ISS (ZARYA)')
	expect(inspector.detailsError).toBeUndefined()

	await inspectSatellite(inspector, '25544', fetch)
	expect(urls).toEqual(['/api/satellites/25544', '/api/satellites/25544'])
})

test('the next pass is the first that rises inside the window, or none', async () => {
	const bodies: unknown[] = []
	let passes = [pass(1000, true), pass(5000, false), pass(9000, false)]
	const fetch = (_: string, init?: RequestInit) => {
		bodies.push(JSON.parse(init?.body as string))
		return Promise.resolve(Response.json({ passes }))
	}
	const inspector = state()
	inspector.noradId = '25544'

	await findNextSatellitePass(inspector, OBSERVER, 0, fetch)
	expect(inspector.nextPass?.start.time).toBe(5000)
	expect(inspector.nextPassLoading).toBeFalse()
	expect(bodies[0]).toMatchObject({ start: 0, end: 2 * 86_400_000, minAltitude: 0 })

	passes = [pass(1000, true)]
	await findNextSatellitePass(inspector, OBSERVER, 0, fetch)
	expect(inspector.nextPass).toBeNull()
})
