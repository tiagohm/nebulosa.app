import { expect, test } from 'bun:test'
import { operationsSummary } from './StatusBar'

test('the status bar names at most two running operations', () => {
	expect(operationsSummary([{ kind: 'mount.slew' }])).toBe('Mount slew')
	expect(operationsSummary([{ kind: 'mount.slew' }, { kind: 'camera.capture' }, { kind: 'dome.slew' }])).toBe('Mount slew · Camera capture · +1')
})
