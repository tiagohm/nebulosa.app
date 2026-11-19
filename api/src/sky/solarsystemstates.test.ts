import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { meteorMoonDirection, meteorSunDirection } from 'nebulosa/src/astronomy/meteors/observation'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { AU_KM } from 'nebulosa/src/core/constants'
import { vecAngle } from 'nebulosa/src/math/linear-algebra/vec3'
import { AstroWeatherNights } from '../astroweather.night'
import { NO_EPHEMERIS_KERNELS } from '../ephemeris.chain'
import { nightEphemeris } from '../meteorshowers.astronomy'
import { spkFixture, type SpkFixtureSegment } from '../spicekernels.fixture'
import { SpiceKernelRuntime } from '../spicekernels.runtime'
import { solarSystemStates } from './ephemeris'

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

const NIGHT = Date.UTC(2026, 9, 19, 3)
const SAO_PAULO = { latitude: -23.55, longitude: -46.633, elevation: 760 }

test('the kernels give the states when they cover every probe, else the theories with the reason', async () => {
	const covering = await runtimeOf(planetaryKernel(NIGHT - 10 * 86_400_000, NIGHT + 10 * 86_400_000))
	const chosen = solarSystemStates(covering.current(), ['301'], [NIGHT - 86_400_000, NIGHT + 86_400_000])
	expect(chosen.provenance).toMatchObject({ source: 'spk', mode: 'fast', attempts: [] })
	expect(chosen.key).toBe(`spk:${covering.current().generation}`)
	const time = timeUnix(NIGHT / 1000, true)
	const sun = chosen.states.sun(time)[0]
	const earth = chosen.states.earth(time)[0]
	expect((sun[1] - earth[1]) * AU_KM).toBeCloseTo(-149600000, 0)
	expect((chosen.states.body('301')(time)[0][0] - earth[0]) * AU_KM).toBeCloseTo(380000, 0)

	const partial = await runtimeOf(planetaryKernel(NIGHT - 10 * 86_400_000, NIGHT))
	expect(solarSystemStates(partial.current(), [], [NIGHT - 86_400_000, NIGHT + 86_400_000]).provenance).toMatchObject({ source: 'analytical', attempts: [{ source: 'spk', reason: 'outOfCoverage' }] })

	const moonless = await runtimeOf(planetaryKernel(NIGHT - 10 * 86_400_000, NIGHT + 10 * 86_400_000, false))
	expect(solarSystemStates(moonless.current(), [], [NIGHT]).provenance.source).toBe('spk')
	expect(solarSystemStates(moonless.current(), ['301'], [NIGHT]).provenance).toMatchObject({ source: 'analytical', attempts: [{ source: 'spk', reason: 'targetMissing', body: 301 }] })
	expect(solarSystemStates(moonless.current(), ['301'], [NIGHT]).key).toBe('analytical')
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

	const theories = nightEphemeris(NO_EPHEMERIS_KERNELS.current(), span)
	expect(vecAngle(theories.sun(time), meteorSunDirection(time))).toBeLessThan(1e-6)
	expect(vecAngle(theories.moon(time), meteorMoonDirection(time))).toBeLessThan(2e-5)

	const runtime = await runtimeOf(planetaryKernel(NIGHT - 10 * 86_400_000, NIGHT + 10 * 86_400_000))
	const kernels = nightEphemeris(runtime.current(), span)
	expect(kernels.sun(time)[1] * AU_KM).toBeCloseTo(-149600000, 0)
	expect(kernels.moon(time)[0] * AU_KM).toBeCloseTo(380000, 0)
})
