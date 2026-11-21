import { expect, test } from 'bun:test'
import { switchGuardOf } from './guards'

test('asks before motion and reference switches only', () => {
	expect(switchGuardOf('TELESCOPE_MOTION_NS', 'MOTION_NORTH')).toBeString()
	expect(switchGuardOf('DOME_MOTION', 'DOME_CW')).toBeString()
	expect(switchGuardOf('TELESCOPE_HOME', 'FIND')).toBeString()
	expect(switchGuardOf('TELESCOPE_HOME', 'SET')).toBeString()
	expect(switchGuardOf('TELESCOPE_HOME', 'GO')).toBeUndefined()
	expect(switchGuardOf('TELESCOPE_PARK_OPTION', 'PARK_CURRENT')).toBeString()
	expect(switchGuardOf('TELESCOPE_ABORT_MOTION', 'ABORT')).toBeUndefined()
	expect(switchGuardOf('CONNECTION', 'DISCONNECT')).toBeUndefined()
})
