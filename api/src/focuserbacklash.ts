import type { BacklashCompensationMode } from 'nebulosa/src/observation/focus/backlash'
import type { AppDatabase } from './database'

// Backlash compensation settings of every physical focuser, persisted in the operational database. A focuser is
// identified by its connection id and device id, both stable across restarts of the server and reconnects of the
// same endpoint, so two focusers of the same name on different connections never share settings. Profiles only
// choose focusers; they never hold these settings. The store only persists: the focuser commands snapshot the
// settings when a move starts and apply them through the toolkit's BacklashCompensator.

// Compensation strategy of an enabled compensation; the toolkit's NONE is expressed by enabled being false.
export type FocuserBacklashMode = Exclude<BacklashCompensationMode, 'NONE'>

// Backlash compensation of a focuser, as edited by people.
export interface FocuserBacklashConfig {
	// Whether the moves of the focuser are compensated; the other fields are kept while disabled.
	readonly enabled: boolean
	// Compensation strategy.
	readonly mode: FocuserBacklashMode
	// Backlash absorbed when reversing into the IN direction (decreasing position), in steps; integer >= 0.
	readonly backlashIn: number
	// Backlash absorbed when reversing into the OUT direction (increasing position), in steps; integer >= 0.
	readonly backlashOut: number
}

// Saved compensation of a focuser.
export interface StoredFocuserBacklash extends FocuserBacklashConfig {
	// Revision of the settings, increased by every save; 0 when never saved.
	readonly revision: number
}

// Row of a focuser in focuser_backlash.
interface FocuserRow {
	readonly enabled: number
	readonly mode: FocuserBacklashMode
	readonly backlash_in: number
	readonly backlash_out: number
	readonly revision: number
}

// Outcome of a save: saved, or refused because another revision was saved since.
export type FocuserBacklashSaveOutcome = { readonly status: 'saved'; readonly settings: StoredFocuserBacklash } | { readonly status: 'conflict'; readonly settings: StoredFocuserBacklash }

// Settings of a focuser never saved: compensation disabled with neutral amounts.
export const DEFAULT_FOCUSER_BACKLASH: StoredFocuserBacklash = { enabled: false, mode: 'OVERSHOOT', backlashIn: 0, backlashOut: 0, revision: 0 }

// Key of a focuser among the compensators of the focuser commands.
export function focuserKey(connectionId: string, deviceId: string) {
	return `${connectionId}:${deviceId}`
}

// Backlash settings of the focusers, persisted in the operational database. A save made from an outdated revision is
// refused, so two tabs never overwrite each other silently.
export class FocuserBacklashStore {
	// Creates the store of the settings in database.
	constructor(readonly database: AppDatabase) {}

	// Returns the saved settings of a focuser, the defaults when never saved. The returned settings are a snapshot: a
	// later save never changes them.
	get(connectionId: string, deviceId: string): StoredFocuserBacklash {
		const row = this.database.db.query<FocuserRow, [string, string]>('SELECT enabled, mode, backlash_in, backlash_out, revision FROM focuser_backlash WHERE connection_id = ? AND device_id = ?').get(connectionId, deviceId)
		return row ? { enabled: row.enabled === 1, mode: row.mode, backlashIn: row.backlash_in, backlashOut: row.backlash_out, revision: row.revision } : DEFAULT_FOCUSER_BACKLASH
	}

	// Saves the settings of a focuser edited from revision. Throws when the database cannot be written; the saved
	// settings are then unchanged.
	save(connectionId: string, deviceId: string, { enabled, mode, backlashIn, backlashOut }: FocuserBacklashConfig, revision: number): FocuserBacklashSaveOutcome {
		const current = this.get(connectionId, deviceId)
		if (revision !== current.revision) return { status: 'conflict', settings: current }

		const settings: StoredFocuserBacklash = { enabled, mode, backlashIn, backlashOut, revision: current.revision + 1 }
		this.database.db
			.query(
				'INSERT INTO focuser_backlash (connection_id, device_id, enabled, mode, backlash_in, backlash_out, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (connection_id, device_id) DO UPDATE SET enabled = excluded.enabled, mode = excluded.mode, backlash_in = excluded.backlash_in, backlash_out = excluded.backlash_out, revision = excluded.revision, updated_at = excluded.updated_at',
			)
			.run(connectionId, deviceId, enabled ? 1 : 0, mode, backlashIn, backlashOut, settings.revision, Date.now())
		return { status: 'saved', settings }
	}
}
