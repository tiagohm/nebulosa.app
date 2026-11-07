import { describe, expect, test } from 'bun:test'
import { AppDatabase } from './database'
import { OBSERVING_PRESETS } from './observingplanner.astronomy'
import { type ObservingPlanItem, type ObservingPlanSaveRequest, ObservingPlanStore } from './observingplanner.store'
import { Workspace } from './workspace'

const SITE = { name: 'Backyard', latitude: -23.55, longitude: -46.633, elevation: 760, timeZone: 'America/Sao_Paulo' }

const M42: ObservingPlanItem = { id: 'i1', target: { kind: 'catalog', id: 1001879 }, targetName: 'Great Orion Nebula', priority: 3, requestedDurationMs: 7_200_000, notes: '' }
const SATURN: ObservingPlanItem = { id: 'i2', target: { kind: 'body', code: '699' }, targetName: 'Saturn', priority: 5, requestedDurationMs: 1_800_000, scheduledStartAt: 1_768_520_000_000, constraints: { minimumAltitude: 0.5, maximumAirmass: 1.5 }, notes: 'barlow' }
const FIELD: ObservingPlanItem = { id: 'i3', target: { kind: 'coordinates', name: 'Field', rightAscension: 1.2, declination: -0.3 }, targetName: 'Field', priority: 1, requestedDurationMs: 600_000, notes: '' }

const PLAN: ObservingPlanSaveRequest = { name: 'Orion night', eveningDate: '2026-01-15', site: SITE, constraints: OBSERVING_PRESETS.deepSky, items: [M42, SATURN, FIELD], revision: 0 }

function setup() {
	const database = AppDatabase.memory()
	return { database, store: new ObservingPlanStore(database) }
}

describe('save', () => {
	test('creates, reads back, and edits the whole document with a new revision', () => {
		const { store } = setup()
		const created = store.save('p1', PLAN, 1000)
		expect(created).toEqual({ status: 'saved', plan: { id: 'p1', name: 'Orion night', eveningDate: '2026-01-15', site: SITE, constraints: OBSERVING_PRESETS.deepSky, items: [M42, SATURN, FIELD], revision: 1, createdAt: 1000, updatedAt: 1000 } })
		expect(store.get('p1')).toEqual(store.list()[0])

		const reordered = store.save('p1', { ...PLAN, name: 'Renamed', items: [FIELD, { ...M42, scheduledStartAt: 5 }], revision: 1 }, 2000)
		expect(reordered).toMatchObject({ status: 'saved', plan: { name: 'Renamed', revision: 2, createdAt: 1000, updatedAt: 2000 } })
		expect(store.get('p1')!.items).toEqual([FIELD, { ...M42, scheduledStartAt: 5 }])
	})

	test('refuses an outdated revision and keeps the stored plan', () => {
		const { store } = setup()
		store.save('p1', PLAN)
		const stored = store.get('p1')!
		expect(store.save('p1', { ...PLAN, name: 'Stale', revision: 0 })).toEqual({ status: 'conflict', current: stored })
		expect(store.save('p2', { ...PLAN, revision: 3 })).toEqual({ status: 'conflict', current: null })
		expect(store.get('p1')).toEqual(stored)
	})

	test('a failed write leaves nothing half written', () => {
		const { store } = setup()
		store.save('p1', PLAN)
		// The second item breaks the priority check after the plan row and the first item were written.
		expect(() => store.save('p1', { ...PLAN, name: 'Broken', items: [M42, { ...SATURN, priority: 9 }], revision: 1 })).toThrow()
		expect(store.get('p1')).toMatchObject({ name: 'Orion night', revision: 1, items: [M42, SATURN, FIELD] })
	})

	test('keeps the same target twice as separate items', () => {
		const { store } = setup()
		store.save('p1', { ...PLAN, items: [M42, { ...M42, id: 'i9', requestedDurationMs: 600_000 }] })
		expect(store.get('p1')!.items.map((e) => e.id)).toEqual(['i1', 'i9'])
	})
})

describe('list, duplicate, and remove', () => {
	test('lists most recently changed first', () => {
		const { store } = setup()
		store.save('a', PLAN, 1000)
		store.save('b', PLAN, 2000)
		expect(store.list().map((e) => e.id)).toEqual(['b', 'a'])
		expect(store.list()[1].items).toHaveLength(3)
	})

	test('duplicates with its items as a first revision', () => {
		const { store } = setup()
		store.save('p1', PLAN, 1000)
		store.save('p1', { ...PLAN, revision: 1 }, 1500)
		expect(store.duplicate('p1', 'p2', 'Copy', 2000)).toMatchObject({ status: 'saved', plan: { id: 'p2', name: 'Copy', revision: 1, createdAt: 2000, items: [M42, SATURN, FIELD] } })
		expect(store.duplicate('missing', 'p3', 'Copy')).toEqual({ status: 'notFound' })
		expect(store.duplicate('p1', 'p2', 'Again')).toMatchObject({ status: 'conflict' })
	})

	test('removes the plan and its items only at the stored revision', () => {
		const { database, store } = setup()
		store.save('p1', PLAN)
		expect(store.remove('p1', 7)).toMatchObject({ status: 'conflict', current: { revision: 1 } })
		expect(store.remove('p1', 1)).toEqual({ status: 'removed' })
		expect(store.remove('p1', 1)).toEqual({ status: 'notFound' })
		expect(database.db.query('SELECT count(*) AS n FROM observing_plan_items').get()).toEqual({ n: 0 })
	})

	test('keeps its copy of a site that is deleted', () => {
		const { database, store } = setup()
		const workspace = new Workspace(database)
		workspace.saveSite('s1', { ...SITE, revision: 0 })
		store.save('p1', { ...PLAN, observingSiteId: 's1' })
		expect(store.get('p1')!.observingSiteId).toBe('s1')
		workspace.removeSite('s1')
		expect(store.get('p1')).toMatchObject({ site: SITE, revision: 1 })
		expect(store.get('p1')!.observingSiteId).toBeUndefined()
	})
})
