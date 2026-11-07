import { afterAll, expect, test } from 'bun:test'
import { AstroWeatherNights } from './astroweather.night'
import { SaturnPlannerService } from './saturn'
import { SpiceKernelRuntime } from './spicekernels.runtime'

// Integration test against the curated NAIF kernel sat441.bsp (SHA-256
// d7e444a9ba7a52b8f448ff0747030789524d2f0c1212e4e2bd7f5fc3c96444d5). The file is 631 MiB and never fetched by the
// tests: point SATURN_SPK_FIXTURE at a local copy to run it. References are JPL Horizons API 1.2 (sat441l, observer
// 500@399), retrieved 2026-11-07: quantity 6 plane-of-sky satellite offsets on 2026-11-01 00:00 UTC, and the zero of the
// planetodetic sub-observer latitude (quantity 14) at 5-minute steps, and the satellite visibility codes (quantity 12) at
// 1-minute steps.

const FIXTURE = process.env.SATURN_SPK_FIXTURE
const runtime = new SpiceKernelRuntime()

afterAll(() => {
	runtime[Symbol.dispose]()
})

// Arcseconds per radian.
const RAD_TO_ARCSEC = (180 / Math.PI) * 3600

// Horizons offsets (ΔRA·cos δ, Δδ) in arcseconds on 2026-11-01 00:00 UTC.
const OFFSETS: Readonly<Record<string, readonly [number, number]>> = {
	mimas: [-20.251, -0.459],
	enceladus: [34.861, -0.193],
	tethys: [42.155, -0.717],
	dione: [-52.706, 6.571],
	rhea: [-40.054, -5.879],
	titan: [-19.539, -21.114],
	iapetus: [405.002, 15.037],
}

test.skipIf(!FIXTURE)('the curated Saturnian kernel drives the rings and the moons alone like Horizons', async () => {
	expect((await runtime.rebuild([{ id: 'sat441', path: FIXTURE! }], 'spkOnly')).size).toBe(0)
	const service = new SaturnPlannerService({ kernels: runtime, night: (request) => new AstroWeatherNights().night(request) })

	const state = await service.moonsState({ time: Date.UTC(2026, 10, 1) })
	expect(state.signature.source).toMatchObject({ kind: 'spk', kernels: { saturn: ['sat441'], titan: ['sat441'], earth: ['sat441'], sun: ['sat441'] } })
	const unit = state.rings.equatorialRadius * RAD_TO_ARCSEC

	for (const moon of state.moons) {
		const [east, north] = OFFSETS[moon.moon]
		// The same SAT441 states; aberration, neglected here, stays below 0.01″ over these offsets.
		expect(Math.abs(moon.east * unit - east)).toBeLessThan(0.02)
		expect(Math.abs(moon.north * unit - north)).toBeLessThan(0.02)
	}

	const timeline = await service.ringTimeline({ start: Date.UTC(2025, 0, 1), end: Date.UTC(2025, 6, 1) })
	expect(timeline.signature.source.kind).toBe('spk')
	const crossing = timeline.events.find((e) => e.kind === 'earthPlaneCrossing')!
	// Horizons: 2025-03-23 17:46:48 UTC, interpolated within its 5-minute steps.
	expect(Math.abs(crossing.time - Date.UTC(2025, 2, 23, 17, 46, 48))).toBeLessThan(30_000)

	// Horizons quantity 12: Titan wholly umbral between 11:13 and 11:14 UTC on 2025-04-05, and Tethys transiting from
	// 12:56 to 15:56 UTC on 2025-04-02 (first minutes of each code).
	const titan = await service.events({ start: Date.UTC(2025, 3, 5), end: Date.UTC(2025, 3, 6), kinds: ['satelliteEclipse'], moons: ['titan'] })
	expect(titan.signature.source.kind).toBe('spk')
	expect(Math.abs(titan.events[0].contacts.internal1! - Date.UTC(2025, 3, 5, 11, 13, 30))).toBeLessThan(60_000)
	const tethys = await service.events({ start: Date.UTC(2025, 3, 2), end: Date.UTC(2025, 3, 3), kinds: ['satelliteTransit'], moons: ['tethys'] })
	expect(Math.abs(tethys.events[0].start - Date.UTC(2025, 3, 2, 12, 55, 30))).toBeLessThan(60_000)
	expect(Math.abs(tethys.events[0].end - Date.UTC(2025, 3, 2, 15, 55, 30))).toBeLessThan(60_000)
})
