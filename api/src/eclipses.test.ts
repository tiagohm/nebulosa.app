import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { timeShift, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { eclipseEphemeris } from './eclipses'
import { createLunarEclipseRoutes, LunarEclipseService } from './lunareclipses'
import { spkFixture, type SpkFixtureSegment } from './spicekernels.fixture'
import { SpiceKernelRuntime } from './spicekernels.runtime'

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

// A runtime of one fixture kernel, online unless offline.
async function runtimeOf(offline: boolean, segments: readonly SpkFixtureSegment[]) {
	const runtime = new SpiceKernelRuntime()
	runtimes.push(runtime)
	const id = `kernel-${++files}`
	const path = join(directory, `${id}.bsp`)
	writeFileSync(path, spkFixture(segments))
	expect((await runtime.rebuild([{ id, path }], offline)).size).toBe(0)
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

// The source a computation of the eclipse centered on time runs on, with its key and the sources tried before.
function sourceOf(snapshot: Parameters<typeof eclipseEphemeris>[0], time: number) {
	const { result, provenance } = eclipseEphemeris(snapshot, timeUnix(time / 1000)).run((_, key) => key)
	return { key: result, source: provenance.source, attempts: provenance.attempts }
}

test('every eclipse is computed on the theories without kernels', async () => {
	const runtime = new SpiceKernelRuntime()
	runtimes.push(runtime)
	await runtime.rebuild([], false)
	expect(sourceOf(runtime.current(), ECLIPSE)).toEqual({ key: 'analytical', source: 'analytical', attempts: [{ source: 'spk', reason: 'noKernel' }] })
})

test('the kernels give an eclipse whose whole window they cover, and the theories one outside them', async () => {
	const runtime = await runtimeOf(false, planetaryKernel(Date.UTC(2020, 0, 1), Date.UTC(2030, 0, 1)))
	const snapshot = runtime.current()

	expect(sourceOf(snapshot, ECLIPSE)).toEqual({ key: `spk:${snapshot.generation}`, source: 'spk', attempts: [] })
	expect(sourceOf(snapshot, Date.UTC(1997, 8, 16))).toMatchObject({ source: 'analytical', attempts: [{ source: 'spk', reason: 'outOfCoverage', target: 'sun', body: 10 }] })
	// The window reaches 13 hours on either side, so an eclipse half a day before the kernels end is not theirs.
	expect(sourceOf(snapshot, Date.UTC(2030, 0, 1) - 6 * 3_600_000).source).toBe('analytical')
})

test('an eclipse without a kernel of the Moon falls to the theories, offline or not', async () => {
	const withoutMoon = await runtimeOf(true, planetaryKernel(Date.UTC(2020, 0, 1), Date.UTC(2030, 0, 1), false))
	expect(sourceOf(withoutMoon.current(), ECLIPSE)).toMatchObject({ source: 'analytical', attempts: [{ source: 'spk', reason: 'targetMissing', target: 'moon', body: 301 }] })

	const routes = createLunarEclipseRoutes(new LunarEclipseService({ kernels: withoutMoon }))
	const response = await routes['/api/eclipses/lunar'].GET(new Request(`http://localhost/api/eclipses/lunar?time=${Date.UTC(2025, 0, 1)}&direction=next`))
	expect(response.status).toBe(200)
})

test('a kernel gap inside the window reruns the whole computation on the theories', async () => {
	// Coverage up to 4 hours after the eclipse and again from 7 hours after it: the probes at the eclipse and 13 hours
	// on either side all resolve, but a state 5 hours after it does not.
	const before = planetaryKernel(Date.UTC(2020, 0, 1), ECLIPSE + 4 * 3_600_000)
	const after = planetaryKernel(ECLIPSE + 7 * 3_600_000, Date.UTC(2030, 0, 1))
	const center = timeUnix(ECLIPSE / 1000)
	const runs: string[] = []
	const compute = (sunMoon: (time: ReturnType<typeof timeUnix>) => unknown, key: string) => {
		runs.push(key)
		sunMoon(center)
		sunMoon(timeShift(center, 5 / 24))
		return key
	}

	const runtime = await runtimeOf(false, [...before, ...after])
	const { result, provenance } = eclipseEphemeris(runtime.current(), center).run(compute)
	expect(result).toBe('analytical')
	expect(runs).toEqual([`spk:${runtime.current().generation}`, 'analytical'])
	expect(provenance).toMatchObject({ source: 'analytical', mode: 'fast', attempts: [{ source: 'spk', reason: 'outOfCoverage' }] })
})
