import { join } from 'path'
import { findHnsky290Stars } from 'nebulosa/src/catalogs/stars/hnsky'
import type { Hnsky290Database, Hnsky290Files } from 'nebulosa/src/catalogs/stars/hnsky'
import type { CatalogSource, CatalogSourceStar } from 'nebulosa/src/devices/indi/simulator/types'
import type { Angle } from 'nebulosa/src/math/units/angle'

// HNSKY adapters for simulated camera fields. Coordinates and field radii are J2000 radians.
// Each source retains at most one archive for its connection lifetime; cameras share the same source.

// Synthetic rendering defaults: half-flux diameter in pixels, dimensionless SNR and normalized flux.
const DEFAULT_STAR = { hfd: 2.5, snr: 130, flux: 0.55 } as const

// Detects an optional HNSKY archive in appDir without reading its contents. Missing files omit the source.
// The returned source loads on first query, shares concurrent reads, and retries archive I/O after failure.
export async function hnskyCatalogSource(appDir: string, database: Hnsky290Database): Promise<CatalogSource | undefined> {
	const path = join(appDir, `HNSKY_${database}.tar`)
	if (!(await Bun.file(path).exists())) return undefined

	let loading: Promise<Hnsky290Files> | undefined

	// Reads one TAR into archive members. Failure releases the cached promise so a repaired file can be retried.
	async function load(): Promise<Hnsky290Files> {
		try {
			// A new BunFile observes repaired/replaced files instead of retaining discovery-time size metadata.
			return await new Bun.Archive(await Bun.file(path).arrayBuffer()).files()
		} catch (error) {
			loading = undefined
			throw error
		}
	}

	// Queries a J2000 field (center and radius in radians), augmenting freshly decoded stars for rendering.
	return async (rightAscension: Angle, declination: Angle, radius: Angle): Promise<readonly CatalogSourceStar[]> => {
		loading ??= load()
		const stars = await findHnsky290Stars(await loading, database, { rightAscension, declination, radius })
		return stars.map((star) => Object.assign(star, DEFAULT_STAR))
	}
}
