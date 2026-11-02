import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AppDatabase } from './database'
import { DEFAULT_FOCUSER_BACKLASH, FocuserBacklashStore } from './focuserbacklash'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-backlash-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

test('a focuser never saved has the compensation disabled', () => {
	const store = new FocuserBacklashStore(AppDatabase.memory())
	expect(store.get('c', 'f')).toEqual(DEFAULT_FOCUSER_BACKLASH)
})

test('saved settings survive a restart and belong to one focuser of one connection', () => {
	const file = join(root, 'restart', 'nebulosa.sqlite')
	const database = new AppDatabase(file)
	const outcome = new FocuserBacklashStore(database).save('c1', 'f', { enabled: true, mode: 'ABSOLUTE', backlashIn: 40, backlashOut: 25 }, 0)
	expect(outcome).toEqual({ status: 'saved', settings: { enabled: true, mode: 'ABSOLUTE', backlashIn: 40, backlashOut: 25, revision: 1 } })
	database.close()

	const reopened = new AppDatabase(file)
	const restarted = new FocuserBacklashStore(reopened)
	expect(restarted.get('c1', 'f')).toEqual({ enabled: true, mode: 'ABSOLUTE', backlashIn: 40, backlashOut: 25, revision: 1 })
	expect(restarted.get('c2', 'f')).toEqual(DEFAULT_FOCUSER_BACKLASH)
	reopened.close()
})

test('a save from an outdated revision is refused', () => {
	const store = new FocuserBacklashStore(AppDatabase.memory())
	store.save('c', 'f', { enabled: true, mode: 'OVERSHOOT', backlashIn: 10, backlashOut: 10 }, 0)
	const outcome = store.save('c', 'f', { enabled: false, mode: 'OVERSHOOT', backlashIn: 0, backlashOut: 0 }, 0)
	expect(outcome).toEqual({ status: 'conflict', settings: { enabled: true, mode: 'OVERSHOOT', backlashIn: 10, backlashOut: 10, revision: 1 } })
})

test('a save that cannot be written throws and changes nothing', () => {
	const database = AppDatabase.memory()
	const store = new FocuserBacklashStore(database)
	database.db.run('PRAGMA query_only = ON')
	expect(() => store.save('c', 'f', { enabled: true, mode: 'OVERSHOOT', backlashIn: 10, backlashOut: 10 }, 0)).toThrow()
	expect(store.get('c', 'f')).toEqual(DEFAULT_FOCUSER_BACKLASH)
})
