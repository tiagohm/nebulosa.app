import { errorResponse } from '../http'
import { fetchUpstream, RemoteCache, type UpstreamFetch, UpstreamUnavailableError } from './remote'

// Active regions of the Sun from the NOAA SWPC solar regions feed, for the Sun Inspector. The feed
// keeps about a month of daily reports (one record per region and observed date, from the Solar Region
// Summary issued at 00:30 UTC), so only the records of its latest observed date are answered, as one
// report: counting every record would mix days. Fields the feed leaves null are absent, never 0. The
// report is a current observation, independent of the Sky clock; it is kept for 30 minutes.

// URL of the NOAA SWPC solar regions feed.
export const NOAA_SOLAR_REGIONS_URL = 'https://services.swpc.noaa.gov/json/solar_regions.json'

// How long a report is fresh, in milliseconds (30 minutes; NOAA issues one a day).
const REGIONS_TTL_MS = 30 * 60_000

// Budget of one download in milliseconds.
const REGIONS_TIMEOUT_MS = 15_000

// Largest feed accepted, in bytes (it is about 100 KB).
const REGIONS_MAX_BYTES = 4 * 1024 * 1024

// Error codes of the active regions route.
export type SunActiveRegionsErrorCode = 'upstreamUnavailable'

// Record of the NOAA feed, with the fields read here.
interface NoaaSolarRegion {
	// Observed date, YYYY-MM-DD (UTC).
	readonly observed_date: string
	// NOAA region number.
	readonly region: number
	// Heliographic latitude in degrees, north positive.
	readonly latitude: number | null
	// Longitude from the central meridian in degrees, east positive.
	readonly longitude: number | null
	// Location as NOAA writes it, such as S17E20.
	readonly location: string | null
	// Carrington longitude in degrees.
	readonly carrington_longitude: number | null
	// Sunspot area in millionths of the solar hemisphere.
	readonly area: number | null
	// McIntosh classification of the sunspot group.
	readonly spot_class: string | null
	// Number of sunspots of the group.
	readonly number_spots: number | null
	// Mount Wilson magnetic class.
	readonly mag_class: string | null
}

// Active region of a NOAA report.
export interface SolarActiveRegion {
	// NOAA region number.
	readonly id: string
	// Heliographic latitude in degrees, north positive.
	readonly latitude?: number
	// Longitude from the central meridian in degrees, east positive (the eastern limb rotates into view).
	readonly longitude?: number
	// Location as NOAA writes it, such as S17E20.
	readonly location?: string
	// Carrington longitude in degrees.
	readonly carringtonLongitude?: number
	// Number of sunspots of the group; not the international sunspot number.
	readonly spotCount?: number
	// Sunspot area in millionths of the solar hemisphere.
	readonly area?: number
	// McIntosh classification of the sunspot group, such as Dko.
	readonly mcintoshClass?: string
	// Mount Wilson magnetic class, such as Beta-Gamma.
	readonly magneticClass?: string
}

// Latest NOAA active region report.
export interface SunActiveRegionsResponse {
	// Source of the report.
	readonly source: 'NOAA/SWPC'
	// Observed date of the report, YYYY-MM-DD (UTC); absent when the feed is empty.
	readonly observedDate?: string
	// When the feed was downloaded, Unix milliseconds.
	readonly fetchedAt: number
	// True when NOAA could not be read and this is the last report downloaded.
	readonly stale: boolean
	// Regions of the report, by number; empty when the report has none.
	readonly regions: readonly SolarActiveRegion[]
}

// Latest report of the feed: the regions of its latest observed date.
export interface SolarRegionReport {
	// Observed date, YYYY-MM-DD (UTC); absent when the feed is empty.
	readonly observedDate?: string
	// Regions of the report, by number.
	readonly regions: readonly SolarActiveRegion[]
}

// Returns a value unless it is null.
function present<T>(value: T | null): T | undefined {
	return value ?? undefined
}

// Reads the latest report of the NOAA feed: its records of the latest observed date, one per region.
export function latestSolarRegionReport(records: readonly NoaaSolarRegion[]): SolarRegionReport {
	let observedDate: string | undefined
	for (const record of records) if (observedDate === undefined || record.observed_date > observedDate) observedDate = record.observed_date

	const regions = new Map<number, SolarActiveRegion>()

	for (const record of records) {
		if (record.observed_date !== observedDate || regions.has(record.region)) continue

		regions.set(record.region, {
			id: `${record.region}`,
			latitude: present(record.latitude),
			longitude: present(record.longitude),
			location: present(record.location),
			carringtonLongitude: present(record.carrington_longitude),
			spotCount: present(record.number_spots),
			area: present(record.area),
			mcintoshClass: present(record.spot_class),
			magneticClass: present(record.mag_class),
		})
	}

	return { observedDate, regions: [...regions.values()].sort((a, b) => +a.id - +b.id) }
}

// Options of the active regions service.
export interface SolarActiveRegionsOptions {
	// Fetch of the NOAA server; the global fetch by default.
	readonly fetch?: UpstreamFetch
	// Current time, Unix milliseconds; Date.now by default.
	readonly now?: () => number
}

// Latest NOAA active region report.
export class SolarActiveRegions {
	readonly #fetch: UpstreamFetch
	readonly #cache: RemoteCache<SolarRegionReport>

	// Creates the service.
	constructor({ fetch: upstream = (url, init) => fetch(url, init), now }: SolarActiveRegionsOptions = {}) {
		this.#fetch = upstream
		this.#cache = new RemoteCache(REGIONS_TTL_MS, now)
	}

	// Returns the latest report; rejects with UpstreamUnavailableError when NOAA cannot be read or answers
	// something else than the feed, and no report was read before.
	async report(): Promise<SunActiveRegionsResponse> {
		const { value, fetchedAt, stale } = await this.#cache.get('regions', async () => {
			const { bytes } = await fetchUpstream(this.#fetch, NOAA_SOLAR_REGIONS_URL, 'application/json', REGIONS_TIMEOUT_MS, REGIONS_MAX_BYTES)
			let records: unknown

			try {
				records = JSON.parse(new TextDecoder().decode(bytes))
			} catch (error) {
				throw new UpstreamUnavailableError('The NOAA solar regions feed is not JSON', { cause: error })
			}

			if (!Array.isArray(records)) throw new UpstreamUnavailableError('The NOAA solar regions feed is not a list')
			return latestSolarRegionReport(records as NoaaSolarRegion[])
		})

		return { source: 'NOAA/SWPC', ...value, fetchedAt, stale }
	}
}

// Creates the active regions routes.
export function createActiveRegionRoutes(service: SolarActiveRegions) {
	return {
		'/api/sky/sun/active-regions': {
			// Latest NOAA active region report (SunActiveRegionsResponse); 502 upstreamUnavailable when NOAA cannot
			// be read and no report was read before.
			GET: async () => {
				try {
					return Response.json(await service.report())
				} catch (error) {
					if (error instanceof UpstreamUnavailableError) return errorResponse('The NOAA active region report is unavailable', 502, 'upstreamUnavailable' satisfies SunActiveRegionsErrorCode)
					throw error
				}
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
