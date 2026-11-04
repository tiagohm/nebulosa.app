import type { SatelliteProvider } from './satellites.store'

// CelesTrak adapter of the satellite catalog: the queries the server may send, as an allowlist, and one guarded HTTP
// request. Requests go to the fixed host https://celestrak.org, always ask for JSON, never follow a redirect (CelesTrak
// answers a wrong host or a legacy query with a 301, which counts against the client), and name the client in their
// User-Agent. No URL or query value is ever taken from a request. The fair-use rules live in satellites.sync.ts.

// Host of every request.
export const CELESTRAK_ORIGIN = 'https://celestrak.org'

// Repository named as the contact of the client in its User-Agent.
const CLIENT_CONTACT = 'https://github.com/tiagohm/nebulosa.app'

// Limit of one download, in milliseconds. The largest groups are several megabytes.
const CELESTRAK_TIMEOUT_MS = 60_000

// Limit of the body of one answer, in bytes: about four times the largest group (ACTIVE) in JSON.
const CELESTRAK_MAX_BYTES = 48 * 1024 * 1024

// Groups of the CelesTrak current data that can be downloaded, by their GROUP value. `large` marks those of thousands
// of objects, whose SATCAT is never downloaded along with their elements.
export const CELESTRAK_GROUPS = [
	{ group: 'STATIONS', label: 'Space stations' },
	{ group: 'VISUAL', label: '100 (or so) brightest' },
	{ group: 'LAST-30-DAYS', label: 'Launched in the last 30 days' },
	{ group: 'ACTIVE', label: 'Active satellites', large: true },
	{ group: 'STARLINK', label: 'Starlink', large: true },
	{ group: 'ONEWEB', label: 'OneWeb', large: true },
	{ group: 'IRIDIUM-NEXT', label: 'Iridium NEXT' },
	{ group: 'GNSS', label: 'GNSS' },
	{ group: 'GPS-OPS', label: 'GPS operational' },
	{ group: 'GLO-OPS', label: 'GLONASS operational' },
	{ group: 'GALILEO', label: 'Galileo' },
	{ group: 'BEIDOU', label: 'BeiDou' },
	{ group: 'GEO', label: 'Geostationary' },
	{ group: 'WEATHER', label: 'Weather' },
	{ group: 'NOAA', label: 'NOAA' },
	{ group: 'GOES', label: 'GOES' },
	{ group: 'SCIENCE', label: 'Space and Earth science' },
	{ group: 'AMATEUR', label: 'Amateur radio' },
	{ group: 'CUBESAT', label: 'CubeSats' },
] as const satisfies readonly { readonly group: string; readonly label: string; readonly large?: boolean }[]

// GROUP value of an allowlisted group.
export type CelestrakGroup = (typeof CELESTRAK_GROUPS)[number]['group']

// Query parameter of a source.
export type CelestrakQueryType = 'GROUP' | 'CATNR'

// Query a source key names.
export interface CelestrakQuery {
	// Source key, such as gp:GROUP:STATIONS or satcat:CATNR:25544.
	readonly sourceKey: string
	// Dataset read.
	readonly provider: SatelliteProvider
	// Query parameter.
	readonly type: CelestrakQueryType
	// Query value: an allowlisted group, or a canonical NORAD id.
	readonly value: string
	// Whether the group has thousands of objects.
	readonly large: boolean
}

// Answer of CelesTrak.
export type CelestrakAnswer =
	// Records of the query, possibly none.
	| { readonly status: 'ok'; readonly records: readonly unknown[] }
	// An answer other than 200: the status, the delay CelesTrak asked for in milliseconds, and its message.
	| { readonly status: 'refused'; readonly httpStatus: number; readonly retryAfter?: number; readonly message: string }
	// No answer: unreachable, timed out, or a body too large.
	| { readonly status: 'unreachable'; readonly message: string }
	// A 200 answer that is not the JSON of a list of records.
	| { readonly status: 'invalid'; readonly message: string }

// Fetch of a URL, injectable in tests.
export type CelestrakFetch = (url: string, init: RequestInit) => Promise<Response>

// Allowlisted group of a GROUP value, case ignored.
function allowlistedGroup(value: string) {
	const upper = value.toUpperCase()
	return CELESTRAK_GROUPS.find((entry) => entry.group === upper)
}

// Source key of a query.
export function celestrakSourceKey(provider: SatelliteProvider, type: CelestrakQueryType, value: string) {
	return `${provider}:${type}:${type === 'GROUP' ? value.toUpperCase() : value}`
}

// Parses a source key into its query; undefined when the key names no allowlisted query.
export function parseCelestrakSourceKey(sourceKey: string): CelestrakQuery | undefined {
	const [provider, type, value, ...rest] = sourceKey.split(':')
	if (rest.length > 0 || (provider !== 'gp' && provider !== 'satcat') || !value) return undefined

	if (type === 'GROUP') {
		const entry = allowlistedGroup(value)
		return entry ? { sourceKey: celestrakSourceKey(provider, type, entry.group), provider, type, value: entry.group, large: 'large' in entry && entry.large } : undefined
	}

	if (type === 'CATNR' && /^[1-9]\d{0,8}$/.test(value)) return { sourceKey, provider, type, value, large: false }
	return undefined
}

// URL of a query: GP element sets or SATCAT records, as JSON.
export function celestrakUrl(query: CelestrakQuery) {
	const path = query.provider === 'gp' ? '/NORAD/elements/gp.php' : '/satcat/records.php'
	return `${CELESTRAK_ORIGIN}${path}?${query.type}=${encodeURIComponent(query.value)}&FORMAT=JSON`
}

// User-Agent of the requests to CelesTrak; the version is that of the distribution when the app named it.
export function celestrakUserAgent(version?: string) {
	return version ? `Nebulosa/${version} (+${CLIENT_CONTACT})` : `Nebulosa (+${CLIENT_CONTACT})`
}

// Delay a Retry-After header asks for, in milliseconds: seconds or an HTTP date; undefined when absent or unreadable.
function retryAfter(header: string | null, now: number) {
	if (!header) return undefined
	const seconds = Number(header)
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
	const date = Date.parse(header)
	return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

// Reads a body up to CELESTRAK_MAX_BYTES; undefined when it is larger.
async function readBody(response: Response) {
	const reader = (response.body ?? new Blob().stream()).getReader()
	const chunks: Uint8Array[] = []
	let length = 0

	for (let result = await reader.read(); !result.done; result = await reader.read()) {
		length += result.value.length

		if (length > CELESTRAK_MAX_BYTES) {
			await reader.cancel()
			return undefined
		}

		chunks.push(result.value)
	}

	return new TextDecoder().decode(Buffer.concat(chunks))
}

// Sends one query to CelesTrak and classifies the answer. A 200 answer whose text says nothing matched (CelesTrak
// answers a query without data with a short message instead of an empty list) is an empty list. Never throws.
export async function fetchCelestrak(fetch: CelestrakFetch, query: CelestrakQuery, userAgent: string, now: number): Promise<CelestrakAnswer> {
	const url = celestrakUrl(query)
	const signal = AbortSignal.timeout(CELESTRAK_TIMEOUT_MS)
	let response: Response

	try {
		response = await fetch(url, { signal, redirect: 'manual', headers: { 'User-Agent': userAgent, Accept: 'application/json' } })
	} catch {
		return { status: 'unreachable', message: signal.aborted ? `${url} timed out` : `${url} is unreachable` }
	}

	if (response.status !== 200) {
		const message = (await response.text().catch(() => '')).trim().slice(0, 200) || `answered ${response.status}`
		return { status: 'refused', httpStatus: response.status, retryAfter: retryAfter(response.headers.get('Retry-After'), now), message }
	}

	let body: string | undefined

	try {
		body = await readBody(response)
	} catch {
		return { status: 'unreachable', message: `${url} could not be read` }
	}

	if (body === undefined) return { status: 'unreachable', message: `${url} is larger than ${CELESTRAK_MAX_BYTES} bytes` }

	const trimmed = body.trim()
	if (/^no .*(data|records?) found/i.test(trimmed)) return { status: 'ok', records: [] }

	try {
		const parsed: unknown = JSON.parse(trimmed)
		if (Array.isArray(parsed)) return { status: 'ok', records: parsed }
	} catch {
		// Not JSON: reported below.
	}

	return { status: 'invalid', message: `${url} did not answer a JSON list` }
}
