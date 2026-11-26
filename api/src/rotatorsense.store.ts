import type { Parity } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { Camera, Rotator } from 'nebulosa/src/devices/indi/device'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { AppDatabase } from './database'

// Learned senses of camera rotators, persisted in the operational database (rotator_senses), so a later session, whoever
// admits it (a tab, the Meridian Flip Executor, a future Sequencer), turns the rotator the right way at once. A sense
// belongs to a physical camera, a physical rotator, and the reverse switch of the rotator, and is learned only from a
// check that passed: the response of the field to a rotation (positionAngle, Target Centering), or the motion of the
// guide star after a rotation (guideImage, guiding). Learning again replaces the row; a row learned with another driver
// of the rotator is ignored. A main camera's row also keeps the offset φ of its position angle (θ = s·M + φ), modulo
// a half turn, which a Center verifying an orientation measures and a later one pre-rotates with.

// What a sense describes: the sky position angle of the image top of a main camera per mechanical degree, or the turn
// of the image of a guide camera behind the rotator per mechanical degree.
export type RotatorSenseKind = 'positionAngle' | 'guideImage'

// A stored sense.
export interface StoredRotatorSense {
	// +1 when the image turns with the mechanical angle in the positive sense of its kind, −1 otherwise.
	readonly sense: 1 | -1
	// Parity of the frames it was learned from; absent when unknown.
	readonly parity?: Parity
	// Turn of the image per commanded turn measured by the check that learned it; absent when unknown.
	readonly gain?: number
	// Offset of the position angle of the image top (positionAngle only): PA minus sense times the mechanical angle, in
	// degrees within [0, 180); absent until a Center verified an orientation with this sense.
	readonly offset?: number
	// When it was learned, Unix milliseconds (UTC).
	readonly learnedAt: number
	// When a check last confirmed it, Unix milliseconds (UTC).
	readonly lastUsedAt?: number
}

// Row of rotator_senses, as read.
interface RotatorSenseRow {
	readonly sense: number
	readonly parity: Parity | null
	readonly gain: number | null
	readonly offset: number | null
	readonly rotator_driver: string | null
	readonly learned_at: number
	readonly last_used_at: number | null
}

// Returns the key of a camera and a rotator: their resource keys joined.
function equipmentKeyOf(camera: Camera, rotator: Rotator) {
	return `${resourceKey(camera)}|${resourceKey(rotator)}`
}

// Senses of the rotators.
export class RotatorSenseStore {
	// Creates the store of the senses in database.
	constructor(readonly database: AppDatabase) {}

	// Returns the sense of kind learned for camera and rotator with the rotator's current reverse switch, or undefined
	// when none was, or it was learned with another driver of the rotator.
	get(kind: RotatorSenseKind, camera: Camera, rotator: Rotator): StoredRotatorSense | undefined {
		const row = this.database.db.query<RotatorSenseRow, [string, string, number]>('SELECT sense, parity, gain, offset, rotator_driver, learned_at, last_used_at FROM rotator_senses WHERE kind = ? AND equipment_key = ? AND reversed = ?').get(kind, equipmentKeyOf(camera, rotator), rotator.reversed ? 1 : 0)
		if (!row || (row.rotator_driver !== null && rotator.driver.executable && row.rotator_driver !== rotator.driver.executable)) return undefined
		return { sense: row.sense === 1 ? 1 : -1, ...(row.parity !== null && { parity: row.parity }), ...(row.gain !== null && { gain: row.gain }), ...(row.offset !== null && { offset: row.offset }), learnedAt: row.learned_at, ...(row.last_used_at !== null && { lastUsedAt: row.last_used_at }) }
	}

	// Saves the sense of kind just learned for camera and rotator with the rotator's current reverse switch, at time (Unix
	// milliseconds, UTC), replacing what was there, its offset included. Throws when the database cannot be written; nothing
	// is saved then.
	learned(kind: RotatorSenseKind, camera: Camera, rotator: Rotator, sense: 1 | -1, parity: Parity | undefined, gain: number | undefined, time: number) {
		this.database.write(() => {
			this.database.db
				.query('INSERT OR REPLACE INTO rotator_senses (kind, equipment_key, reversed, camera_name, rotator_name, rotator_driver, sense, parity, gain, learned_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
				.run(kind, equipmentKeyOf(camera, rotator), rotator.reversed ? 1 : 0, camera.name, rotator.name, rotator.driver.executable || null, sense, parity ?? null, gain !== undefined && Number.isFinite(gain) ? gain : null, time)
		})
	}

	// Records the offset of the position angle (degrees, reduced to [0, 180)) a Center measured for camera and rotator with
	// the rotator's current reverse switch, at time (Unix milliseconds, UTC), on the stored sense only: nothing is written
	// without one. Throws when the database cannot be written.
	offsetMeasured(camera: Camera, rotator: Rotator, offset: number, time: number) {
		const reduced = ((offset % 180) + 180) % 180
		this.database.db.query("UPDATE rotator_senses SET offset = ?, last_used_at = ? WHERE kind = 'positionAngle' AND equipment_key = ? AND reversed = ?").run(reduced < 180 ? reduced : 0, time, equipmentKeyOf(camera, rotator), rotator.reversed ? 1 : 0)
	}

	// Records that a check confirmed the stored sense of kind at time (Unix milliseconds, UTC).
	confirmed(kind: RotatorSenseKind, camera: Camera, rotator: Rotator, time: number) {
		this.database.db.query('UPDATE rotator_senses SET last_used_at = ? WHERE kind = ? AND equipment_key = ? AND reversed = ?').run(time, kind, equipmentKeyOf(camera, rotator), rotator.reversed ? 1 : 0)
	}
}
