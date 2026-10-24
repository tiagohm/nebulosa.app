import type { FocuserBacklashConfig, FocuserBacklashState, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { deviceUrl, jsonInit, responseError } from '../http'

// Backlash compensation of the focusers, as the server reports it. The server owns the settings and applies
// them to every focuser move: this store mirrors the state fetched for each focuser shown and its
// focuserBacklash:updated events, and sends saves. The edits of a panel stay in the panel until applied.

// Mirror of the compensation state of the focusers shown.
export interface FocuserBacklashRuntime {
	// State of each focuser, by focuserBacklashKey.
	states: Record<string, FocuserBacklashState>
	// Why the state of a focuser could not be fetched, by focuserBacklashKey.
	errors: Record<string, string>
}

// Outcome of a save: the new state, a refusal because another tab saved first (the store then holds the
// newer settings), or an error message.
export type FocuserBacklashSaveResult = { readonly status: 'saved' } | { readonly status: 'conflict' } | { readonly status: 'error'; readonly error: string }

// Mirror of the compensation state of the focusers, shared by every component of the tab.
export const focuserBacklashRuntime = proxy<FocuserBacklashRuntime>({ states: {}, errors: {} })

// Key of a focuser in the store.
export function focuserBacklashKey(connectionId: string, deviceId: string) {
	return `${connectionId}:${deviceId}`
}

// Stores the state of a focuser unless the store holds one of a later saved revision.
function upsert(state: FocuserBacklashRuntime, backlash: FocuserBacklashState) {
	const key = focuserBacklashKey(backlash.connectionId, backlash.deviceId)
	const known = state.states[key]
	if (!known || backlash.revision >= known.revision) state.states[key] = backlash
	delete state.errors[key]
}

// Fetches the compensation state of a focuser.
export async function loadFocuserBacklash(state: FocuserBacklashRuntime, connectionId: string, deviceId: string, request: typeof fetch = fetch) {
	const key = focuserBacklashKey(connectionId, deviceId)

	try {
		const response = await request(deviceUrl(connectionId, 'focuser', deviceId, 'backlash'))
		if (response.ok) upsert(state, (await response.json()) as FocuserBacklashState)
		else state.errors[key] = await responseError(response)
	} catch {
		state.errors[key] = 'Unable to reach the server'
	}
}

// Fetches again the state of every focuser in the store, such as after the socket reopened.
export async function refreshFocuserBacklash(state: FocuserBacklashRuntime, request: typeof fetch = fetch) {
	await Promise.all(Object.values(state.states).map(({ connectionId, deviceId }) => loadFocuserBacklash(state, connectionId, deviceId, request)))
}

// Applies a server event to the store; other events are ignored.
export function handleFocuserBacklashEvent(state: FocuserBacklashRuntime, event: ServerEvent) {
	if (event.type === 'focuserBacklash:updated') upsert(state, event.backlash)
}

// Saves the compensation of a focuser, edited from revision.
export async function saveFocuserBacklash(state: FocuserBacklashRuntime, connectionId: string, deviceId: string, config: FocuserBacklashConfig, revision: number, request: typeof fetch = fetch): Promise<FocuserBacklashSaveResult> {
	try {
		const response = await request(deviceUrl(connectionId, 'focuser', deviceId, 'backlash'), jsonInit('PUT', { config, revision }))

		if (response.ok) {
			upsert(state, (await response.json()) as FocuserBacklashState)
			return { status: 'saved' }
		}

		if (response.status === 409) {
			const body = (await response.json()) as { error: string; code: string; backlash?: FocuserBacklashState }
			if (body.code === 'conflict' && body.backlash) {
				upsert(state, body.backlash)
				return { status: 'conflict' }
			}
			return { status: 'error', error: body.error }
		}

		return { status: 'error', error: await responseError(response) }
	} catch {
		return { status: 'error', error: 'Unable to reach the server' }
	}
}
