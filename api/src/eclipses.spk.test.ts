import { afterAll, expect, test } from 'bun:test'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { eclipseEphemeris } from './eclipses'
import { LunarEclipseService } from './lunareclipses'
import { SolarEclipseService } from './solareclipses'
import { SpiceKernelRuntime } from './spicekernels.runtime'

// Integration test against the curated NAIF planetary kernel de440s.bsp (SHA-256
// c1c7feeab882263fc493a9d5a5b2ddd71b54826cdf65d8d17a76126b260a49f2). The file is 31 MiB and never fetched by the tests:
// point ECLIPSE_SPK_FIXTURE at a local copy (the toolkit's tests keep one in core/data) to run it. The references are the
// same eclipses computed on the analytical theories, eraMoon98 corrected by ELPMPP02 (0.05″ from DE440 for the Moon).

const FIXTURE = process.env.ECLIPSE_SPK_FIXTURE
const runtime = new SpiceKernelRuntime()
const view = { event: 'MAX', orientation: 'zenith', handedness: 'eastRight', ghosts: false } as const

afterAll(() => {
	runtime[Symbol.dispose]()
})

test.skipIf(!FIXTURE)('de440s gives the eclipses, within a fraction of a second of the theories, and names them by the same ids', async () => {
	expect((await runtime.rebuild([{ id: 'de440s', path: FIXTURE! }], 'spkOnly')).size).toBe(0)
	const solar = new SolarEclipseService({ kernels: runtime })
	const analyticalSolar = new SolarEclipseService()

	try {
		const total = solar.find(Date.UTC(2024, 2, 1), 'next')
		const reference = analyticalSolar.find(Date.UTC(2024, 2, 1), 'next')
		expect(eclipseEphemeris(runtime.current(), timeUnix(total.maximum / 1000)).source).toBe('spk')
		expect(total.type).toBe(reference.type)
		expect(Math.abs(total.maximum - reference.maximum)).toBeLessThan(1000)
		expect(Math.abs(total.gamma - reference.gamma)).toBeLessThan(1e-4)

		// The id of one source names the eclipse on the other, answered with its own id.
		const dallas = solar.local(reference.id, { longitude: -96.8, latitude: 32.78 }, view)!
		const referenceDallas = analyticalSolar.local(reference.id, { longitude: -96.8, latitude: 32.78 }, view)!
		expect(dallas.eclipseId).toBe(total.id)
		expect(dallas.events.map((event) => event.kind)).toEqual(referenceDallas.events.map((event) => event.kind))
		for (let i = 0; i < dallas.events.length; i++) expect(Math.abs(dallas.events[i].time - referenceDallas.events[i].time)).toBeLessThan(1000)
	} finally {
		solar.dispose()
		analyticalSolar.dispose()
	}

	const lunar = new LunarEclipseService({ kernels: runtime })
	const eclipse = lunar.find(Date.UTC(1997, 6, 1), 'next')
	const reference = new LunarEclipseService().find(Date.UTC(1997, 6, 1), 'next')
	expect(eclipse.type).toBe(reference.type)
	expect(Math.abs(eclipse.magnitude - reference.magnitude)).toBeLessThan(1e-4)
	for (let i = 0; i < eclipse.contacts.length; i++) expect(Math.abs(eclipse.contacts[i].time - reference.contacts[i].time)).toBeLessThan(1000)

	// de440s ends in 2150: under spkOnly an eclipse beyond it is refused, not computed on the theories.
	expect(() => lunar.find(Date.UTC(2151, 0, 1), 'next')).toThrow('The SPK kernels cannot give')
})
