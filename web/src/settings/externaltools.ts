import type { ExternalToolCapability, ExternalToolCheck, ExternalToolConfig, ExternalToolState, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { responseError } from '../http'

// External programs and web services the server supports (ASTAP, solve-field, nova.astrometry.net), with their
// saved settings and latest check, as the server reports them. The server owns the settings: this store mirrors
// its snapshot and its externalTool:updated events, and sends saves, checks, sign-ins, and sign-outs. An API key is
// only sent with a sign-in, never kept here. The edits of a tab stay in the page until
// saved; a check never saves anything.

// Mirror of the server's external programs.
export interface ExternalToolsState {
	// Supported programs, in the server's display order.
	tools: ExternalToolState[]
	// Whether the snapshot is being fetched.
	loading: boolean
	// Why the last snapshot could not be fetched.
	loadError?: string
}

// Outcome of a save: the new state of the program, a refusal because another client saved first (the
// store then holds the newer settings), or an error message.
export type ExternalToolSaveResult = { readonly status: 'saved'; readonly tool: ExternalToolState } | { readonly status: 'conflict' } | { readonly status: 'error'; readonly error: string }

// Outcome of a check: its result, or an error message when the server could not check.
export type ExternalToolTestResult = { readonly check: ExternalToolCheck } | { readonly error: string }

// Display name of each capability.
export const CAPABILITY_LABELS: Readonly<Record<ExternalToolCapability, string>> = {
	'plate-solving': 'Plate solving',
	'star-detection': 'Star detection',
}

// Mirror of the server's external programs, shared by every component of the tab.
export const externalToolsState = proxy<ExternalToolsState>({ tools: [], loading: false })

// Generation of the latest snapshot fetch; an older response is dropped.
let generation = 0

// Base URL of the routes of a program.
function toolUrl(id: string) {
	return `/api/settings/external-tools/${encodeURIComponent(id)}`
}

// Whether two configurations are the same; an absent field equals an empty one.
export function sameConfig(a: ExternalToolConfig, b: ExternalToolConfig) {
	return a.executable === b.executable && a.timeout === b.timeout && (a.config ?? '') === (b.config ?? '') && (a.endpoint ?? '') === (b.endpoint ?? '')
}

// Whether a check was made with the given configuration, so it still describes it.
export function checkMatches(check: ExternalToolCheck, config: ExternalToolConfig) {
	return sameConfig(check.config, config)
}

// Whether state b of a program is at least as recent as state a: a later saved revision, or the same
// revision with a check at least as recent.
function isNewer(a: ExternalToolState, b: ExternalToolState) {
	return b.revision > a.revision || (b.revision === a.revision && (b.lastCheck?.checkedAt ?? 0) >= (a.lastCheck?.checkedAt ?? 0))
}

// Stores the state of a program unless the store already holds a more recent one.
function upsert(state: ExternalToolsState, tool: ExternalToolState) {
	const index = state.tools.findIndex((t) => t.id === tool.id)
	if (index < 0) state.tools.push(tool)
	else if (isNewer(state.tools[index], tool)) state.tools[index] = tool
}

// Fetches the supported programs. A response is dropped when another fetch started meanwhile, and a state
// received from an event while it was in flight is kept when more recent.
export async function refreshExternalTools(state: ExternalToolsState, request: typeof fetch = fetch) {
	const current = ++generation
	state.loading = true

	try {
		const response = await request('/api/settings/external-tools')
		if (current !== generation) return

		if (!response.ok) {
			state.loadError = await responseError(response)
			return
		}

		const tools = (await response.json()) as ExternalToolState[]
		if (current !== generation) return

		state.tools = tools.map((tool) => {
			const known = state.tools.find((t) => t.id === tool.id)
			return known && !isNewer(known, tool) ? known : tool
		})
		state.loadError = undefined
	} catch {
		if (current === generation) state.loadError = 'Unable to reach the server'
	} finally {
		if (current === generation) state.loading = false
	}
}

// Applies a server event to the store; other events are ignored.
export function handleExternalToolEvent(state: ExternalToolsState, event: ServerEvent) {
	if (event.type === 'externalTool:updated') upsert(state, event.tool)
}

// Saves the settings of a program, edited from revision.
export async function saveExternalTool(state: ExternalToolsState, id: string, config: ExternalToolConfig, revision: number, request: typeof fetch = fetch): Promise<ExternalToolSaveResult> {
	try {
		const response = await request(toolUrl(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config, revision }) })

		if (response.ok) {
			const tool = (await response.json()) as ExternalToolState
			upsert(state, tool)
			return { status: 'saved', tool }
		}

		if (response.status === 409) {
			const body = (await response.json()) as { error: string; code: string; tool?: ExternalToolState }
			if (body.code === 'conflict' && body.tool) {
				upsert(state, body.tool)
				return { status: 'conflict' }
			}
			return { status: 'error', error: body.error }
		}

		return { status: 'error', error: await responseError(response) }
	} catch {
		return { status: 'error', error: 'Unable to reach the server' }
	}
}

// Checks settings of a program on the server without saving them; the server never runs the program.
export async function testExternalTool(id: string, config: ExternalToolConfig, request: typeof fetch = fetch): Promise<ExternalToolTestResult> {
	try {
		const response = await request(`${toolUrl(id)}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) })
		if (!response.ok) return { error: await responseError(response) }
		return { check: (await response.json()) as ExternalToolCheck }
	} catch {
		return { error: 'Unable to reach the server' }
	}
}

// Outcome of signing in or out of a web service: its new state, or an error message.
export type ExternalToolLoginResult = { readonly tool: ExternalToolState } | { readonly error: string }

// Signs in to a web service with the API key of an account; the server sends it once to the service and stores
// only the session it returns.
export function signInExternalTool(state: ExternalToolsState, id: string, apiKey: string, request: typeof fetch = fetch) {
	return changeSession(state, `${toolUrl(id)}/login`, JSON.stringify({ apiKey }), request)
}

// Signs out of a web service: the server removes its saved session.
export function signOutExternalTool(state: ExternalToolsState, id: string, request: typeof fetch = fetch) {
	return changeSession(state, `${toolUrl(id)}/logout`, undefined, request)
}

// Posts a sign-in or sign-out and stores the new state of the service.
async function changeSession(state: ExternalToolsState, url: string, body: string | undefined, request: typeof fetch): Promise<ExternalToolLoginResult> {
	try {
		const response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
		if (!response.ok) return { error: await responseError(response) }
		const tool = (await response.json()) as ExternalToolState
		upsert(state, tool)
		return { tool }
	} catch {
		return { error: 'Unable to reach the server' }
	}
}
