import { afterAll, expect, test } from 'bun:test'
import { Timescale } from 'nebulosa/src/astronomy/time/time'
import { AU_KM, J2000 } from 'nebulosa/src/core/constants'
import { AstroWeatherNights } from './astroweather.night'
import { AppDatabase } from './database'
import { JupiterPlannerService } from './jupiter'
import { JupiterGrsStore } from './jupiter.store'
import { SpiceKernelRuntime } from './spicekernels.runtime'

// Integration test against the curated NAIF/JUICE kernel jup365_19900101_20500101.bsp (SHA-256
// b871790fab40efad579c67de8d0535ff4d512fe2b30296214cafde71213ecc09). The file is 108 MiB and never fetched by the tests:
// point JUPITER_SPK_FIXTURE at a local copy to run it. Reference states are CSPICE spkgeo (spiceypy 6.0.0, J2000,
// relative to the solar-system barycenter) at TDB 849441669.184 s past J2000 (2026-12-01 00:00 UTC); the reference
// contact is the JPL Horizons satellite visibility code change (quantity 12, jup365_merged), fetched at 10 s steps.

const FIXTURE = process.env.JUPITER_SPK_FIXTURE
const runtime = new SpiceKernelRuntime()

afterAll(() => {
	runtime[Symbol.dispose]()
})

// CSPICE positions in AU of Jupiter's centre and Io at the reference epoch.
const REFERENCE: Record<number, readonly [number, number, number]> = {
	599: [-3.835787085970156, 3.358519176949243, 1.532974142848341],
	501: [-3.836299382386099, 3.361030339936745, 1.534164495095866],
	399: [0.3455277442987007, 0.8424328176801763, 0.3652701340861901],
}

test.skipIf(!FIXTURE)('the curated Jovian kernel resolves every body like CSPICE and drives the planner alone', async () => {
	expect((await runtime.rebuild([{ id: 'jup365', path: FIXTURE! }], 'spkOnly')).size).toBe(0)
	const set = runtime.current().set!

	for (const [body, position] of Object.entries(REFERENCE)) {
		const state = set.stateAt(+body, { day: J2000, fraction: 849441669.184 / 86400, scale: Timescale.TDB })
		expect(state.ok).toBeTrue()
		if (!state.ok) continue
		expect(Math.hypot(state.state[0][0] - position[0], state.state[0][1] - position[1], state.state[0][2] - position[2]) * AU_KM).toBeLessThan(0.001)
	}

	const service = new JupiterPlannerService({ kernels: runtime, night: (request) => new AstroWeatherNights().night(request), store: new JupiterGrsStore(AppDatabase.memory()) })
	const start = Date.UTC(2026, 11, 1, 6)
	const answer = await service.events({ start, end: start + 6 * 3_600_000, kinds: ['satelliteTransit'], moons: ['io'] })
	expect(answer.signature.source).toMatchObject({ kind: 'spk', kernels: { io: ['jup365'], jupiter: ['jup365'], earth: ['jup365'], sun: ['jup365'] } })
	expect(answer.events).toHaveLength(1)
	// Horizons switches Io from free to transiting between 07:46:16 and 07:46:26 UTC.
	expect(Math.abs(answer.events[0].contacts.external1! - Date.UTC(2026, 11, 1, 7, 46, 21))).toBeLessThan(10_000)
})
