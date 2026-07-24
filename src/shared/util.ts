import { eraPnm06a, eraPmat06, eraNut06a, eraGst06a } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { TIME_PROVIDERS, toJulianDay } from 'nebulosa/src/astronomy/time/time'
import type { TimeProviders } from 'nebulosa/src/astronomy/time/time'
import type { MutMat3 } from 'nebulosa/src/math/linear-algebra/mat3'
import type { Angle } from 'nebulosa/src/math/units/angle'

// Unsubscribes all provided unsubscribers
export function unsubscribe(unsubscribers?: readonly (VoidFunction | undefined)[]) {
	if (unsubscribers) for (const e of unsubscribers) e?.()
}

// Speed up Time by caching some expensive ERFA calls.
// The cache is keyed by the rounded Julian epoch, which is the same for all times in a given day.
export function speedUpTime(providers: Required<TimeProviders> = TIME_PROVIDERS) {
	const PNM_CACHE = new Map<number, MutMat3>()
	const PMAT_CACHE = new Map<number, MutMat3>()
	const NUT_CACHE = new Map<number, [Angle, Angle]>()

	providers.pnm = (time) => PNM_CACHE.getOrInsertComputed(Math.round(toJulianDay(time)), () => eraPnm06a(time.day, time.fraction))
	providers.pmat = (time) => PMAT_CACHE.getOrInsertComputed(Math.round(toJulianDay(time)), () => eraPmat06(time.day, time.fraction))
	providers.nut = (time) => NUT_CACHE.getOrInsertComputed(Math.round(toJulianDay(time)), () => eraNut06a(time.day, time.fraction))
	providers.gast = (ut1, tt) => eraGst06a(ut1.day, ut1.fraction, tt.day, tt.fraction, providers.pnm(tt))
}
