import type { SpiceKernelSummary } from 'api'

// What the SPICE kernels of the server answer at an instant, for the Ephemeris Sources section of the Settings page: how
// long the Sun, the Moon, the Earth, and the planets stay covered, how many planetary moons and small bodies are
// covered, and which enabled kernels are not ready. Only ready kernels count, over the span from their earliest start to
// their latest end, so a gap between the segments of one kernel is not seen.

// NAIF codes every position of the map, the planners, and the events needs: the Sun, the Earth, the Moon, and the
// barycenters of Mercury to Neptune.
const MAJOR_BODIES: readonly number[] = [10, 399, 301, 1, 2, 3, 4, 5, 6, 7, 8]

// First NAIF code of the small bodies: comets from 1000001, numbered asteroids from 2000001, and the extended codes.
const FIRST_SMALL_BODY = 1000000

// Coverage of the kernels at an instant.
export interface EphemerisCoverage {
	// Latest end, in TDB seconds past J2000, until which every major body stays covered without a break between kernels;
	// undefined when some major body is not covered at the instant.
	readonly majorBodiesUntil?: number
	// Planetary moons covered at the instant, the Moon excluded.
	readonly moons: number
	// Comets and asteroids covered at the instant.
	readonly smallBodies: number
	// Enabled kernels.
	readonly enabled: number
	// Enabled kernels that cannot be evaluated in full, in the order of the library.
	readonly notReady: readonly SpiceKernelSummary[]
}

// Whether a NAIF code names a planetary moon: 101 to 998 but the planets (x99) and the Moon (301).
function isMoon(code: number) {
	return code > 100 && code < 1000 && code % 100 !== 99 && code !== 301
}

// Coverage of the kernels at `epoch`, TDB seconds past J2000.
export function ephemerisCoverage(kernels: readonly SpiceKernelSummary[], epoch: number): EphemerisCoverage {
	const ready = kernels.filter((e) => e.readiness === 'ready' && e.start !== undefined && e.end !== undefined && e.start <= epoch && epoch <= e.end)
	const moons = new Set<number>()
	const smallBodies = new Set<number>()

	for (const kernel of ready) {
		for (const code of kernel.targets) {
			if (isMoon(code)) moons.add(code)
			else if (code > FIRST_SMALL_BODY) smallBodies.add(code)
		}
	}

	let majorBodiesUntil: number | undefined

	for (const code of MAJOR_BODIES) {
		const until = Math.max(...ready.filter((e) => e.targets.includes(code)).map((e) => e.end ?? -Infinity))
		if (!Number.isFinite(until)) {
			majorBodiesUntil = undefined
			break
		}
		majorBodiesUntil = majorBodiesUntil === undefined ? until : Math.min(majorBodiesUntil, until)
	}

	return { majorBodiesUntil, moons: moons.size, smallBodies: smallBodies.size, enabled: kernels.filter((e) => e.enabled).length, notReady: kernels.filter((e) => e.enabled && e.readiness !== 'ready') }
}
