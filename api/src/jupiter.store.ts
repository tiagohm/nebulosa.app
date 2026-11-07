import type { AppDatabase } from './database'

// Great Red Spot longitude model of the Jupiter Observing Planner, persisted in the operational database: one model per
// server, entered by the operator from an observer bulletin and never fetched. A save made from an outdated revision is
// refused, so two tabs never overwrite each other silently; every committed save is published to the listener.

// Great Red Spot model of the server: its System II longitude at a reference instant and its drift.
export interface JupiterGrsModel {
	// System II west longitude of the spot at the reference instant, radians in [0, 2π).
	readonly longitude: number
	// Reference instant of the longitude, Unix milliseconds (UTC).
	readonly referenceTime: number
	// Drift of the System II west longitude, radians per day; positive toward increasing west longitude.
	readonly drift: number
	// Where the operator took the values from, free text.
	readonly sourceLabel?: string
	// Notes of the operator, free text.
	readonly notes?: string
}

// Saved Great Red Spot model and its revision.
export interface JupiterGrsSettings {
	// The model; absent when it has never been saved.
	readonly model?: JupiterGrsModel
	// Revision of the model, 0 when it has never been saved.
	readonly revision: number
	// When the model last changed, Unix milliseconds (UTC); absent when it has never been saved.
	readonly updatedAt?: number
}

// Body of a save of the Great Red Spot model.
export interface JupiterGrsSaveRequest {
	// The model to save.
	readonly model: JupiterGrsModel
	// Revision the edit started from; 0 for the first save.
	readonly revision: number
}

// Outcome of a save: the saved settings, or a conflict with the current ones when another revision was saved since.
export type JupiterGrsSaveOutcome = { readonly status: 'saved'; readonly grs: JupiterGrsSettings } | { readonly status: 'conflict'; readonly grs: JupiterGrsSettings }

// Pushed to every tab once a save of the Great Red Spot model is committed.
export interface JupiterGrsEvent {
	readonly type: 'jupiter:grsUpdated'
	// The settings after the save.
	readonly grs: JupiterGrsSettings
}

// Row of the jupiter_grs_settings table.
interface GrsRow {
	readonly longitude: number
	readonly reference_time: number
	readonly drift: number
	readonly source_label: string | null
	readonly notes: string | null
	readonly revision: number
	readonly updated_at: number
}

// Store of the server's Great Red Spot model.
export class JupiterGrsStore {
	// Creates the store of the model in database, publishing every committed save to listener.
	constructor(
		readonly database: AppDatabase,
		readonly listener?: (event: JupiterGrsEvent) => void,
	) {}

	// The saved model and its revision, revision 0 without a model when it has never been saved.
	get(): JupiterGrsSettings {
		const row = this.database.db.query<GrsRow, []>('SELECT longitude, reference_time, drift, source_label, notes, revision, updated_at FROM jupiter_grs_settings WHERE singleton = 1').get()
		if (!row) return { revision: 0 }
		const model: JupiterGrsModel = { longitude: row.longitude, referenceTime: row.reference_time, drift: row.drift, ...(row.source_label !== null && { sourceLabel: row.source_label }), ...(row.notes !== null && { notes: row.notes }) }
		return { model, revision: row.revision, updatedAt: row.updated_at }
	}

	// Saves the model edited from revision in one transaction and publishes it. Refuses with the current settings when
	// another revision was saved since. Throws when the database cannot be written; the saved model is then unchanged.
	save(model: JupiterGrsModel, revision: number): JupiterGrsSaveOutcome {
		const outcome = this.database.write((): JupiterGrsSaveOutcome => {
			const current = this.get()
			if (current.revision !== revision) return { status: 'conflict', grs: current }

			this.database.db
				.query(
					'INSERT INTO jupiter_grs_settings (singleton, longitude, reference_time, drift, source_label, notes, revision, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (singleton) DO UPDATE SET longitude = excluded.longitude, reference_time = excluded.reference_time, drift = excluded.drift, source_label = excluded.source_label, notes = excluded.notes, revision = excluded.revision, updated_at = excluded.updated_at',
				)
				.run(model.longitude, model.referenceTime, model.drift, model.sourceLabel || null, model.notes || null, revision + 1, Date.now())

			return { status: 'saved', grs: this.get() }
		})

		if (outcome.status === 'saved') this.listener?.({ type: 'jupiter:grsUpdated', grs: outcome.grs })
		return outcome
	}
}
