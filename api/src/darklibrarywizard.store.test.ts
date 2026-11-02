import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type DarkCapturePlan, type DarkFrameRecord, darkGroupProgress, DarkPlanStore, STAGING_DIRECTORY } from './darklibrarywizard.store'
import { AppDatabase } from './database'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-darkstore-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

// Two groups of 2 and 1 frames in a directory of their own, over a database in memory.
function fixture() {
	const base = mkdtempSync(join(root, 'plan-'))
	const groups = ['a', 'b'].map((groupId, index) => ({ groupId, key: groupId, directory: join(base, groupId), exposure: 60, count: index === 0 ? 2 : 1 }))
	for (const group of groups) mkdirSync(join(group.directory, STAGING_DIRECTORY), { recursive: true })

	const plan: DarkCapturePlan = {
		planId: 'plan',
		createdAt: 1,
		camera: { hardwareId: 'camera', name: 'Camera', driver: { executable: 'x', version: '1' } },
		directory: base,
		capture: { gain: 0, offset: 0, binX: 1, binY: 1, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: '' },
		groups,
		protection: { closeCover: false, panelOff: false, manualCap: true, verifyFirstFrame: true },
		thermal: { tolerance: 0.5, hold: 120, timeout: 1800 },
		maximumRejections: 3,
	}

	const database = AppDatabase.memory()
	return { plan, groups, base, database, store: new DarkPlanStore(database) }
}

function frame(group: { readonly groupId: string; readonly directory: string }, sequence: number, patch: Partial<DarkFrameRecord> = {}): DarkFrameRecord {
	return { frameId: `${group.groupId}-${sequence}`, groupId: group.groupId, sequence, path: join(group.directory, `${sequence}.fit`), size: 4, time: 1, verdict: 'accepted', planes: [], rejections: [], suspicions: [], notes: [], ...patch }
}

// Commits a frame of 4 bytes, published as its path. These are not FITS images; only tests of verification need one.
async function commit(store: DarkPlanStore, record: DarkFrameRecord) {
	writeFileSync(record.path, 'dark')
	await store.append('plan', { type: 'publishing', frame: record })
	await store.append('plan', { type: 'committed', frameId: record.frameId, at: 2 })
}

// Reconciles the plans as a restarted server does, and returns the first summary.
async function restart(database: AppDatabase) {
	const store = new DarkPlanStore(database)
	await store.reconcile()
	return (await store.list())[0]
}

describe('plan store', () => {
	test('a created plan survives a restart with its specification, and counts only committed frames', async () => {
		const { plan, groups } = fixture()
		const file = join(root, 'restart', 'nebulosa.sqlite')
		const database = new AppDatabase(file)
		const store = new DarkPlanStore(database)
		await store.create({ ...plan, purpose: 'darkFlat', generateMasters: true, groups: [{ ...groups[0], temperature: -10 }, groups[1]] }, 'session')
		await commit(store, frame(groups[0], 1, { acknowledged: true, header: { frameType: 'Dark Frame', exposure: 60, width: 16, height: 12 } }))
		await store.append('plan', { type: 'status', at: 3, status: 'completed' })
		database.close()

		const reopened = new AppDatabase(file)
		const again = new DarkPlanStore(reopened)
		expect(await again.plan('plan')).toEqual({ ...plan, purpose: 'darkFlat', generateMasters: true, groups: [{ ...groups[0], temperature: -10 }, groups[1]] })
		expect((await again.frames('plan'))!.frames).toEqual([frame(groups[0], 1, { acknowledged: true, header: { frameType: 'Dark Frame', exposure: 60, width: 16, height: 12 } })])
		const [summary] = await again.list()
		expect(summary).toMatchObject({ status: 'completed', updatedAt: 3, missing: 2 })
		expect(summary.groups.map((group) => [group.accepted, group.missing])).toEqual([
			[1, 1],
			[0, 1],
		])
		reopened.close()
	})

	test('a frame being published does not count until it is committed', async () => {
		const { plan, groups, store } = fixture()
		await store.create(plan, 'session')
		await store.append('plan', { type: 'publishing', frame: frame(groups[0], 1) })
		expect((await store.list())[0].groups[0]).toMatchObject({ accepted: 0, missing: 2 })
		expect((await store.frames('plan'))!.frames).toEqual([])
	})

	test('a plan its process left running is interrupted, and no other plan is touched', async () => {
		const { plan, database, store } = fixture()
		await store.create(plan, 'session')
		await store.create({ ...plan, planId: 'done', createdAt: 0 }, 'other')
		await store.append('done', { type: 'status', at: 5, status: 'stopped' })

		const summary = await restart(database)
		expect(summary.status).toBe('interrupted')
		expect(summary.reason).toContain('server stopped')
		expect((await store.list()).map(({ planId, status }) => [planId, status])).toEqual([
			['plan', 'interrupted'],
			['done', 'stopped'],
		])
		expect((await restart(database)).status).toBe('interrupted')
	})

	test('a crash after the file was published and before the commit counts the frame once', async () => {
		const { plan, groups, database, store } = fixture()
		await store.create(plan, 'session')
		const record = frame(groups[0], 1)
		writeFileSync(record.path, 'dark')
		await store.append('plan', { type: 'publishing', frame: record })

		expect((await restart(database)).groups[0]).toMatchObject({ accepted: 1, missing: 1 })
		expect((await restart(database)).groups[0]).toMatchObject({ accepted: 1, missing: 1 })
	})

	test('a crash before the file was published finishes it from its staged copy', async () => {
		const { plan, groups, database, store } = fixture()
		await store.create(plan, 'session')
		const staged = join(groups[0].directory, STAGING_DIRECTORY, '1.fit')
		writeFileSync(staged, 'dark')
		const record = frame(groups[0], 1, { staged })
		await store.append('plan', { type: 'publishing', frame: record })

		expect((await restart(database)).groups[0]).toMatchObject({ accepted: 1 })
		expect(readFileSync(record.path, 'utf-8')).toBe('dark')
		expect(existsSync(staged)).toBeFalse()
	})

	test('a frame lost before it was published does not count', async () => {
		const { plan, groups, database, store } = fixture()
		await store.create(plan, 'session')
		await store.append('plan', { type: 'publishing', frame: frame(groups[0], 1) })
		expect((await restart(database)).groups[0]).toMatchObject({ accepted: 0, incomplete: 1, missing: 2 })
		expect((await store.frames('plan'))!.frames).toMatchObject([{ frameId: 'a-1', verdict: 'incomplete', size: 0 }])
	})

	test('a published file that is not the examined one does not count', async () => {
		const { plan, groups, database, store } = fixture()
		await store.create(plan, 'session')
		const record = frame(groups[0], 1)
		writeFileSync(record.path, 'da')
		await store.append('plan', { type: 'publishing', frame: record })
		expect((await restart(database)).groups[0]).toMatchObject({ accepted: 0, incomplete: 1 })
		expect(existsSync(record.path)).toBeTrue()
	})

	test('what a staging directory holds is quarantined, never deleted', async () => {
		const { plan, groups, database, store } = fixture()
		await store.create(plan, 'session')
		await commit(store, frame(groups[1], 1))
		writeFileSync(join(groups[1].directory, STAGING_DIRECTORY, 'unknown.fit'), 'partial')

		expect((await restart(database)).groups[1]).toMatchObject({ accepted: 1, incomplete: 1, missing: 0 })
		const rejected = readdirSync(join(groups[1].directory, 'rejected'))
		expect(rejected).toHaveLength(1)
		expect(readFileSync(join(groups[1].directory, 'rejected', rejected[0]), 'utf-8')).toBe('partial')
		expect(readdirSync(join(groups[1].directory, STAGING_DIRECTORY))).toEqual([])
		expect((await store.frames('plan'))!.frames.map(({ groupId, sequence, verdict }) => [groupId, sequence, verdict])).toEqual([
			['b', 1, 'accepted'],
			['b', 2, 'incomplete'],
		])
	})

	test('a plan that cannot be reconciled stays as it was, and is reconciled on the next start', async () => {
		const { plan, groups, database, store } = fixture()
		await store.create(plan, 'session')
		const record = frame(groups[0], 1)
		writeFileSync(record.path, 'dark')
		await store.append('plan', { type: 'publishing', frame: record })

		database.db.run('PRAGMA query_only = ON')
		expect((await restart(database)).status).toBe('running')
		database.db.run('PRAGMA query_only = OFF')
		expect(await restart(database)).toMatchObject({ status: 'interrupted', groups: [{ accepted: 1 }, { accepted: 0 }] })
	})

	test('a record that cannot be written leaves the plan unchanged', async () => {
		const { plan, groups, database, store } = fixture()
		await store.create(plan, 'session')
		database.db.run('PRAGMA query_only = ON')
		await expect(store.append('plan', { type: 'publishing', frame: frame(groups[0], 1) })).rejects.toThrow()
		await expect(store.append('plan', { type: 'status', at: 9, status: 'stopped' })).rejects.toThrow()
		expect(await store.detail('plan', 10)).toMatchObject({ status: 'running', frames: [], frameCount: 0 })
	})

	test('a plan that cannot be written leaves nothing of it', async () => {
		const { plan, database, store } = fixture()
		await expect(store.create({ ...plan, groups: [plan.groups[0], plan.groups[0]] }, 'session')).rejects.toThrow()
		expect(await store.list()).toEqual([])
		expect(database.db.query('SELECT count(*) AS count FROM dark_groups').get()).toEqual({ count: 0 })
	})

	test('a frame number is never used twice in a group, and an unknown plan records nothing', async () => {
		const { plan, groups, store } = fixture()
		await store.create(plan, 'session')
		await commit(store, frame(groups[0], 1))
		await expect(store.append('plan', { type: 'rejected', frame: frame(groups[0], 1, { frameId: 'other', verdict: 'rejected' }) })).rejects.toThrow()
		await expect(store.append('gone', { type: 'status', at: 1, status: 'stopped' })).rejects.toThrow('Unknown dark plan')
	})

	test('a detail holds the latest frames in the order they were recorded', async () => {
		const { plan, groups, store } = fixture()
		await store.create(plan, 'session')
		await commit(store, frame(groups[0], 1))
		await store.append('plan', { type: 'rejected', frame: frame(groups[0], 2, { verdict: 'rejected' }) })
		await commit(store, frame(groups[1], 1))

		const detail = (await store.detail('plan', 2))!
		expect(detail.frames.map(({ frameId }) => frameId)).toEqual(['a-2', 'b-1'])
		expect(detail.frameCount).toBe(3)
		expect(await store.detail('gone', 2)).toBeUndefined()
	})

	test('a running status clears the cleanup warnings of the session before', async () => {
		const { plan, store } = fixture()
		await store.create(plan, 'session')
		await store.append('plan', { type: 'cleanup', at: 4, warnings: ['The cover stayed open'] })
		expect((await store.list())[0]).toMatchObject({ cleanupWarnings: ['The cover stayed open'], updatedAt: 4 })
		await store.append('plan', { type: 'status', at: 5, status: 'running', sessionId: 'next' })
		expect((await store.list())[0].cleanupWarnings).toEqual([])
	})

	test('counts separate what counts from what does not', () => {
		const { plan, groups } = fixture()
		const frames = [frame(groups[0], 1), frame(groups[0], 2, { verdict: 'acceptedWithWarnings' }), frame(groups[0], 3, { verdict: 'rejected' }), frame(groups[1], 1, { verdict: 'incomplete' })]
		expect(darkGroupProgress(plan, frames)).toEqual([
			{ groupId: 'a', required: 2, accepted: 1, acceptedWithWarnings: 1, rejected: 1, incomplete: 0, missing: 0 },
			{ groupId: 'b', required: 1, accepted: 0, acceptedWithWarnings: 0, rejected: 0, incomplete: 1, missing: 1 },
		])
	})
})
