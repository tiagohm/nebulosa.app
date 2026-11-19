import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { timeShift, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { EclipseEphemerisUnavailableError, eclipseEphemeris } from './eclipses'
import { createLunarEclipseRoutes, LunarEclipseService } from './lunareclipses'
import { spkFixture, type SpkFixtureSegment } from './spicekernels.fixture'
import { SpiceKernelRuntime } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

// J2000.0 (TDB) as Unix milliseconds, to within the ~70 s of TT − UTC that the fixture coverages do not care about.
const J2000_MS = Date.UTC(2000, 0, 1, 11, 58, 56)

// TDB seconds past J2000 of a Unix time, for fixture coverages.
function et(time: number) {
	return (time - J2000_MS) / 1000
}

const directory = mkdtempSync(join(tmpdir(), 'nebulosa-eclipses-'))
const runtimes: SpiceKernelRuntime[] = []
let files = 0

afterAll(() => rmSync(directory, { recursive: true, force: true }))
afterEach(() => {
	for (const runtime of runtimes.splice(0)) runtime[Symbol.dispose]()
})

// A runtime of one fixture kernel under a policy.
async function runtimeOf(policy: SpiceEphemerisPolicy, segments: readonly SpkFixtureSegment[]) {
	const runtime = new SpiceKernelRuntime()
	runtimes.push(runtime)
	const id = `kernel-${++files}`
	const path = join(directory, `${id}.bsp`)
	writeFileSync(path, spkFixture(segments))
	expect((await runtime.rebuild([{ id, path }], policy)).size).toBe(0)
	return runtime
}

// Constant Sun, Earth-Moon barycenter, Earth, and Moon from start to end (Unix milliseconds), like de440s.
function planetaryKernel(start: number, end: number, moon = true): SpkFixtureSegment[] {
	const coverage = { start: et(start), end: et(end) }
	const segments: SpkFixtureSegment[] = [
		{ center: 0, target: 10, ...coverage, position: [0, 0, 0] },
		{ center: 0, target: 3, ...coverage, position: [149600000, 0, 0] },
		{ center: 3, target: 399, ...coverage, position: [-4670, 0, 0] },
	]
	if (moon) segments.push({ center: 3, target: 301, ...coverage, position: [380000, 0, 0] })
	return segments
}

const ECLIPSE = Date.UTC(2024, 3, 8, 18, 17)

test('every eclipse is computed on the theories without kernels', async () => {
	const runtime = new SpiceKernelRuntime()
	runtimes.push(runtime)
	await runtime.rebuild([], 'automatic')
	const ephemeris = eclipseEphemeris(runtime.current(), timeUnix(ECLIPSE / 1000))
	expect(ephemeris).toMatchObject({ source: 'analytical', key: 'analytical' })
})

test('the kernels give an eclipse whose whole window they cover, and the theories one outside them', async () => {
	const runtime = await runtimeOf('automatic', planetaryKernel(Date.UTC(2020, 0, 1), Date.UTC(2030, 0, 1)))
	const snapshot = runtime.current()

	expect(eclipseEphemeris(snapshot, timeUnix(ECLIPSE / 1000))).toMatchObject({ source: 'spk', key: `spk:${snapshot.generation}` })
	expect(eclipseEphemeris(snapshot, timeUnix(Date.UTC(1997, 8, 16) / 1000)).source).toBe('analytical')
	// The window reaches 13 hours on either side, so an eclipse half a day before the kernels end is not theirs.
	expect(eclipseEphemeris(snapshot, timeUnix((Date.UTC(2030, 0, 1) - 6 * 3_600_000) / 1000)).source).toBe('analytical')
})

test('spkOnly fails an eclipse the kernels do not cover, and the routes answer 503', async () => {
	const runtime = await runtimeOf('spkOnly', planetaryKernel(Date.UTC(2020, 0, 1), Date.UTC(2030, 0, 1)))
	expect(() => eclipseEphemeris(runtime.current(), timeUnix(Date.UTC(1997, 8, 16) / 1000))).toThrow(EclipseEphemerisUnavailableError)

	const withoutMoon = await runtimeOf('spkOnly', planetaryKernel(Date.UTC(2020, 0, 1), Date.UTC(2030, 0, 1), false))
	const routes = createLunarEclipseRoutes(new LunarEclipseService({ kernels: withoutMoon }))
	const response = await routes['/api/eclipses/lunar'].GET(new Request(`http://localhost/api/eclipses/lunar?time=${Date.UTC(2025, 0, 1)}&direction=next`))
	expect(response.status).toBe(503)
	expect(await response.json()).toMatchObject({ code: 'missingDependency', reason: 'targetMissing', miss: { target: 'moon', body: 301 } })
})

test('a kernel gap inside the window reruns the whole computation on the theories, or fails it under spkOnly', async () => {
	// Coverage up to 4 hours after the eclipse and again from 7 hours after it: the probes at the eclipse and 13 hours
	// on either side all resolve, but a state 5 hours after it does not.
	const before = planetaryKernel(Date.UTC(2020, 0, 1), ECLIPSE + 4 * 3_600_000)
	const after = planetaryKernel(ECLIPSE + 7 * 3_600_000, Date.UTC(2030, 0, 1))
	const center = timeUnix(ECLIPSE / 1000)
	const compute = (sunMoon: (time: ReturnType<typeof timeUnix>) => unknown, key: string) => {
		sunMoon(center)
		sunMoon(timeShift(center, 5 / 24))
		return key
	}

	const automatic = await runtimeOf('automatic', [...before, ...after])
	const ephemeris = eclipseEphemeris(automatic.current(), center)
	expect(ephemeris.source).toBe('spk')
	expect(ephemeris.run(compute)).toBe('analytical')

	const strict = await runtimeOf('spkOnly', [...before, ...after])
	expect(() => eclipseEphemeris(strict.current(), center).run(compute)).toThrow(EclipseEphemerisUnavailableError)
})
