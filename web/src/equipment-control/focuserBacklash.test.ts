import { expect, test } from 'bun:test'
import type { FocuserBacklashState } from 'api'
import { proxy } from 'valtio'
import { type FocuserBacklashRuntime, focuserBacklashKey, handleFocuserBacklashEvent, loadFocuserBacklash, saveFocuserBacklash } from './focuserBacklash'

function backlash(patch: Partial<FocuserBacklashState> = {}): FocuserBacklashState {
	return { connectionId: 'c', deviceId: 'f', config: { enabled: false, mode: 'OVERSHOOT', backlashIn: 0, backlashOut: 0 }, revision: 0, offset: 0, ...patch }
}

// Fetch fake answering every request with the response respond builds.
function fakeFetch(respond: () => Response) {
	return (() => Promise.resolve(respond())) as unknown as typeof fetch
}

function newState(): FocuserBacklashRuntime {
	return proxy<FocuserBacklashRuntime>({ states: {}, errors: {} })
}

test('loads a focuser and keeps a later revision received from an event', async () => {
	const state = newState()
	handleFocuserBacklashEvent(state, { type: 'focuserBacklash:updated', backlash: backlash({ revision: 2, offset: -50 }) })
	await loadFocuserBacklash(
		state,
		'c',
		'f',
		fakeFetch(() => Response.json(backlash({ revision: 1 }))),
	)
	expect(state.states[focuserBacklashKey('c', 'f')]).toMatchObject({ revision: 2, offset: -50 })

	handleFocuserBacklashEvent(state, { type: 'focuserBacklash:updated', backlash: backlash({ revision: 2, offset: 0 }) })
	expect(state.states[focuserBacklashKey('c', 'f')]?.offset).toBe(0)
})

test('records why a focuser could not be loaded', async () => {
	const state = newState()
	await loadFocuserBacklash(
		state,
		'c',
		'f',
		fakeFetch(() => Response.json({ error: 'Focuser not found' }, { status: 404 })),
	)
	expect(state.errors[focuserBacklashKey('c', 'f')]).toBe('Focuser not found')
})

test('a save refused by a newer revision stores the newer settings', async () => {
	const state = newState()
	const config = { enabled: true, mode: 'ABSOLUTE', backlashIn: 10, backlashOut: 10 } as const
	const newer = backlash({ revision: 3, config: { enabled: true, mode: 'OVERSHOOT', backlashIn: 5, backlashOut: 5 } })

	expect(
		await saveFocuserBacklash(
			state,
			'c',
			'f',
			config,
			1,
			fakeFetch(() => Response.json({ error: 'changed', code: 'conflict', backlash: newer }, { status: 409 })),
		),
	).toEqual({ status: 'conflict' })
	expect(state.states[focuserBacklashKey('c', 'f')]).toEqual(newer)

	expect(
		await saveFocuserBacklash(
			state,
			'c',
			'f',
			config,
			3,
			fakeFetch(() => Response.json(backlash({ revision: 4, config }))),
		),
	).toEqual({ status: 'saved' })
	expect(state.states[focuserBacklashKey('c', 'f')]?.config).toEqual(config)
})
