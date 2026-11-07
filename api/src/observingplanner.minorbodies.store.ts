import type { AppDatabase } from './database'
import type { MinorBodyElements } from './sky/ephemeris'
import type { MinorBody } from './sky/types'

// Orbital elements of the minor bodies of the night plans in the operational database (observing_minor_bodies): what SBDB
// answered for a body a saved plan names, kept so the plan can still be analyzed with the approximate Kepler model
// offline and after a restart, when the in-memory SBDB cache is gone. Reference data, never part of a plan: writing it
// never changes a plan or its revision, and a plan names its bodies by SPK-ID without a foreign key. Times are Unix
// milliseconds (UTC).

// Identity and classification of a saved minor body.
export type SavedMinorBodyIdentity = Pick<MinorBody, 'spkId' | 'designation' | 'name' | 'kind' | 'orbitClass' | 'solutionDate'>

// Minor body as SBDB answered for it.
export interface SavedMinorBody {
	// Identity and classification.
	readonly body: SavedMinorBodyIdentity
	// Osculating elements with the photometry; absent when SBDB published none usable.
	readonly elements?: MinorBodyElements
	// When SBDB answered.
	readonly fetchedAt: number
}

// Row of a saved minor body.
interface MinorBodyRow {
	readonly spkId: string
	readonly designation: string
	readonly name: string
	readonly kind: MinorBody['kind']
	readonly orbitClass: string
	readonly elements: string | null
	readonly solutionDate: string
	readonly fetchedAt: number
}

// Columns of a saved minor body, named as the API names them.
const COLUMNS = 'spk_id AS spkId, designation, name, kind, orbit_class AS orbitClass, elements, solution_date AS solutionDate, fetched_at AS fetchedAt'

// Saved minor body of a row.
function savedOf({ spkId, designation, name, kind, orbitClass, elements, solutionDate, fetchedAt }: MinorBodyRow): SavedMinorBody {
	const body = { spkId, designation, name, kind, orbitClass, solutionDate }
	return elements === null ? { body, fetchedAt } : { body, elements: JSON.parse(elements) as MinorBodyElements, fetchedAt }
}

// Saved orbital elements of the minor bodies of the night plans.
export class ObservingMinorBodyStore {
	// Creates the store over database.
	constructor(readonly database: AppDatabase) {}

	// Returns the saved body of an SPK-ID; undefined when none is saved.
	get(spkId: string): SavedMinorBody | undefined {
		const row = this.database.db.query<MinorBodyRow, [string]>(`SELECT ${COLUMNS} FROM observing_minor_bodies WHERE spk_id = ?`).get(spkId)
		return row ? savedOf(row) : undefined
	}

	// Saves what SBDB answered for a body, replacing what was saved for its SPK-ID.
	put(saved: SavedMinorBody) {
		this.database.write(() => this.#put(saved))
	}

	// Saves, for every minor body the night plans name but none is saved for, what `known` answers for it, and removes the
	// bodies no plan names any more, in one transaction. A body `known` does not answer for stays unsaved.
	reconcile(known: (spkId: string) => SavedMinorBody | undefined) {
		this.database.write(() => {
			const db = this.database.db
			const missing = db.query<{ spkId: string }, []>('SELECT DISTINCT minor_body_spk_id AS spkId FROM observing_plan_items WHERE minor_body_spk_id IS NOT NULL AND minor_body_spk_id NOT IN (SELECT spk_id FROM observing_minor_bodies)').all()

			for (const { spkId } of missing) {
				const saved = known(spkId)
				if (saved) this.#put(saved)
			}

			db.run('DELETE FROM observing_minor_bodies WHERE spk_id NOT IN (SELECT minor_body_spk_id FROM observing_plan_items WHERE minor_body_spk_id IS NOT NULL)')
		})
	}

	// Upserts a saved body; runs inside a transaction.
	#put({ body, elements, fetchedAt }: SavedMinorBody) {
		this.database.db
			.query(
				`INSERT INTO observing_minor_bodies (spk_id, designation, name, kind, orbit_class, elements, solution_date, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (spk_id) DO UPDATE SET designation = excluded.designation, name = excluded.name, kind = excluded.kind, orbit_class = excluded.orbit_class, elements = excluded.elements, solution_date = excluded.solution_date, fetched_at = excluded.fetched_at`,
			)
			.run(body.spkId, body.designation, body.name, body.kind, body.orbitClass, elements ? JSON.stringify(elements) : null, body.solutionDate, fetchedAt)
	}
}
