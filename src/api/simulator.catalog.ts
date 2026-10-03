import type { CatalogSource } from 'nebulosa/src/devices/indi/simulator/types'
import { hnskyCatalogSource } from './simulator.catalog.hnsky'
import { vizierCatalogSource } from './simulator.catalog.vizier'

// Composes optional local and remote catalogs for one simulator connection, shared by its cameras.

// Detects available catalogs under appDir and allocates their source map. Archive data loads only on query;
// retaining the map retains loaded archives, so its lifetime is scoped to the owning simulated devices.
export async function simulatorCatalogSources(appDir: string): Promise<Record<string, CatalogSource | undefined>> {
	const [g14, g16] = await Promise.all([hnskyCatalogSource(appDir, 'g14'), hnskyCatalogSource(appDir, 'g16')])
	return { VIZIER: vizierCatalogSource, HNSKY_G14: g14, HNSKY_G16: g16 }
}
