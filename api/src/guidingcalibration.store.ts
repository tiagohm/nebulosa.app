import type { PierSide } from 'nebulosa/src/devices/indi/device'
import type { GuidingCalibrationAssessment, GuidingCalibrationQuality } from 'nebulosa/src/observation/guiding/calibration.quality'
import { validateGuidingCalibrationRecord } from 'nebulosa/src/observation/guiding/calibration.transform'
import type { AppDatabase } from './database'
import { equipmentKeyOf, type GuidingCalibrationEntry, type GuidingCalibrationEvidence, type StoredGuidingCalibration } from './guidingcalibration'

// Completed guiding calibrations, persisted in the operational database (guiding_calibrations). A row is written once,
// when a calibration completes, and never edited but for its disabled flag and its last use; a recalibration adds a row.
// The payload holds the source record of the toolkit (with the review of the measured steps), the evidence of the
// equipment and geometry, and the quality assessment, and is validated by the toolkit whenever it is read, so a row
// that cannot be trusted is listed as invalid and never restored. Only the newest MAX_GUIDING_CALIBRATIONS rows of each
// equipment are kept.

// Rows kept per equipment key, the newest; adding one deletes the older ones.
export const MAX_GUIDING_CALIBRATIONS = 25

// Version of the payload shape.
export const GUIDING_CALIBRATION_PAYLOAD_VERSION = 1

// Payload of a row.
interface GuidingCalibrationPayload {
	readonly record: StoredGuidingCalibration['record']
	readonly evidence: GuidingCalibrationEvidence
	readonly assessment: GuidingCalibrationAssessment
}

// Summary of a saved calibration, without its measurements.
export interface GuidingCalibrationHeader {
	readonly calibrationId: string
	// When it completed, Unix milliseconds (UTC).
	readonly createdAt: number
	readonly equipmentKey: string
	readonly cameraName: string
	readonly guideOutputName: string
	readonly mountName?: string
	// Declination of the mount when it was measured, in radians; absent when unknown.
	readonly sourceDeclination?: number
	// Side of the pier the mount reported; absent when unknown.
	readonly sourcePierSide?: PierSide
	readonly quality: GuidingCalibrationQuality
	readonly disabled: boolean
	// When a session last restored it, Unix milliseconds (UTC).
	readonly lastUsedAt?: number
}

// Row of guiding_calibrations.
interface GuidingCalibrationRow {
	readonly calibration_id: string
	readonly created_at: number
	readonly equipment_key: string
	readonly camera_name: string
	readonly guide_output_name: string
	readonly mount_name: string | null
	readonly source_declination: number | null
	readonly source_pier_side: PierSide | null
	readonly quality: GuidingCalibrationQuality
	readonly disabled: number
	readonly last_used_at: number | null
	readonly payload_version: number
	readonly payload: string
}

// Columns of a header.
const HEADER_COLUMNS = 'calibration_id, created_at, equipment_key, camera_name, guide_output_name, mount_name, source_declination, source_pier_side, quality, disabled, last_used_at'

// Saved guiding calibrations.
export class GuidingCalibrationStore {
	// Creates the store of the calibrations in database.
	constructor(readonly database: AppDatabase) {}

	// Saves a completed calibration and deletes the older ones of its equipment beyond MAX_GUIDING_CALIBRATIONS, in one
	// transaction. Throws when the database cannot be written; nothing is saved then.
	insert(calibration: Omit<StoredGuidingCalibration, 'status' | 'disabled' | 'lastUsedAt'>) {
		const { calibrationId, createdAt, record, evidence, assessment } = calibration
		const equipmentKey = equipmentKeyOf(evidence)
		const payload: GuidingCalibrationPayload = { record, evidence, assessment }

		this.database.write(() => {
			this.database.db
				.query(`INSERT INTO guiding_calibrations (${HEADER_COLUMNS}, payload_version, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`)
				.run(calibrationId, createdAt, equipmentKey, evidence.camera.name, evidence.guideOutput.name, evidence.mount?.name ?? null, record.context.declination ?? null, record.context.pierSide ?? null, assessment.quality, GUIDING_CALIBRATION_PAYLOAD_VERSION, JSON.stringify(payload))
			this.database.db.query('DELETE FROM guiding_calibrations WHERE equipment_key = ?1 AND calibration_id NOT IN (SELECT calibration_id FROM guiding_calibrations WHERE equipment_key = ?1 ORDER BY created_at DESC LIMIT ?2)').run(equipmentKey, MAX_GUIDING_CALIBRATIONS)
		})
	}

	// Returns the headers of the saved calibrations, newest first: of one equipment when given, at most limit.
	list(equipmentKey: string | undefined, limit: number): GuidingCalibrationHeader[] {
		const rows =
			equipmentKey === undefined
				? this.database.db.query<GuidingCalibrationRow, [number]>(`SELECT ${HEADER_COLUMNS} FROM guiding_calibrations ORDER BY created_at DESC LIMIT ?`).all(limit)
				: this.database.db.query<GuidingCalibrationRow, [string, number]>(`SELECT ${HEADER_COLUMNS} FROM guiding_calibrations WHERE equipment_key = ? ORDER BY created_at DESC LIMIT ?`).all(equipmentKey, limit)
		return rows.map(headerOf)
	}

	// Returns a saved calibration with its payload read back, or undefined when there is none with this id.
	get(calibrationId: string): GuidingCalibrationEntry | undefined {
		const row = this.database.db.query<GuidingCalibrationRow, [string]>(`SELECT ${HEADER_COLUMNS}, payload_version, payload FROM guiding_calibrations WHERE calibration_id = ?`).get(calibrationId)
		return row ? entryOf(row) : undefined
	}

	// Returns the saved calibrations of one equipment with their payloads read back, newest first.
	entries(equipmentKey: string): GuidingCalibrationEntry[] {
		return this.database.db.query<GuidingCalibrationRow, [string]>(`SELECT ${HEADER_COLUMNS}, payload_version, payload FROM guiding_calibrations WHERE equipment_key = ? ORDER BY created_at DESC`).all(equipmentKey).map(entryOf)
	}

	// Excludes a calibration from restoring, or includes it again. Returns whether it exists.
	setDisabled(calibrationId: string, disabled: boolean) {
		return this.database.db.query('UPDATE guiding_calibrations SET disabled = ? WHERE calibration_id = ?').run(disabled ? 1 : 0, calibrationId).changes > 0
	}

	// Records that a session restored a calibration at time, Unix milliseconds (UTC).
	touch(calibrationId: string, time: number) {
		this.database.db.query('UPDATE guiding_calibrations SET last_used_at = ? WHERE calibration_id = ?').run(time, calibrationId)
	}
}

// Header of a row.
function headerOf(row: GuidingCalibrationRow): GuidingCalibrationHeader {
	return {
		calibrationId: row.calibration_id,
		createdAt: row.created_at,
		equipmentKey: row.equipment_key,
		cameraName: row.camera_name,
		guideOutputName: row.guide_output_name,
		...(row.mount_name !== null && { mountName: row.mount_name }),
		...(row.source_declination !== null && { sourceDeclination: row.source_declination }),
		...(row.source_pier_side !== null && { sourcePierSide: row.source_pier_side }),
		quality: row.quality,
		disabled: row.disabled === 1,
		...(row.last_used_at !== null && { lastUsedAt: row.last_used_at }),
	}
}

// Entry of a row: its payload parsed and its record validated by the toolkit, or invalid with the reason.
function entryOf(row: GuidingCalibrationRow): GuidingCalibrationEntry {
	const base = { calibrationId: row.calibration_id, createdAt: row.created_at, disabled: row.disabled === 1 }
	if (row.payload_version !== GUIDING_CALIBRATION_PAYLOAD_VERSION) return { ...base, status: 'invalid', reason: `unsupported payload version ${row.payload_version}` }

	let payload: Partial<GuidingCalibrationPayload>

	try {
		payload = JSON.parse(row.payload) as Partial<GuidingCalibrationPayload>
	} catch (error) {
		return { ...base, status: 'invalid', reason: Error.isError(error) ? error.message : String(error) }
	}

	const validated = validateGuidingCalibrationRecord(payload.record)
	if (!validated.ok) return { ...base, status: 'invalid', reason: validated.reason }
	if (payload.evidence === undefined || payload.assessment === undefined) return { ...base, status: 'invalid', reason: 'the payload has no evidence or assessment' }

	return { ...base, status: 'valid', ...(row.last_used_at !== null && { lastUsedAt: row.last_used_at }), record: validated.record, evidence: payload.evidence, assessment: payload.assessment }
}
