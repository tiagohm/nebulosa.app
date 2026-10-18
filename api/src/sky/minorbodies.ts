import { SBD_BASE_URL, SEARCH_PATH, type SmallBodySearch, type SmallBodySearchFound, type SmallBodySearchOrbitElement, type SmallBodySearchPhyscalParameter } from 'nebulosa/src/adapters/orbits/sbd'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import type { MinorBodyElements } from './ephemeris'
import type { MinorBody, MinorBodySearchResponse } from './types'

// Asteroid and comet lookup in the JPL Small-Body Database (SBDB): search by name or designation, the
// identity, classification, orbit, and physical parameters of a body, and its osculating elements for
// the local ephemeris model. Bodies are cached by SPK-ID so positions do not query SBDB again. The
// service is remote, so every request has a timeout and may be aborted.

// Budget of one SBDB request in milliseconds.
export const SBDB_TIMEOUT_MS = 8_000

// Minor bodies kept in memory.
const MINOR_BODY_CACHE_LIMIT = 128

// SBDB did not answer, or answered with an error status.
export class SbdbUnavailableError extends Error {
	// Creates the error.
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'SbdbUnavailableError'
	}
}

// Fetches an SBDB lookup; tests pass a mock.
export type SbdbFetch = (text: string, signal: AbortSignal) => Promise<SmallBodySearch>

// Fetches the SBDB lookup of `text` with the adapter's endpoint and parameters, honoring `signal`.
async function fetchSbdb(text: string, signal: AbortSignal): Promise<SmallBodySearch> {
	const response = await fetch(`${SBD_BASE_URL}${SEARCH_PATH}&sstr=${encodeURIComponent(text)}`, { signal })
	if (!response.ok && response.status !== 300 && response.status !== 404) throw new SbdbUnavailableError(`SBDB answered ${response.status}`)
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

// Minor body of an SBDB match, with its elements for the local model.
interface ResolvedMinorBody {
	// Public data of the body.
	readonly body: MinorBody
	// Osculating elements; undefined when SBDB does not publish usable ones.
	readonly elements?: MinorBodyElements
}

// Converts an SBDB match to the API's minor body.
function resolve(result: SmallBodySearchFound): ResolvedMinorBody {
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
	}
}

// SBDB lookups with a cache of the bodies found, by SPK-ID.
export class MinorBodies {
	readonly #fetch: SbdbFetch
	readonly #timeoutMs: number
	readonly #bodies = new Map<string, ResolvedMinorBody>()

	// Creates the service; options replace the SBDB client and its budget.
	constructor(options: { readonly fetch?: SbdbFetch; readonly timeoutMs?: number } = {}) {
		this.#fetch = options.fetch ?? fetchSbdb
		this.#timeoutMs = options.timeoutMs ?? SBDB_TIMEOUT_MS
	}

	// Searches SBDB by name or designation: one body, several candidates to choose from, or none.
	// Rejects with SbdbUnavailableError when SBDB times out or cannot be reached.
	async search(text: string, signal?: AbortSignal): Promise<MinorBodySearchResponse> {
		const result = await this.#lookup(text, signal)

		if ('object' in result) {
			const resolved = resolve(result)
			this.#remember(resolved)
			return { kind: 'found', body: resolved.body }
		}

		if ('list' in result) {
			return { kind: 'ambiguous', matches: result.list.map((e) => ({ designation: e.pdes, name: e.name })) }
		}

		return { kind: 'notFound', message: result.message }
	}

	// Returns a body by SPK-ID, from the cache or SBDB; undefined when SBDB does not know it.
	async body(spkId: string, signal?: AbortSignal): Promise<ResolvedMinorBody | undefined> {
		const cached = this.#bodies.get(spkId)
		if (cached) return cached

		const result = await this.#lookup(spkId, signal)
		if (!('object' in result)) return undefined

		const resolved = resolve(result)
		this.#remember(resolved)
		return resolved
	}

	// Caches a body, evicting the oldest beyond the limit.
	#remember(resolved: ResolvedMinorBody) {
		this.#bodies.delete(resolved.body.spkId)
		this.#bodies.set(resolved.body.spkId, resolved)
		while (this.#bodies.size > MINOR_BODY_CACHE_LIMIT) this.#bodies.delete(this.#bodies.keys().next().value!)
	}

	// Runs one SBDB lookup within the budget, also aborted by `signal`.
	async #lookup(text: string, signal?: AbortSignal): Promise<SmallBodySearch> {
		const timeout = AbortSignal.timeout(this.#timeoutMs)
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

		try {
			return await this.#fetch(text, combined)
		} catch (error) {
			if (signal?.aborted) throw error
			if (error instanceof SbdbUnavailableError) throw error
			throw new SbdbUnavailableError(timeout.aborted ? 'SBDB did not answer in time' : 'SBDB cannot be reached', { cause: error })
		}
	}
}
