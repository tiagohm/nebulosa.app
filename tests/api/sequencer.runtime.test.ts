import { describe, expect, test } from 'bun:test'
import { SessionAdmissionGate, SessionTeardown } from 'src/api/sequencer.runtime'

describe('session admission gate', () => {
	test('admits the first session and refuses another one naming the holder', () => {
		const gate = new SessionAdmissionGate()
		const first = gate.claim('session-1')
		const second = gate.claim('session-2')

		expect(first).toMatchObject({ ok: true, kind: 'admitted' })
		expect(second).toEqual({ ok: false, kind: 'refused', reason: 'busy', sessionId: 'session-1' })
		expect(gate.sessionId).toBe('session-1')
	})

	test('reports a start of the same session as reentrant without a claim', () => {
		const gate = new SessionAdmissionGate()

		gate.claim('session-1')

		const again = gate.claim('session-1')

		expect(again).toEqual({ ok: true, kind: 'reentrant', sessionId: 'session-1' })
		expect(gate.sessionId).toBe('session-1')
	})

	test('admits the next session after the claim is released', () => {
		const gate = new SessionAdmissionGate()
		const first = gate.claim('session-1')

		expect(first.ok && first.kind === 'admitted').toBeTrue()

		if (!first.ok || first.kind !== 'admitted') return

		first.claim.release()

		expect(gate.sessionId).toBeUndefined()

		const second = gate.claim('session-2')

		expect(second).toMatchObject({ ok: true, kind: 'admitted' })
		expect(gate.sessionId).toBe('session-2')
	})

	test('ignores a stale release instead of evicting the session admitted after it', () => {
		const gate = new SessionAdmissionGate()
		const first = gate.claim('session-1')

		if (!first.ok || first.kind !== 'admitted') return

		first.claim.release()
		gate.claim('session-2')
		first.claim.release()

		expect(gate.sessionId).toBe('session-2')
	})
})

describe('session teardown', () => {
	test('unwinds bootstrap steps in reverse order and only once', () => {
		const order: string[] = []
		const teardown = new SessionTeardown()

		teardown.add(() => order.push('claim'))
		teardown.add(() => order.push('reservation'))
		teardown.add(() => order.push('scope'))

		expect(teardown.size).toBe(3)

		teardown.run()

		expect(order).toEqual(['scope', 'reservation', 'claim'])
		expect(teardown.size).toBe(0)

		teardown.run()

		expect(order).toEqual(['scope', 'reservation', 'claim'])
	})

	test('keeps unwinding past a failing step and reports it', () => {
		const order: string[] = []
		const errors: unknown[] = []
		const teardown = new SessionTeardown()

		teardown.add(() => order.push('claim'))
		teardown.add(() => {
			throw new Error('reservation release failed')
		})
		teardown.add(() => order.push('scope'))

		teardown.run((error) => errors.push(error))

		expect(order).toEqual(['scope', 'claim'])
		expect(errors).toHaveLength(1)
		expect((errors[0] as Error).message).toBe('reservation release failed')
	})

	test('leaves the process admissible when a bootstrap stage fails', () => {
		const gate = new SessionAdmissionGate()
		const teardown = new SessionTeardown()
		const admission = gate.claim('session-1')

		if (!admission.ok || admission.kind !== 'admitted') return

		teardown.add(admission.claim.release)

		// Role resolution succeeded and reservation failed, which is the stage the reversal exists for.
		let reserved = true
		teardown.add(() => (reserved = false))

		teardown.run()

		expect(reserved).toBeFalse()
		expect(gate.sessionId).toBeUndefined()
		expect(gate.claim('session-2')).toMatchObject({ ok: true, kind: 'admitted' })
	})
})
