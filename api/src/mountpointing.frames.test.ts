import { expect, test } from 'bun:test'
import { equatorialFromJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { deg, normalizePI, toArcsec } from 'nebulosa/src/math/units/angle'
import { apparentFromIcrs, type PointingSite } from './mountpointing.frames'

const SITE: PointingSite = { latitude: deg(-23), longitude: deg(-46), elevation: 700 }
const NOW = Date.UTC(2026, 9, 30, 3, 0, 0)

test('the apparent place is the precessed one plus the aberration of the year, and never the catalog place', () => {
	for (const [rightAscension, declination] of [
		[0.5, -0.4],
		[2.1, 0.1],
		[4.5, -1.1],
		[5.9, 0.6],
	]) {
		const apparent = apparentFromIcrs({ rightAscension, declination }, NOW, SITE)
		const [meanRightAscension, meanDeclination] = equatorialFromJ2000(rightAscension, declination, timeUnix(NOW / 1000, true))
		const separation = toArcsec(Math.hypot(normalizePI(apparent.rightAscension - meanRightAscension) * Math.cos(declination), apparent.declination - meanDeclination))

		expect(separation).toBeGreaterThan(1)
		expect(separation).toBeLessThan(22)
		expect(toArcsec(Math.hypot(normalizePI(apparent.rightAscension - rightAscension) * Math.cos(declination), apparent.declination - declination))).toBeGreaterThan(300)
	}
})

test('the right ascension stays in a full turn across its wrap', () => {
	const { rightAscension } = apparentFromIcrs({ rightAscension: 6.28318, declination: 0 }, NOW, SITE)
	expect(rightAscension).toBeGreaterThanOrEqual(0)
	expect(rightAscension).toBeLessThan(2 * Math.PI)
})
