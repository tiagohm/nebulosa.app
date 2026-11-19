import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { analyticalEphemerisSource, type EphemerisSource, relativeEphemerisState } from 'nebulosa/src/astronomy/ephemeris/source'
import { type Time, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { AU_KM } from 'nebulosa/src/core/constants'
import { vecAngle } from 'nebulosa/src/math/linear-algebra/vec3'
import { AstroWeatherNights } from '../astroweather.night'
import { NO_EPHEMERIS_KERNELS } from '../ephemeris.chain'
import { instantEphemeris, nightEphemeris } from '../meteorshowers.astronomy'
import { spkFixture, type SpkFixtureSegment } from '../spicekernels.fixture'
import { SpiceKernelRuntime } from '../spicekernels.runtime'
import { solarSystemSource } from './ephemeris'

// J2000.0 (TDB) as Unix milliseconds, to within the ~70 s of TT − UTC that the fixture coverages do not care about.
const J2000_MS = Date.UTC(2000, 0, 1, 11, 58, 56)

const directory = mkdtempSync(join(tmpdir(), 'nebulosa-solar-system-states-'))
const runtimes: SpiceKernelRuntime[] = []
let files = 0

afterAll(() => rmSync(directory, { recursive: true, force: true }))
afterEach(() => {
	for (const runtime of runtimes.splice(0)) runtime[Symbol.dispose]()
})

// A runtime of one fixture kernel.
async function runtimeOf(segments: readonly SpkFixtureSegment[]) {
	const runtime = new SpiceKernelRuntime()
	runtimes.push(runtime)
	const id = `kernel-${++files}`
	const path = join(directory, `${id}.bsp`)
	writeFileSync(path, spkFixture(segments))
	expect((await runtime.rebuild([{ id, path }], false)).size).toBe(0)
	return runtime
}

// Constant Sun, Earth-Moon barycenter, Earth, and Moon from start to end (Unix milliseconds): the Sun on −Y of the Earth,
// far from where it really is in October, so a night of these kernels is not the night of the theories.
function planetaryKernel(start: number, end: number, moon = true): SpkFixtureSegment[] {
	const coverage = { start: (start - J2000_MS) / 1000, end: (end - J2000_MS) / 1000 }
	const segments: SpkFixtureSegment[] = [
		{ center: 0, target: 10, ...coverage, position: [0, 0, 0] },
		{ center: 0, target: 3, ...coverage, position: [0, 149600000, 0] },
		{ center: 3, target: 399, ...coverage, position: [0, 0, 0] },
	]
	if (moon) segments.push({ center: 3, target: 301, ...coverage, position: [380000, 0, 0] })
	return segments
}

// Geocentric position of a body of a source, AU.
function geocentric(source: EphemerisSource, naif: number, time: Time) {
	return relativeEphemerisState(source, naif, 399, time)[0]
}

const NIGHT = Date.UTC(2026, 9, 19, 3)
const SAO_PAULO = { latitude: -23.55, longitude: -46.633, elevation: 760 }

test('the kernels give the states when they cover every probe, else the theories with the reason', async () => {
	const covering = await runtimeOf(planetaryKernel(NIGHT - 10 * 86_400_000, NIGHT + 10 * 86_400_000))
	const chosen = solarSystemSource(covering.current(), ['301'], [NIGHT - 86_400_000, NIGHT + 86_400_000])
	expect(chosen.provenance).toMatchObject({ source: 'spk', mode: 'fast', attempts: [] })
	expect(chosen.key).toBe(`spk:${covering.current().generation}`)
	expect(chosen.source.kind).toBe('spk')
	const time = timeUnix(NIGHT / 1000, true)
	expect(geocentric(chosen.source, 10, time)[1] * AU_KM).toBeCloseTo(-149600000, 0)
	expect(geocentric(chosen.source, 301, time)[0] * AU_KM).toBeCloseTo(380000, 0)

	const partial = await runtimeOf(planetaryKernel(NIGHT - 10 * 86_400_000, NIGHT))
	expect(solarSystemSource(partial.current(), [], [NIGHT - 86_400_000, NIGHT + 86_400_000]).provenance).toMatchObject({ source: 'analytical', attempts: [{ source: 'spk', reason: 'outOfCoverage' }] })

	const moonless = await runtimeOf(planetaryKernel(NIGHT - 10 * 86_400_000, NIGHT + 10 * 86_400_000, false))
	expect(solarSystemSource(moonless.current(), [], [NIGHT]).provenance.source).toBe('spk')
	expect(solarSystemSource(moonless.current(), ['301'], [NIGHT]).provenance).toMatchObject({ source: 'analytical', attempts: [{ source: 'spk', reason: 'targetMissing', body: 301 }] })
	expect(solarSystemSource(moonless.current(), ['301'], [NIGHT]).key).toBe('analytical')
})

test('the nights of Astro Weather take the Sun and the Moon of the kernels, cached apart from those of the theories', async () => {
	const runtime = await runtimeOf(planetaryKernel(NIGHT - 10 * 86_400_000, NIGHT + 10 * 86_400_000))
	const request = { observer: SAO_PAULO, timeZone: 'America/Sao_Paulo', time: NIGHT }
	const theories = new AstroWeatherNights().night(request)
	const kernels = new AstroWeatherNights(runtime).night(request)

	// The kernels' Sun stands about six hours of right ascension from the real one, so the transits move by hours.
	expect(Math.abs(kernels.sun.start - theories.sun.start)).toBeGreaterThan(3_600_000)
	expect(kernels.sun.end - kernels.sun.start).toBeGreaterThan(23 * 3_600_000)
	expect(kernels.moon.illuminatedFraction).not.toBeCloseTo(theories.moon.illuminatedFraction, 2)
})

test('the Sun and the Moon of a meteor night come from the kernels, else match the toolkit theories', async () => {
	const span = { start: NIGHT - 6 * 3_600_000, end: NIGHT + 6 * 3_600_000 }
	const time = timeUnix((NIGHT + 1_234_567) / 1000, true)

	// The interpolated theories against the theories evaluated exactly: well under 0.2″.
	const theories = nightEphemeris(NO_EPHEMERIS_KERNELS.current(), span)
	expect(theories.kind).toBe('analytical')
	expect(vecAngle(geocentric(theories, 10, time), geocentric(analyticalEphemerisSource, 10, time))).toBeLessThan(1e-6)
	expect(vecAngle(geocentric(theories, 301, time), geocentric(analyticalEphemerisSource, 301, time))).toBeLessThan(1e-6)

	const runtime = await runtimeOf(planetaryKernel(NIGHT - 10 * 86_400_000, NIGHT + 10 * 86_400_000))
	const kernels = nightEphemeris(runtime.current(), span)
	expect(geocentric(kernels, 10, time)[1] * AU_KM).toBeCloseTo(-149600000, 0)
	expect(geocentric(kernels, 301, time)[0] * AU_KM).toBeCloseTo(380000, 0)
})

test('the Sun and the Moon of a meteor instant come from the kernels, and need no Moon when it is not asked for', async () => {
	const time = timeUnix(NIGHT / 1000, true)
	expect(instantEphemeris(NO_EPHEMERIS_KERNELS.current(), NIGHT, true)).toBe(analyticalEphemerisSource)

	const kernels = instantEphemeris((await runtimeOf(planetaryKernel(NIGHT - 86_400_000, NIGHT + 86_400_000))).current(), NIGHT, true)
	expect(geocentric(kernels, 301, time)[0] * AU_KM).toBeCloseTo(380000, 0)

	// A kernel without the Moon still gives the Sun of an instant that asks for no Moon.
	const moonless = instantEphemeris((await runtimeOf(planetaryKernel(NIGHT - 86_400_000, NIGHT + 86_400_000, false))).current(), NIGHT, false)
	expect(moonless.kind).toBe('spk')
	expect(geocentric(moonless, 10, time)[1] * AU_KM).toBeCloseTo(-149600000, 0)
})
