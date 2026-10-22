import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULT_FOCUSER_BACKLASH, FocuserBacklashStore, parseFocusers } from './focuserbacklash'

const directories: string[] = []

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function file() {
	const directory = mkdtempSync(join(tmpdir(), 'nebulosa-backlash-'))
	directories.push(directory)
	return join(directory, 'focusers.json')
}

test('a focuser never saved has the compensation disabled', async () => {
	const store = new FocuserBacklashStore(file())
	expect(await store.get('c', 'f')).toEqual({ settings: DEFAULT_FOCUSER_BACKLASH })
})

test('saved settings survive a restart and belong to one focuser of one connection', async () => {
	const path = file()
	const store = new FocuserBacklashStore(path)
	const outcome = await store.save('c1', 'f', { enabled: true, mode: 'ABSOLUTE', backlashIn: 40, backlashOut: 25 }, 0)
	expect(outcome).toEqual({ status: 'saved', settings: { enabled: true, mode: 'ABSOLUTE', backlashIn: 40, backlashOut: 25, revision: 1 } })

	const restarted = new FocuserBacklashStore(path)
	expect((await restarted.get('c1', 'f')).settings).toEqual({ enabled: true, mode: 'ABSOLUTE', backlashIn: 40, backlashOut: 25, revision: 1 })
	expect((await restarted.get('c2', 'f')).settings).toEqual(DEFAULT_FOCUSER_BACKLASH)
})

test('a save from an outdated revision is refused', async () => {
	const store = new FocuserBacklashStore(file())
	await store.save('c', 'f', { enabled: true, mode: 'OVERSHOOT', backlashIn: 10, backlashOut: 10 }, 0)
	const outcome = await store.save('c', 'f', { enabled: false, mode: 'OVERSHOOT', backlashIn: 0, backlashOut: 0 }, 0)
	expect(outcome).toEqual({ status: 'conflict', settings: { enabled: true, mode: 'OVERSHOOT', backlashIn: 10, backlashOut: 10, revision: 1 } })
})

test('a file of a newer version is never overwritten', async () => {
	const path = file()
	await Bun.write(path, JSON.stringify({ version: 99, focusers: {} }))
	const store = new FocuserBacklashStore(path)
	expect((await store.get('c', 'f')).error).toBeString()
	expect(await store.save('c', 'f', DEFAULT_FOCUSER_BACKLASH, 0)).toEqual({ status: 'newerVersion' })
})

test('untrusted file content is normalized', () => {
	const { focusers, error } = parseFocusers(JSON.stringify({ version: 1, focusers: { 'c:f': { enabled: 'yes', mode: 'SPIRAL', backlashIn: -5, backlashOut: 2.5, revision: 3 } } }))
	expect(error).toBeUndefined()
	expect(focusers.get('c:f')).toEqual({ enabled: false, mode: 'OVERSHOOT', backlashIn: 0, backlashOut: 0, revision: 3 })
	expect(parseFocusers('not json').error).toBeString()
	expect(parseFocusers('[]').error).toBeString()
})
