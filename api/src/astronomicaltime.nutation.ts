import { interpolatedNutationProviders } from 'nebulosa/src/astronomy/time/nutation.interpolated'
import { TIME_PROVIDERS } from 'nebulosa/src/astronomy/time/time'

// Speeds up the Earth orientation of every Time of the thread by replacing the default nutation and
// precession-nutation providers with the toolkit's interpolated IAU 2006/2000A nutation, within about 0.01 mas of the
// full series. TIME_PROVIDERS belongs to the module instance of a thread, so the server and each worker that computes
// many instants install it for themselves.

// Restores the providers replaced by the installation, while it is installed.
let restore: VoidFunction | undefined

// Installs the interpolated nutation providers into TIME_PROVIDERS of the calling thread. Idempotent: a second call
// keeps the first installation. Returns the function that restores the replaced providers and drops the node cache.
export function installInterpolatedNutation(): VoidFunction {
	if (restore) return restore

	const { nut, pnm } = TIME_PROVIDERS
	const providers = interpolatedNutationProviders()

	TIME_PROVIDERS.nut = providers.nut
	TIME_PROVIDERS.pnm = providers.pnm

	restore = () => {
		TIME_PROVIDERS.nut = nut
		TIME_PROVIDERS.pnm = pnm
		providers.clear()
		restore = undefined
	}

	return restore
}
