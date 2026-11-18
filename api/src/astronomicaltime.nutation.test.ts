import { expect, test } from 'bun:test'
import { eraNut06a } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { nutationAngles, time, Timescale, TIME_PROVIDERS } from 'nebulosa/src/astronomy/time/time'
import { installInterpolatedNutation } from './astronomicaltime.nutation'

const MAS = Math.PI / 180 / 3600 / 1000

test('installs the interpolated nutation once and restores the defaults', () => {
	const { nut, pnm } = TIME_PROVIDERS
	const restore = installInterpolatedNutation()

	try {
		expect(installInterpolatedNutation()).toBe(restore)
		expect(TIME_PROVIDERS.nut).not.toBe(nut)
		expect(TIME_PROVIDERS.pnm).not.toBe(pnm)

		const t = time(2461000, 0.137, Timescale.TT)
		const [dpsi, deps] = nutationAngles(t)
		const [edpsi, edeps] = eraNut06a(t.day, t.fraction)
		expect(Math.abs(dpsi - edpsi)).toBeLessThan(0.05 * MAS)
		expect(Math.abs(deps - edeps)).toBeLessThan(0.05 * MAS)
	} finally {
		restore()
	}

	expect(TIME_PROVIDERS.nut).toBe(nut)
	expect(TIME_PROVIDERS.pnm).toBe(pnm)
	expect(installInterpolatedNutation()).not.toBe(restore)
	installInterpolatedNutation()()
})
