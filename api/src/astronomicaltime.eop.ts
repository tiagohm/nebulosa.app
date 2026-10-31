import { stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { IersA, IersAB, IersB } from 'nebulosa/src/astronomy/time/iers'
import type { Time, TimeProviders } from 'nebulosa/src/astronomy/time/time'
import { errorCode, writeAtomically } from './util'

// Earth orientation data of the Astronomical Time Converter: private IERS tables, kept apart from the shared `iersab` of
// the toolkit so that mounts, the Sky, and every other reader of the default providers are unaffected. The tables are
// read from the cache of the server on first use, and a conversion that finds them old starts one background refresh
// from the IERS. No request waits on the network, no timer runs, and an offline server keeps answering from its cache,
// or with DUT1 = 0 and an explicit status when it has none.

// Directory of the cached tables.
export const DEFAULT_IERS_DIRECTORY = join(homedir(), 'Nebulosa', 'iers')

// Age from which a cached table is refreshed, in milliseconds (7 days, the publication cycle of IERS Bulletin A).
const REFRESH_AGE_MS = 7 * 86_400_000

// Shortest time between refresh attempts, in milliseconds (1 hour), so an offline server does not retry on every request.
const REFRESH_RETRY_MS = 3_600_000

// Longest time a download may take, in milliseconds.
const DOWNLOAD_TIMEOUT_MS = 60_000

// Days a replacement IERS B table may lag behind today, about the delay of its publication plus a margin.
const IERS_B_MAXIMUM_LAG_DAYS = 120

// Milliseconds in one day.
const DAY_MS = 86_400_000

// Unix milliseconds of the Unix epoch expressed as a Modified Julian Date.
const UNIX_EPOCH_MJD = 40587

// File and source of one table.
interface IersSource {
	// Name of the cached file.
	readonly file: string
	// URLs of the publication, tried in order.
	readonly urls: readonly string[]
}

// Rapid and predicted table, IERS Bulletin A, from the IERS and its mirror at the USNO.
const IERS_A_SOURCE: IersSource = { file: 'finals2000A.all', urls: ['https://datacenter.iers.org/data/9/finals2000A.all', 'https://maia.usno.navy.mil/ser7/finals2000A.all'] }

// Final table, IERS EOP C04.
const IERS_B_SOURCE: IersSource = { file: 'eopc04.1962-now', urls: ['https://hpiers.obspm.fr/iers/eop/eopc04/eopc04.1962-now'] }

// State of the Earth orientation data at one instant:
// - covered: a table holds the instant.
// - outsideTable: tables are loaded, but none reaches the instant.
// - notLoaded: there is no table yet.
export type EarthOrientationStatus = 'covered' | 'outsideTable' | 'notLoaded'

// Table that answered an instant.
export type EarthOrientationSource = 'iersA' | 'iersB'

// Provenance of the Earth orientation data used at one instant.
export interface EarthOrientationCoverage {
	// State of the data at the instant.
	readonly status: EarthOrientationStatus
	// Table holding the instant, only while covered.
	readonly source?: EarthOrientationSource
	// When the rapid table was last refreshed, Unix milliseconds; absent without one.
	readonly updatedAt?: number
}

// Collaborators of the data, replaceable by tests.
export interface EarthOrientationOptions {
	// Directory of the cached tables.
	readonly directory?: string
	// Downloads a URL.
	readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
	// Current time in Unix milliseconds.
	readonly now?: () => number
}

// Tables of one generation; a refresh replaces them whole, so a conversion never sees a table half replaced.
interface LoadedTables {
	readonly a: IersA
	readonly b: IersB
	readonly combined: IersAB
}

// Modified Julian Date of an instant, as a Time in UTC with no providers.
function utcAt(unixMillis: number): Time {
	const mjd = unixMillis / DAY_MS + UNIX_EPOCH_MJD
	const day = Math.floor(mjd)
	return { day: day + 2400001, fraction: mjd - day - 0.5, scale: 1 }
}

// Parses a published table into a new provider.
async function parsed<T extends IersA | IersB>(table: T, text: string) {
	await table.load(text.split('\n'))
	return table
}

// Earth orientation data of the converter.
export class EarthOrientationData {
	readonly #directory: string
	readonly #fetch: (url: string, init: RequestInit) => Promise<Response>
	readonly #now: () => number
	#tables: LoadedTables = this.#combine(new IersA(), new IersB())
	#updatedAt?: number
	#attemptedAt?: number
	#loading?: Promise<void>
	#refreshing?: Promise<void>

	// Provider of the private tables: UT1-UTC and polar motion of the tables, 0 for an instant no table holds, unlike
	// the toolkit's lookups, which clamp to the edge of the table.
	readonly providers: Readonly<TimeProviders> = {
		dut1: (time) => (this.#tables.combined.covers(time) ? this.#tables.combined.dut1(time) : 0),
		pm: (time) => (this.#tables.combined.covers(time) ? this.#tables.combined.xy(time) : [0, 0]),
	}

	// Creates the data, reading nothing until prepare is called.
	constructor({ directory = DEFAULT_IERS_DIRECTORY, fetch: download = (url, init) => fetch(url, init), now = Date.now }: EarthOrientationOptions = {}) {
		this.#directory = directory
		this.#fetch = download
		this.#now = now
	}

	// Bundles two tables with their combined provider.
	#combine(a: IersA, b: IersB): LoadedTables {
		return { a, b, combined: new IersAB(a, b) }
	}

	// Reads the cached tables once and starts a refresh when they are old. Resolves after the local read, never after
	// the network, and never rejects: a cache that cannot be read leaves the tables empty.
	async prepare() {
		this.#loading ??= this.#read()
		await this.#loading
		this.#refreshWhenOld()
	}

	// Waits for the refresh running now, if any. For a server about to stop and for tests.
	async settled() {
		await this.#refreshing
	}

	// Returns the provenance of the data at a UTC instant.
	coverage(utc: Time): EarthOrientationCoverage {
		const { a, b } = this.#tables
		const updatedAt = this.#updatedAt
		if (b.covers(utc)) return { status: 'covered', source: 'iersB', updatedAt }
		if (a.covers(utc)) return { status: 'covered', source: 'iersA', updatedAt }
		// An empty table is infinitely far from every instant.
		return { status: Number.isFinite(a.distance(utc)) || Number.isFinite(b.distance(utc)) ? 'outsideTable' : 'notLoaded', updatedAt }
	}

	// Reads one cached file; undefined when it is missing or unreadable.
	async #readFile(file: string) {
		try {
			const path = join(this.#directory, file)
			return { text: await Bun.file(path).text(), modifiedAt: (await stat(path)).mtimeMs }
		} catch (error) {
			if (errorCode(error) !== 'ENOENT') console.warn(`The cached IERS table ${file} could not be read: ${Error.isError(error) ? error.message : String(error)}`)
			return undefined
		}
	}

	// Reads the cached tables into the current generation.
	async #read() {
		const [a, b] = await Promise.all([this.#readFile(IERS_A_SOURCE.file), this.#readFile(IERS_B_SOURCE.file)])
		this.#tables = this.#combine(a ? await parsed(new IersA(), a.text) : new IersA(), b ? await parsed(new IersB(), b.text) : new IersB())
		this.#updatedAt = a?.modifiedAt
	}

	// Starts one background refresh when the tables are old and none ran within the retry interval.
	#refreshWhenOld() {
		const now = this.#now()
		if (this.#refreshing) return
		if (this.#updatedAt !== undefined && now - this.#updatedAt < REFRESH_AGE_MS) return
		if (this.#attemptedAt !== undefined && now - this.#attemptedAt < REFRESH_RETRY_MS) return

		this.#attemptedAt = now
		this.#refreshing = this.#refresh()
			.catch((error: unknown) => console.warn('The IERS tables could not be refreshed:', error))
			.finally(() => {
				this.#refreshing = undefined
			})
	}

	// Downloads a table from the first URL that gives a complete one, caching it. Returns undefined when none does, or
	// when no table reaches the instant that proves it complete; the cached table then stays in use.
	async #download<T extends IersA | IersB>(source: IersSource, table: T, reaches: number) {
		for (const url of source.urls) {
			try {
				const response = await this.#fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
				if (!response.ok) throw new Error(`HTTP ${response.status}`)
				const text = await response.text()
				await parsed(table, text)
				if (!table.covers(utcAt(reaches))) throw new Error('the table does not reach the expected date')
				await writeAtomically(join(this.#directory, source.file), text)
				return table
			} catch (error) {
				console.warn(`The IERS table ${source.file} could not be replaced from ${url}: ${Error.isError(error) ? error.message : String(error)}`)
			}
		}

		return undefined
	}

	// Downloads both tables and adopts each one that passed.
	async #refresh() {
		const now = this.#now()
		const [a, b] = await Promise.all([this.#download(IERS_A_SOURCE, new IersA(), now), this.#download(IERS_B_SOURCE, new IersB(), now - IERS_B_MAXIMUM_LAG_DAYS * DAY_MS)])
		this.#tables = this.#combine(a ?? this.#tables.a, b ?? this.#tables.b)
		if (a) this.#updatedAt = now
	}
}
