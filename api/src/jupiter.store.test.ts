import { expect, test } from 'bun:test'
import { AppDatabase } from './database'
import { type JupiterGrsEvent, JupiterGrsStore } from './jupiter.store'

const MODEL = { longitude: 1, referenceTime: Date.UTC(2026, 10, 1), drift: 0.0005, sourceLabel: 'ALPO bulletin', notes: 'measured from CCD images' }

test('an unsaved model has revision 0 and no model', () => {
	const store = new JupiterGrsStore(AppDatabase.memory())
	expect(store.get()).toEqual({ revision: 0 })
})

test('a save increases the revision, persists, and is published', () => {
	const database = AppDatabase.memory()
	const events: JupiterGrsEvent[] = []
	const store = new JupiterGrsStore(database, (event) => events.push(event))

	const outcome = store.save(MODEL, 0)
	expect(outcome.status).toBe('saved')
	expect(outcome.grs.revision).toBe(1)
	expect(outcome.grs.model).toEqual(MODEL)
	expect(outcome.grs.updatedAt).toBeNumber()
	expect(events).toEqual([{ type: 'jupiter:grsUpdated', grs: outcome.grs }])

	// Another store over the same database reads the same model.
	expect(new JupiterGrsStore(database).get()).toEqual(outcome.grs)
})

test('a save from an outdated revision is refused with the current model', () => {
	const events: JupiterGrsEvent[] = []
	const store = new JupiterGrsStore(AppDatabase.memory(), (event) => events.push(event))
	store.save(MODEL, 0)
	events.length = 0

	const outcome = store.save({ ...MODEL, longitude: 2 }, 0)
	expect(outcome.status).toBe('conflict')
	expect(outcome.grs.revision).toBe(1)
	expect(outcome.grs.model?.longitude).toBe(1)
	expect(events).toEqual([])

	expect(store.save({ ...MODEL, longitude: 2 }, 1).grs.model?.longitude).toBe(2)
})

test('empty optional texts are stored as absent', () => {
	const store = new JupiterGrsStore(AppDatabase.memory())
	const outcome = store.save({ longitude: 0.5, referenceTime: 0, drift: 0, sourceLabel: '', notes: '' }, 0)
	expect(outcome.grs.model).toEqual({ longitude: 0.5, referenceTime: 0, drift: 0 })
})
