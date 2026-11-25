import { expect, test } from 'bun:test'
import type { ExternalToolCheck, ExternalToolCheckCode, ExternalToolCheckStatus } from 'api'
import { toolDisplay } from './ExternalToolStatus'

function check(code: ExternalToolCheckCode, status: ExternalToolCheckStatus = 'available'): ExternalToolCheck {
	return { status, code, config: { executable: '/opt/mediamtx', timeout: 300000 }, checkedAt: 1000, duration: 1, message: 'message' }
}

test('without a check, the state says whether the settings are set up', () => {
	expect(toolDisplay(undefined, false)).toBe('notSetUp')
	expect(toolDisplay(undefined, true)).toBe('notChecked')
})

test('a program that answered is available, and folders without index files say so', () => {
	expect(toolDisplay(check('ok'), true)).toBe('available')
	expect(toolDisplay(check('noIndexes', 'unavailable'), true)).toBe('noIndexes')
})

test('a state the operator chose is never a failure', () => {
	expect(toolDisplay(check('empty', 'failed'), false)).toBe('notSetUp')
})

test('missing files are not found, everything else fails', () => {
	expect(toolDisplay(check('missing', 'unavailable'), true)).toBe('notFound')
	for (const code of ['notFile', 'notExecutable', 'inaccessible', 'notStarted', 'noAnswer', 'incompatibleVersion', 'notDirectory'] as const) expect(toolDisplay(check(code, 'failed'), true)).toBe('failed')
})
