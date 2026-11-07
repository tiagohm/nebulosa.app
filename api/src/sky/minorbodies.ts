// oxfmt-ignore
import { assertSupportedSignature, SBD_BASE_URL, SEARCH_PATH, type SmallBodySearch, type SmallBodySearchFound, type SmallBodySearchModelParameter, type SmallBodySearchOrbit, type SmallBodySearchOrbitElement, type SmallBodySearchPhyscalParameter } from 'nebulosa/src/adapters/orbits/sbd'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { LruCache } from '../lrucache'
import { SsdBusyError, SsdRequestQueue, SsdThrottledError, SsdTimeoutError } from '../ssd'
import type { MinorBodyElements } from './ephemeris'
import type { MinorBody, MinorBodyDetails, MinorBodyDetailsResponse, MinorBodyOrbitDetails, MinorBodyPublishedValue, MinorBodySearchResponse } from './types'

// Asteroid and comet lookup in the JPL Small-Body Database (SBDB): search by name or designation, the
// identity, classification, orbit, and physical parameters of a body, its osculating elements for
// the local ephemeris model, and everything else SBDB publishes about it for the Close Approaches tool. Bodies are
// cached by SPK-ID so positions do not query SBDB again. The
// service is remote, so every request goes through the JPL queue, has a timeout, and may be aborted.

// Budget of one SBDB request in milliseconds.
export const SBDB_TIMEOUT_MS = 8_000

// Minor bodies kept in memory.
const MINOR_BODY_CACHE_LIMIT = 128

// How long the details of a body stay fresh in milliseconds: an orbit solution changes rarely, but not never.
const DETAILS_TTL_MS = 3_600_000

// SBDB did not answer, or answered with an error status.
export class SbdbUnavailableError extends Error {
	// Creates the error.
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'SbdbUnavailableError'
	}
}

// SBDB selector of a lookup: `sstr` searches names and designations and may match several bodies, `des` names one
// designation or IAU number.
export type SbdbSelector = 'sstr' | 'des'

// Fetches an SBDB lookup; tests pass a mock. Runs in a turn of the JPL queue.
export type SbdbFetch = (text: string, signal: AbortSignal, selector: SbdbSelector) => Promise<SmallBodySearch>

// Fetches the SBDB lookup of `text` with the adapter's endpoint and parameters, honoring `signal`. A designation SBDB
// cannot read is answered 400, which for `des` means it names no body.
async function fetchSbdb(queue: SsdRequestQueue, text: string, signal: AbortSignal, selector: SbdbSelector): Promise<SmallBodySearch> {
	const response = await queue.fetch(`${SBD_BASE_URL}${SEARCH_PATH}&${selector}=${encodeURIComponent(text)}`, signal)
	const known = response.ok || response.status === 300 || response.status === 404 || (selector === 'des' && response.status === 400)
	if (!known) throw new SbdbUnavailableError(`SBDB answered ${response.status}`)
	return (await response.json()) as SmallBodySearch
}

// Parses a published number; undefined when empty or not finite.
function finiteNumber(value?: string | null) {
	if (!value) return undefined
	const number = Number(value)
	return Number.isFinite(number) ? number : undefined
}

// Named orbital element as a finite number; undefined when missing.
function elementValue(elements: readonly SmallBodySearchOrbitElement[], name: SmallBodySearchOrbitElement['name']) {
	return finiteNumber(elements.find((e) => e.name === name)?.value)
}

// Named physical parameter as a finite number; undefined when missing.
function physicalValue(parameters: readonly SmallBodySearchPhyscalParameter[], name: string) {
	return finiteNumber(parameters.find((e) => e.name === name)?.value)
}

// Osculating elements of an SBDB match in radians, AU, and JD TDB; undefined when the published
// solution lacks the elements the Kepler model needs.
export function elementsOf(result: SmallBodySearchFound): MinorBodyElements | undefined {
	const { elements } = result.orbit
	const ec = elementValue(elements, 'e')
	const i = elementValue(elements, 'i')
	const om = elementValue(elements, 'om')
	const w = elementValue(elements, 'w')
	const epoch = finiteNumber(result.orbit.epoch)
	if (ec === undefined || i === undefined || om === undefined || w === undefined || epoch === undefined) return undefined

	const a = elementValue(elements, 'a')
	const ma = elementValue(elements, 'ma')
	const qr = elementValue(elements, 'q')
	const tp = elementValue(elements, 'tp')
	const n = elementValue(elements, 'n')

	let tpqr: MinorBodyElements['tpqr']

	if (ec >= 1) {
		if (qr === undefined || tp === undefined) return undefined
		tpqr = { qr, tp }
	} else if (a !== undefined && ma !== undefined) {
		tpqr = { ma: ma * DEG2RAD, a }
	} else if (n !== undefined && ma !== undefined) {
		tpqr = { ma: ma * DEG2RAD, n: n * DEG2RAD }
	} else if (qr !== undefined && tp !== undefined) {
		tpqr = { qr, tp }
	} else {
		return undefined
	}

	return {
		epoch,
		referenceEclipticFrame: result.orbit.equinox.toUpperCase().includes('B1950') ? 'B1950' : 'J2000',
		ec,
		tpqr,
		om: om * DEG2RAD,
		w: w * DEG2RAD,
		i: i * DEG2RAD,
		h: physicalValue(result.phys_par, 'H'),
		g: physicalValue(result.phys_par, 'G'),
		m1: physicalValue(result.phys_par, 'M1'),
		k1: physicalValue(result.phys_par, 'K1'),
	}
}

// SBDB match without its close approaches, which CAD gives paged and which are most of its size.
type RetainedSearchFound = Omit<SmallBodySearchFound, 'ca_data'>

// Minor body of an SBDB match, with its elements for the local model.
interface ResolvedMinorBody {
	// Public data of the body.
	readonly body: MinorBody
	// Osculating elements; undefined when SBDB does not publish usable ones.
	readonly elements?: MinorBodyElements
	// Match the body came from, for its details.
	readonly found: RetainedSearchFound
	// When the match was read, Unix milliseconds.
	readonly fetchedAt: number
}

// Published text, without the nulls and empty strings of the source.
function published(value: string | null | undefined) {
	return value || undefined
}

// Value of an orbital element, model parameter, or physical parameter as published.
function publishedValue(value: SmallBodySearchOrbitElement | SmallBodySearchModelParameter | SmallBodySearchPhyscalParameter): MinorBodyPublishedValue {
	const parameter = value as Partial<SmallBodySearchPhyscalParameter>
	return { name: value.name, title: value.title.trim(), value: published(value.value), sigma: published(value.sigma), units: published(value.units), reference: published(parameter.ref), notes: published(parameter.notes) }
}

// Orbit solution of an SBDB match as published.
function orbitDetails(orbit: SmallBodySearchOrbit): MinorBodyOrbitDetails {
	return {
		orbitId: orbit.orbit_id,
		epoch: orbit.epoch,
		epochCalendar: orbit.epoch_cd,
		equinox: orbit.equinox,
		solutionDate: orbit.soln_date,
		producer: published(orbit.producer),
		source: orbit.source,
		firstObservation: orbit.first_obs,
		lastObservation: orbit.last_obs,
		dataArc: published(orbit.data_arc),
		observations: orbit.n_obs_used,
		delayObservations: orbit.n_del_obs_used ?? undefined,
		dopplerObservations: orbit.n_dop_obs_used ?? undefined,
		rms: published(orbit.rms),
		conditionCode: published(orbit.condition_code),
		moid: published(orbit.moid),
		moidJupiter: published(orbit.moid_jup),
		tisserandJupiter: published(orbit.t_jup),
		planetaryEphemeris: published(orbit.pe_used),
		smallBodyEphemeris: published(orbit.sb_used),
		comment: published(orbit.comment),
		notValidAfter: published(orbit.not_valid_after),
		elements: orbit.elements.map(publishedValue),
		model: (orbit.model_pars ?? []).map(publishedValue),
	}
}

// Everything SBDB published about a match, read at `fetchedAt` (Unix milliseconds). Rejects with SmallBodyResponseError
// a format of another major version.
export function detailsOf(found: RetainedSearchFound, fetchedAt: number): MinorBodyDetails {
	assertSupportedSignature(found.signature)
	const { object, orbit, discovery, signature } = found

	return {
		alternateDesignations: (object.des_alt ?? []).flatMap((e) => Object.values(e)),
		orbitClassCode: object.orbit_class.code,
		orbit: orbitDetails(orbit),
		alternateOrbits: (found.alt_orbits ?? []).map((e) => ({ orbitId: e.orbit_id, epochCalendar: e.epoch_cd, firstObservation: e.first_obs, lastObservation: e.last_obs })),
		physical: found.phys_par.map(publishedValue),
		discovery: discovery && { date: published(discovery.date), location: published(discovery.location), who: published(discovery.who), narrative: published(discovery.discovery), citation: published(discovery.citation) },
		radar: (found.radar_obs ?? []).map((e) => ({ epoch: e.epoch, value: e.value, sigma: published(e.sigma), units: e.units, frequency: published(e.freq), observer: published(e.observer) })),
		satellites: (found.sat ?? []).map((e) => ({ name: e.fullname ?? e.prov_des ?? '', designation: published(e.prov_des), confirmed: e.confirmed === 'Y', reference: published(e.ref) })),
		virtualImpactors: (found.vi_data ?? []).map((e) => ({ date: e.date, probability: e.ip, palermo: published(e.ps), torino: published(e.ts) })),
		source: signature.source,
		sourceVersion: signature.version,
		fetchedAt,
	}
}

// Converts an SBDB match to the API's minor body.
function resolve({ ca_data: _, ...result }: SmallBodySearchFound, fetchedAt: number): ResolvedMinorBody {
	const { object, orbit } = result
	const parameters = [...orbit.elements.map((e) => ({ name: e.name, title: e.title, value: e.value ?? '', units: e.units ?? undefined })), ...result.phys_par.map((e) => ({ name: e.name, title: e.title, value: e.value, units: e.units ?? undefined }))]

	return {
		body: {
			spkId: object.spkid,
			designation: object.des,
			name: object.fullname,
			kind: object.kind.startsWith('c') ? 'comet' : 'asteroid',
			numbered: object.kind.endsWith('n'),
			neo: object.neo,
			pha: object.pha,
			orbitClass: object.orbit_class.name,
			epoch: finiteNumber(orbit.epoch),
			solutionDate: orbit.soln_date,
			parameters: parameters.filter((e) => e.value !== ''),
		},
		elements: elementsOf(result),
		found: result,
		fetchedAt,
	}
}

// SBDB lookups with a cache of the bodies found, by SPK-ID.
export class MinorBodies {
	readonly #queue: SsdRequestQueue
	readonly #fetch: SbdbFetch
	readonly #timeoutMs: number
	readonly #now: () => number
	readonly #bodies = new Map<string, ResolvedMinorBody>()
	readonly #designations = new LruCache<string>(MINOR_BODY_CACHE_LIMIT)

	// Creates the service; options replace the JPL queue, the SBDB client, its budget, and the clock.
	constructor(options: { readonly queue?: SsdRequestQueue; readonly fetch?: SbdbFetch; readonly timeoutMs?: number; readonly now?: () => number } = {}) {
		const queue = options.queue ?? new SsdRequestQueue()
		this.#queue = queue
		this.#fetch = options.fetch ?? ((text, signal, selector) => fetchSbdb(queue, text, signal, selector))
		this.#timeoutMs = options.timeoutMs ?? SBDB_TIMEOUT_MS
		this.#now = options.now ?? Date.now
	}

	// Searches SBDB by name or designation: one body, several candidates to choose from, or none.
	// Rejects with SbdbUnavailableError when SBDB times out or cannot be reached.
	async search(text: string, signal?: AbortSignal): Promise<MinorBodySearchResponse> {
		const result = await this.#lookup(text, signal)

		if ('object' in result) {
			const resolved = resolve(result, this.#now())
			this.#remember(resolved)
			return { kind: 'found', body: resolved.body }
		}

		if ('list' in result) {
			return { kind: 'ambiguous', matches: result.list.map((e) => ({ designation: e.pdes, name: e.name })) }
		}

		return { kind: 'notFound', message: result.message }
	}

	// Returns a body by SPK-ID from the cache alone, never asking SBDB; undefined when it was not resolved recently.
	cached(spkId: string): ResolvedMinorBody | undefined {
		return this.#bodies.get(spkId)
	}

	// Returns a body by SPK-ID, from the cache or SBDB; undefined when SBDB does not know it.
	async body(spkId: string, signal?: AbortSignal): Promise<ResolvedMinorBody | undefined> {
		const cached = this.#bodies.get(spkId)
		if (cached) return cached

		const result = await this.#lookup(spkId, signal)
		if (!('object' in result)) return undefined

		const resolved = resolve(result, this.#now())
		this.#remember(resolved)
		return resolved
	}

	// Returns what SBDB publishes about a designation or IAU number, from a match of the last hour or from SBDB, sharing
	// the cache of the bodies. A close-approach row names a body exactly, so this never searches names. Rejects with
	// SbdbUnavailableError when SBDB times out or cannot be reached, and with SmallBodyResponseError for a format of
	// another major version.
	async details(designation: string, signal?: AbortSignal): Promise<MinorBodyDetailsResponse> {
		const spkId = this.#designations.get(designation)
		const cached = spkId === undefined ? undefined : this.#bodies.get(spkId)
		if (cached && this.#now() - cached.fetchedAt < DETAILS_TTL_MS) return { kind: 'found', body: cached.body, details: detailsOf(cached.found, cached.fetchedAt) }

		const result = await this.#lookup(designation, signal, 'des')

		if ('object' in result) {
			const resolved = resolve(result, this.#now())
			this.#remember(resolved)
			this.#designations.set(designation, resolved.body.spkId)
			return { kind: 'found', body: resolved.body, details: detailsOf(resolved.found, resolved.fetchedAt) }
		}

		if ('list' in result) return { kind: 'ambiguous', matches: result.list.map((e) => ({ designation: e.pdes, name: e.name })) }
		return { kind: 'notFound', message: result.message }
	}

	// Caches a body, evicting the oldest beyond the limit.
	#remember(resolved: ResolvedMinorBody) {
		this.#bodies.delete(resolved.body.spkId)
		this.#bodies.set(resolved.body.spkId, resolved)
		while (this.#bodies.size > MINOR_BODY_CACHE_LIMIT) this.#bodies.delete(this.#bodies.keys().next().value!)
	}

	// Runs one SBDB lookup in a turn of the JPL queue, within the budget, also aborted by `signal`.
	async #lookup(text: string, signal?: AbortSignal, selector: SbdbSelector = 'sstr'): Promise<SmallBodySearch> {
		try {
			return await this.#queue.run((taskSignal) => this.#fetch(text, taskSignal, selector), { timeoutMs: this.#timeoutMs, signal, key: `sbdb:${selector}:${text}` })
		} catch (error) {
			if (signal?.aborted) throw error
			if (error instanceof SbdbUnavailableError) throw error
			if (error instanceof SsdTimeoutError) throw new SbdbUnavailableError('SBDB did not answer in time', { cause: error })
			if (error instanceof SsdBusyError || error instanceof SsdThrottledError) throw new SbdbUnavailableError(error.message, { cause: error })
			throw new SbdbUnavailableError('SBDB cannot be reached', { cause: error })
		}
	}
}
