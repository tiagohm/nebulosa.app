import { VizierGaiaCatalog } from 'nebulosa/src/adapters/catalogs/vizier'
import type { VizierGaiaCatalogEntry } from 'nebulosa/src/adapters/catalogs/vizier'
import type { Writable } from 'nebulosa/src/core/types'
import type { CatalogSourceStar } from 'nebulosa/src/devices/indi/simulator/types'
import { clamp } from 'nebulosa/src/math/numerical/math'
import type { Angle } from 'nebulosa/src/math/units/angle'

// VizieR Gaia source for synthetic fields. Queries use J2000 radians; rendering values preserve the simulator's visual model.

// Stateless query adapter shared across cameras; it does not cache result arrays.
const catalog = new VizierGaiaCatalog()

// Queries a cone centered at the supplied J2000 coordinates, with radius in radians. Returns fresh stars
// with pixel HFD, dimensionless SNR and normalized flux; upstream query failures propagate to the camera.
export async function vizierCatalogSource(rightAscension: Angle, declination: Angle, radius: Angle): Promise<readonly CatalogSourceStar[]> {
	const stars = (await catalog.queryCone(rightAscension, declination, radius)) as unknown as Writable<VizierGaiaCatalogEntry & CatalogSourceStar>[]
	const hfdSpread = 0.5
	const invMaxBrightness = 1 / 10 ** (-0.4 * -1.46)

	for (const star of stars) {
		const brightness = 10 ** (-0.4 * star.magnitude)
		const normalized = clamp(brightness * invMaxBrightness, 0, 1)
		// The queried Gaia columns do not include color; retain the simulator's solar-color fallback.
		star.colorIndex = 0.65
		star.flux = 0.2 + 0.848 * normalized
		star.hfd = 1.2 + 2.4 * clamp((1 - normalized) * (0.35 + hfdSpread * 0.65), 0, 1)
		star.snr = 12 + normalized * 180
	}

	return stars
}
