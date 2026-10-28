import { LUNAR_ELONGATED_DESCRIPTORS, LUNAR_FEATURE_DESCRIPTOR_CATEGORIES, LUNAR_FEATURE_ELONGATED, LUNAR_FEATURE_SATELLITE, LUNAR_SATELLITE_DESCRIPTOR, type LunarFeatureRow } from 'api/sky/moon.features'

// Normalization of the USGS Gazetteer's Moon center points (the attribute table of
// MOON_nomenclature_center_pts) into the rows of the lunar surface feature catalog, with an audit of
// every record left out and why. The table's coordinates are planetocentric degrees on the Moon 2000
// sphere with east longitude in [0, 360); they are converted to [-180, 180) here, once. Only names whose
// status is APPROVED_STATUS are kept; a status or descriptor the generator does not know fails the whole
// run, so a change of the source is looked at instead of silently changing the catalog.

// Approval status of a name the IAU adopted, as the Gazetteer writes it.
export const APPROVED_STATUS = 'Adopted by IAU'

// Approval statuses that are known and deliberately left out (none appear in the center-point archive today).
const EXCLUDED_STATUSES: ReadonlySet<string> = new Set(['Dropped, disallowed', 'Never approved by the IAU', 'Proposed'])

// Gazetteer feature link, whose last path segment is the feature id.
const FEATURE_LINK = /^https?:\/\/planetarynames\.wr\.usgs\.gov\/Feature\/(\d+)$/

// Why a record was left out of the catalog.
export type LunarFeatureRejection = 'notApproved' | 'missingId' | 'missingName' | 'missingCoordinates' | 'duplicateId' | 'duplicateName'

// A record left out of the catalog.
export interface LunarFeatureRejected {
	// Name in the source, possibly empty.
	readonly name: string
	// Gazetteer link in the source, possibly empty.
	readonly link: string
	// Why it was left out.
	readonly reason: LunarFeatureRejection
}

// Source-to-output audit of a normalization.
export interface LunarFeatureAudit {
	// Records read from the source.
	readonly records: number
	// Rows written to the catalog.
	readonly features: number
	// Rows per descriptor.
	readonly descriptors: Readonly<Record<string, number>>
	// Records left out.
	readonly rejected: readonly LunarFeatureRejected[]
}

// Rows of the catalog and the audit of how they were made.
export interface LunarFeatureNormalization {
	// Rows sorted by id.
	readonly rows: readonly LunarFeatureRow[]
	// Audit of the normalization.
	readonly audit: LunarFeatureAudit
}

// Returns a finite number from a numeric field, or undefined for an empty or non-numeric one.
function numberOf(text: string | undefined) {
	if (!text) return undefined
	const value = +text
	return Number.isFinite(value) ? value : undefined
}

// Returns an east longitude in degrees in [-180, 180).
export function normalizeLongitude(degrees: number) {
	const value = ((((degrees + 180) % 360) + 360) % 360) - 180
	return value === 180 ? -180 : value
}

// Normalizes the attribute records of the Gazetteer's Moon center points into catalog rows; throws on an
// approval status or descriptor the generator does not know.
export function normalizeLunarFeatures(records: readonly Readonly<Record<string, string>>[]): LunarFeatureNormalization {
	const rows: LunarFeatureRow[] = []
	const rejected: LunarFeatureRejected[] = []
	const ids = new Set<number>()
	const names = new Set<string>()
	const descriptors: Record<string, number> = {}

	for (const record of records) {
		const name = record.name ?? ''
		const link = record.link ?? ''
		const status = record.approval ?? ''
		const descriptor = record.type ?? ''
		const reject = (reason: LunarFeatureRejection) => rejected.push({ name, link, reason })

		if (status !== APPROVED_STATUS) {
			if (!EXCLUDED_STATUSES.has(status)) throw new Error(`unknown approval status "${status}" of ${name}`)
			reject('notApproved')
			continue
		}

		const category = LUNAR_FEATURE_DESCRIPTOR_CATEGORIES[descriptor]
		if (category === undefined) throw new Error(`unknown descriptor "${descriptor}" of ${name}`)

		const id = FEATURE_LINK.exec(link)?.[1]
		const latitude = numberOf(record.center_lat)
		const longitude = numberOf(record.center_lon)

		if (!id) reject('missingId')
		else if (!name) reject('missingName')
		else if (latitude === undefined || longitude === undefined || Math.abs(latitude) > 90) reject('missingCoordinates')
		else if (ids.has(+id)) reject('duplicateId')
		else if (names.has(name)) reject('duplicateName')
		else {
			const diameter = numberOf(record.diameter)
			const year = numberOf(record.approvaldt?.slice(0, 4))
			const flags = (descriptor === LUNAR_SATELLITE_DESCRIPTOR ? LUNAR_FEATURE_SATELLITE : 0) | (LUNAR_ELONGATED_DESCRIPTORS.has(descriptor) ? LUNAR_FEATURE_ELONGATED : 0)
			ids.add(+id)
			names.add(name)
			descriptors[descriptor] = (descriptors[descriptor] ?? 0) + 1
			rows.push([+id, name, descriptor, category, flags, round(latitude), round(normalizeLongitude(longitude)), diameter !== undefined && diameter > 0 ? round(diameter) : null, year ?? null, record.origin || null])
		}
	}

	rows.sort((a, b) => a[0] - b[0])
	return { rows, audit: { records: records.length, features: rows.length, descriptors, rejected } }
}

// Rounds a coordinate in degrees or a dimension in km to 4 decimals (about 3 m on the Moon), the
// precision kept in the catalog.
function round(value: number) {
	return Math.round(value * 1e4) / 1e4
}
