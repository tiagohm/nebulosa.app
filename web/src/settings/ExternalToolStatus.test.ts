import { expect, test } from 'bun:test'
import type { ExternalToolCheck, ExternalToolCheckCode, ExternalToolCheckStatus } from 'api'
import { toolDisplay } from './ExternalToolStatus'

function check(code: ExternalToolCheckCode, status: ExternalToolCheckStatus = 'available'): ExternalToolCheck {
	return { status, code, config: { executable: '/opt/astap', timeout: 300000 }, checkedAt: 1000, duration: 1, message: 'message' }
}

test('without a check, the state says whether the settings are set up', () => {
	expect(toolDisplay(undefined, false, false)).toBe('notSetUp')
	expect(toolDisplay(undefined, false, true)).toBe('notChecked')
	expect(toolDisplay(undefined, true, false)).toBe('signedOut')
	expect(toolDisplay(undefined, true, true)).toBe('notChecked')
})

test('a program that answered is available, a web service signed in to is signed in', () => {
	expect(toolDisplay(check('ok'), false, true)).toBe('available')
	expect(toolDisplay(check('ok'), true, true)).toBe('signedIn')
	expect(toolDisplay(check('noDatabase'), false, true)).toBe('noDatabase')
})

test('a state the operator chose is never a failure', () => {
	expect(toolDisplay(check('empty', 'failed'), false, false)).toBe('notSetUp')
	expect(toolDisplay(check('signedOut', 'unavailable'), true, false)).toBe('signedOut')
})

test('missing files are not found, everything else fails', () => {
	expect(toolDisplay(check('missing', 'unavailable'), false, true)).toBe('notFound')
	expect(toolDisplay(check('configMissing', 'unavailable'), false, true)).toBe('notFound')
	for (const code of ['notFile', 'notExecutable', 'inaccessible', 'invalidEndpoint', 'notStarted', 'noAnswer', 'incompatibleVersion'] as const) expect(toolDisplay(check(code, 'failed'), false, true)).toBe('failed')
})
