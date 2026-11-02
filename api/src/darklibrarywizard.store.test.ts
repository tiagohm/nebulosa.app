import { afterAll, describe, expect, test } from 'bun:test'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type DarkCapturePlan, type DarkFrameRecord, darkGroupProgress, DarkPlanStore, parseDarkJournal, STAGING_DIRECTORY } from './darklibrarywizard.store'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-darkstore-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

// Two groups of 2 and 1 frames in a directory of their own.
function fixture() {
	const base = mkdtempSync(join(root, 'plan-'))
	const directory = join(base, 'plans')
	const groups = ['a', 'b'].map((groupId, index) => ({ groupId, key: groupId, directory: join(base, groupId), exposure: 60, count: index === 0 ? 2 : 1 }))
	for (const group of groups) mkdirSync(join(group.directory, STAGING_DIRECTORY), { recursive: true })

	const plan: DarkCapturePlan = {
		version: 1,
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

	return { plan, groups, directory, store: new DarkPlanStore(directory), journal: join(directory, 'plan.journal.jsonl') }
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

describe('journal', () => {
	test('a torn last line is left out, and a broken whole line is not', () => {
		const line = JSON.stringify({ type: 'committed', frameId: 'x', at: 1 })
		expect(parseDarkJournal(`${line}\n${line}\n{"type":"comm`)).toEqual({ records: [JSON.parse(line), JSON.parse(line)], length: line.length * 2 + 2 })
		expect(() => parseDarkJournal(`{"type\n${line}\n`)).toThrow()
	})
})

describe('plan store', () => {
	test('a created plan survives another store, and counts only committed frames', async () => {
		const { plan, groups, directory, store } = fixture()
		await store.create(plan, 'session')
		await commit(store, frame(groups[0], 1))
		await store.append('plan', { type: 'publishing', frame: frame(groups[0], 2) })
		await store.append('plan', { type: 'status', at: 3, status: 'completed' })

		const [summary] = await new DarkPlanStore(directory).list()
		expect(summary.groups.map((group) => [group.accepted, group.missing])).toEqual([
			[1, 1],
			[0, 1],
		])
	})

	test('a plan its process left running is interrupted, and no other plan is touched', async () => {
		const { plan, directory, store } = fixture()
		await store.create(plan, 'session')
		const summary = (await new DarkPlanStore(directory).list())[0]
		expect(summary.status).toBe('interrupted')
		expect(summary.reason).toContain('server stopped')
		expect((await new DarkPlanStore(directory).list())[0].status).toBe('interrupted')
	})

	test('a crash after the file was published and before the commit counts the frame once', async () => {
		const { plan, groups, directory, store } = fixture()
		await store.create(plan, 'session')
		const record = frame(groups[0], 1)
		writeFileSync(record.path, 'dark')
		await store.append('plan', { type: 'publishing', frame: record })

		const again = new DarkPlanStore(directory)
		expect((await again.list())[0].groups[0]).toMatchObject({ accepted: 1, missing: 1 })
		expect((await new DarkPlanStore(directory).list())[0].groups[0]).toMatchObject({ accepted: 1, missing: 1 })
	})

	test('a crash before the file was published finishes it from its staged copy', async () => {
		const { plan, groups, directory, store } = fixture()
		await store.create(plan, 'session')
		const staged = join(groups[0].directory, STAGING_DIRECTORY, '1.fit')
		writeFileSync(staged, 'dark')
		const record = frame(groups[0], 1, { staged })
		await store.append('plan', { type: 'publishing', frame: record })

		expect((await new DarkPlanStore(directory).list())[0].groups[0]).toMatchObject({ accepted: 1 })
		expect(readFileSync(record.path, 'utf-8')).toBe('dark')
		expect(existsSync(staged)).toBeFalse()
	})

	test('a frame lost before it was published does not count', async () => {
		const { plan, groups, directory, store } = fixture()
		await store.create(plan, 'session')
		await store.append('plan', { type: 'publishing', frame: frame(groups[0], 1) })
		expect((await new DarkPlanStore(directory).list())[0].groups[0]).toMatchObject({ accepted: 0, incomplete: 1, missing: 2 })
	})

	test('a published file that is not the examined one does not count', async () => {
		const { plan, groups, directory, store } = fixture()
		await store.create(plan, 'session')
		const record = frame(groups[0], 1)
		writeFileSync(record.path, 'da')
		await store.append('plan', { type: 'publishing', frame: record })
		expect((await new DarkPlanStore(directory).list())[0].groups[0]).toMatchObject({ accepted: 0, incomplete: 1 })
		expect(existsSync(record.path)).toBeTrue()
	})

	test('what a staging directory holds is quarantined, never deleted', async () => {
		const { plan, groups, directory, store } = fixture()
		await store.create(plan, 'session')
		writeFileSync(join(groups[1].directory, STAGING_DIRECTORY, 'unknown.fit'), 'partial')

		expect((await new DarkPlanStore(directory).list())[0].groups[1]).toMatchObject({ incomplete: 1, missing: 1 })
		const rejected = readdirSync(join(groups[1].directory, 'rejected'))
		expect(rejected).toHaveLength(1)
		expect(readFileSync(join(groups[1].directory, 'rejected', rejected[0]), 'utf-8')).toBe('partial')
		expect(readdirSync(join(groups[1].directory, STAGING_DIRECTORY))).toEqual([])
	})

	test('a torn record is cut off, so the next one starts a line of its own', async () => {
		const { plan, groups, directory, store, journal } = fixture()
		await store.create(plan, 'session')
		await store.append('plan', { type: 'status', at: 2, status: 'stopped' })
		appendFileSync(journal, '{"type":"sta')

		const again = new DarkPlanStore(directory)
		await commit(again, frame(groups[0], 1))
		expect((await new DarkPlanStore(directory).list())[0]).toMatchObject({ status: 'stopped', groups: [{ accepted: 1 }, { accepted: 0 }] })
	})

	test('files that cannot be used cost only themselves', async () => {
		const { plan, directory, store } = fixture()
		await store.create(plan, 'session')
		writeFileSync(join(directory, 'broken.json'), '{')
		writeFileSync(join(directory, 'future.json'), JSON.stringify({ ...plan, planId: 'future', version: 999 }))
		const again = new DarkPlanStore(directory)
		expect(await again.list()).toHaveLength(1)
		expect((await again.unavailable()).toSorted((a, b) => a.planId.localeCompare(b.planId))).toEqual([
			{ planId: 'broken', reason: 'corrupt' },
			{ planId: 'future', reason: 'newerVersion' },
		])
	})

	test('a journal with a broken line makes its plan unavailable instead of hiding frames', async () => {
		const { plan, directory, store, journal } = fixture()
		await store.create(plan, 'session')
		appendFileSync(journal, 'broken\n')
		const again = new DarkPlanStore(directory)
		expect(await again.list()).toHaveLength(0)
		expect(await again.unavailable()).toEqual([{ planId: 'plan', reason: 'corrupt' }])
	})

	test('a record that cannot be written leaves the plan unchanged', async () => {
		const { plan, groups, directory, store, journal } = fixture()
		await store.create(plan, 'session')
		rmSync(journal)
		mkdirSync(journal)
		await expect(store.append('plan', { type: 'publishing', frame: frame(groups[0], 1) })).rejects.toThrow()
		expect((await store.detail('plan', 10))?.frames).toEqual([])
		rmSync(journal, { recursive: true })
		expect(existsSync(directory)).toBeTrue()
		chmodSync(directory, 0o755)
	})

	test('counts separate what counts from what does not', () => {
		const { plan, groups } = fixture()
		const frames = [frame(groups[0], 1), frame(groups[0], 2, { verdict: 'acceptedWithWarnings' }), frame(groups[0], 3, { verdict: 'rejected' }), frame(groups[1], 1, { verdict: 'incomplete' })]
		expect(darkGroupProgress(plan, frames, new Map())).toEqual([
			{ groupId: 'a', required: 2, accepted: 1, acceptedWithWarnings: 1, rejected: 1, incomplete: 0, lost: 0, missing: 0 },
			{ groupId: 'b', required: 1, accepted: 0, acceptedWithWarnings: 0, rejected: 0, incomplete: 1, lost: 0, missing: 1 },
		])
	})
})
