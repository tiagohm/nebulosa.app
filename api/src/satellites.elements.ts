import { type ElementSetError, type OMM, parseTLE, tleCatalogNumber, validateOMM, validateTLE } from 'nebulosa/src/astronomy/orbits/propagation/sgp4'
import type { SatelliteCatalogMetadata, SatelliteObjectType } from './satellites.store'

// Normalization of the element sets and catalog records that enter the satellite catalog: CelesTrak GP and SATCAT JSON,
// and the OMM JSON or TLE text an operator imports. Every element set is validated by the toolkit once, here, and
// rewritten as a canonical OMM (CCSDS keywords, numbers as numbers, NORAD_CAT_ID as a canonical decimal string) whose
// SHA-256 is its identity. Records that fail are left out and reported, never stored.

// OMM keywords kept in a canonical element set, in the order they are written: the elements SGP4 needs and the
// metadata that identify them. Any other keyword of the source is dropped.
const OMM_TEXT_KEYS = ['OBJECT_NAME', 'OBJECT_ID', 'CENTER_NAME', 'REF_FRAME', 'TIME_SYSTEM', 'MEAN_ELEMENT_THEORY', 'EPOCH', 'CLASSIFICATION_TYPE'] as const

// Numeric OMM keywords of a canonical element set, written as numbers.
const OMM_NUMBER_KEYS = ['MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'EPHEMERIS_TYPE', 'ELEMENT_SET_NO', 'REV_AT_EPOCH', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'] as const

// Matches an OMM epoch: date, time, an optional fraction of second of any length, an optional Z.
const EPOCH_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z?$/

// SATCAT object type codes.
const OBJECT_TYPES: Readonly<Record<string, SatelliteObjectType>> = { PAY: 'payload', 'R/B': 'rocketBody', DEB: 'debris', UNK: 'unknown' }

// Why a record was left out: a toolkit validation failure, or a record that is not an object with a catalog number.
export type SatelliteRecordError = ElementSetError | 'malformed'

// Element set ready to be stored.
export interface NormalizedElements {
	// NORAD catalog number, canonical decimal digits.
	readonly noradId: string
	// Name of the object, the catalog number when the source gives none.
	readonly name: string
	// International designator; absent when the source gives none.
	readonly cosparId?: string
	// Epoch, Unix milliseconds (UTC), rounded to the millisecond.
	readonly epoch: number
	// Canonical OMM.
	readonly omm: OMM
	// SHA-256 of the canonical OMM, lowercase hexadecimal.
	readonly digest: string
}

// SATCAT record ready to be stored.
export interface NormalizedCatalogRecord {
	// NORAD catalog number, canonical decimal digits.
	readonly noradId: string
	// Name of the object.
	readonly name: string
	// International designator; absent when the catalog gives none.
	readonly cosparId?: string
	// Published metadata.
	readonly catalog: SatelliteCatalogMetadata
}

// Record left out of a batch, by its position in the source (from 0) and why.
export interface RejectedRecord {
	// Position of the record in the source: the index of a JSON element, or the first line of a TLE (from 0).
	readonly index: number
	// Catalog number when it could be read.
	readonly noradId?: string
	// Why it was left out.
	readonly error: SatelliteRecordError
}

// Outcome of normalizing a batch.
export interface NormalizedBatch<T> {
	// Records accepted, in source order; a later record of the same catalog number replaces an earlier one.
	readonly records: readonly T[]
	// Records left out.
	readonly rejected: readonly RejectedRecord[]
}

// Returns a non-blank trimmed string field; undefined otherwise.
function text(value: unknown) {
	if (typeof value === 'string') {
		const trimmed = value.trim()
		return trimmed || undefined
	}

	return undefined
}

// Returns a finite number from a number or a numeric string; undefined otherwise.
function finite(value: unknown) {
	const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? +value : Number.NaN
	return Number.isFinite(number) ? number : undefined
}

// Returns the canonical decimal NORAD id of a field given as digits or a number; undefined otherwise.
function noradIdOf(value: unknown) {
	const digits = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? `${value}` : text(value)
	return digits && /^\d+$/.test(digits) ? digits.replace(/^0+(?=\d)/, '') : undefined
}

// Unix milliseconds (UTC) of an OMM epoch, rounded to the millisecond; NaN when it cannot be read.
export function ommEpochMillis(epoch: string) {
	const match = EPOCH_REGEX.exec(epoch.trim())
	if (!match) return Number.NaN
	const [, year, month, day, hour, minute, second, fraction = '0'] = match
	return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second) + Math.round(+`0.${fraction}` * 1000)
}

// SHA-256 of a canonical OMM, lowercase hexadecimal. The keys are written in the canonical order, so equal elements
// always have equal digests.
export function ommDigest(omm: OMM) {
	return new Bun.CryptoHasher('sha256').update(JSON.stringify(omm)).digest('hex')
}

// Rewrites an OMM-like record as a canonical OMM; undefined when it is not an object.
function canonicalOmm(record: unknown): OMM | undefined {
	if (typeof record !== 'object' || record === null || Array.isArray(record)) return undefined
	const source = record as Readonly<Record<string, unknown>>
	const omm: Record<string, unknown> = {}

	for (const key of OMM_TEXT_KEYS) {
		const value = text(source[key])
		if (value !== undefined) omm[key] = value
	}

	const noradId = noradIdOf(source.NORAD_CAT_ID)
	omm.NORAD_CAT_ID = noradId ?? source.NORAD_CAT_ID

	for (const key of OMM_NUMBER_KEYS) {
		const value = source[key]
		if (value === undefined || value === null || value === '') continue
		omm[key] = finite(value) ?? value
	}

	return omm as unknown as OMM
}

// Normalizes and validates one OMM-like record.
function normalizeOmm(record: unknown): NormalizedElements | SatelliteRecordError {
	const omm = canonicalOmm(record)
	if (!omm) return 'malformed'
	const error = validateOMM(omm)
	if (error) return error
	const noradId = omm.NORAD_CAT_ID as string
	return { noradId, name: omm.OBJECT_NAME ?? noradId, cosparId: omm.OBJECT_ID, epoch: ommEpochMillis(omm.EPOCH), omm, digest: ommDigest(omm) }
}

// Normalizes a list of OMM-like records, such as a CelesTrak GP JSON answer or an imported OMM file. Records that fail
// validation are rejected with their reason.
export function normalizeOmmRecords(records: readonly unknown[]): NormalizedBatch<NormalizedElements> {
	const accepted = new Map<string, NormalizedElements>()
	const rejected: RejectedRecord[] = []

	for (let index = 0; index < records.length; index++) {
		const result = normalizeOmm(records[index])
		if (typeof result === 'string') rejected.push({ index, noradId: noradIdOf((records[index] as Record<string, unknown> | null)?.NORAD_CAT_ID), error: result })
		else accepted.set(result.noradId, result)
	}

	return { records: [...accepted.values()], rejected }
}

// Normalizes a CelesTrak SATCAT JSON answer. Fields the catalog leaves null or blank stay absent; a record without a
// catalog number or name is rejected as malformed.
export function normalizeSatcatRecords(records: readonly unknown[]): NormalizedBatch<NormalizedCatalogRecord> {
	const accepted = new Map<string, NormalizedCatalogRecord>()
	const rejected: RejectedRecord[] = []

	for (let index = 0; index < records.length; index++) {
		const record = records[index]
		const source = typeof record === 'object' && record !== null ? (record as Readonly<Record<string, unknown>>) : {}
		const noradId = noradIdOf(source.NORAD_CAT_ID)
		const name = text(source.OBJECT_NAME)

		if (!noradId || !name) {
			rejected.push({ index, noradId, error: 'malformed' })
			continue
		}

		const objectType = OBJECT_TYPES[text(source.OBJECT_TYPE) ?? '']
		const catalog: SatelliteCatalogMetadata = {
			objectType,
			opsStatus: text(source.OPS_STATUS_CODE),
			owner: text(source.OWNER),
			launchDate: text(source.LAUNCH_DATE),
			decayDate: text(source.DECAY_DATE),
			orbitCenter: text(source.ORBIT_CENTER),
			orbitType: text(source.ORBIT_TYPE),
			periodMinutes: finite(source.PERIOD),
			apogeeKm: finite(source.APOGEE),
			perigeeKm: finite(source.PERIGEE),
		}

		accepted.set(noradId, { noradId, name, cosparId: text(source.OBJECT_ID), catalog })
	}

	return { records: [...accepted.values()], rejected }
}

// Converts the epoch of a TLE (two-digit year and 1-based fractional day of year) to an OMM epoch with microseconds.
function tleEpoch(epochYear: number, epochDays: number) {
	const year = epochYear < 57 ? epochYear + 2000 : epochYear + 1900
	const micros = Math.round((epochDays - 1) * 86_400_000_000)
	const date = new Date(Date.UTC(year, 0, 1) + Math.floor(micros / 1000))
	return `${date.toISOString().slice(0, 19)}.${`${micros % 1_000_000}`.padStart(6, '0')}`
}

// Converts two validated TLE lines (and a name) to an OMM-like record. Angles and the mean motion are read from the
// columns as published, so no unit is converted back and forth.
function tleRecord(line1: string, line2: string, name: string | undefined) {
	const tle = parseTLE(line1, line2, name)
	const year = +line1.slice(9, 11)
	const launch = line1.slice(11, 14).trim()
	const piece = line1.slice(14, 17).trim()
	const cosparId = launch ? `${year < 57 ? 2000 + year : 1900 + year}-${launch}${piece}` : undefined

	return {
		OBJECT_NAME: name,
		OBJECT_ID: cosparId,
		EPOCH: tleEpoch(tle.epochYear, tle.epochDays),
		MEAN_MOTION: +line2.slice(52, 63),
		ECCENTRICITY: tle.eccentricity,
		INCLINATION: +line2.slice(8, 16),
		RA_OF_ASC_NODE: +line2.slice(17, 25),
		ARG_OF_PERICENTER: +line2.slice(34, 42),
		MEAN_ANOMALY: +line2.slice(43, 51),
		EPHEMERIS_TYPE: 0,
		CLASSIFICATION_TYPE: line1[7] === 'C' ? 'C' : 'U',
		NORAD_CAT_ID: tleCatalogNumber(tle.satelliteNumber),
		ELEMENT_SET_NO: +line1.slice(64, 68) || 0,
		REV_AT_EPOCH: tle.revolutionNumberAtEpoch,
		BSTAR: tle.bstar,
		MEAN_MOTION_DOT: tle.meanMotionDot,
		MEAN_MOTION_DDOT: tle.meanMotionDdot,
	}
}

// Normalizes text an operator imports: an OMM JSON object or array, or TLE sets of two lines each optionally preceded by
// a name line (with or without the "0 " of the three-line form). Alpha-5 catalog numbers are converted to decimal.
// Returns undefined when the text is neither JSON nor holds a TLE.
export function normalizeImport(input: string): NormalizedBatch<NormalizedElements> | undefined {
	const trimmed = input.trim()

	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const parsed: unknown = JSON.parse(trimmed)
			return normalizeOmmRecords(Array.isArray(parsed) ? parsed : [parsed])
		} catch {
			return undefined
		}
	}

	const lines = input.split(/\r?\n/).map((line) => line.trimEnd())
	const accepted = new Map<string, NormalizedElements>()
	const rejected: RejectedRecord[] = []
	let found = false

	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].startsWith('1 ')) continue
		found = true
		const line1 = lines[i]
		const line2 = lines[i + 1] ?? ''
		const previous = i > 0 ? lines[i - 1].trim() : ''
		const name = previous && !previous.startsWith('2 ') ? previous.replace(/^0 /, '').trim() || undefined : undefined
		const index = name ? i - 1 : i
		const error = validateTLE(line1, line2)

		if (error) {
			rejected.push({ index, noradId: tleCatalogNumber(line1.slice(2, 7)), error })
			continue
		}

		const result = normalizeOmm(tleRecord(line1, line2, name))
		if (typeof result === 'string') rejected.push({ index, error: result })
		else accepted.set(result.noradId, result)
		i++
	}

	return found ? { records: [...accepted.values()], rejected } : undefined
}
