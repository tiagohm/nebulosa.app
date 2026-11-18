import type { FramingDocument, FramingDuplicateRequest, FramingsSnapshot, Framing as SavedFraming, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import { type ApiFetch, ApiResponseError, browserFetch, fetchJson, jsonInit, responseError } from '../http'

// Mirror of the framings of the server (GET /api/framings and framing:updated / framing:removed), one catalog shared by
// every profile, tab, and browser, with the drafts the tab is writing. An edit becomes a draft written whole a moment
// later from the revision it was made on, one write at a time per framing; a framing another tab saved first is a
// conflict the operator resolves (keep theirs or save mine), never overwritten silently. A read never brings back an older
// revision than an event already applied, nor a framing removed while it was in flight.

export type { SavedFraming }

// Delay between the latest edit of a framing and its write, in milliseconds.
const SAVE_DELAY_MS = 400

// Requests of the mirror, replaced in tests.
export interface FramingsIo {
	// Performs HTTP requests to the API.
	readonly fetch: ApiFetch
	// Schedules a delayed write, returning its cancellation.
	readonly later: (run: () => void, delay: number) => () => void
	// Generates the id of a new framing.
	readonly id: () => string
}

// Browser implementation of FramingsIo.
export const browserFramingsIo: FramingsIo = {
	fetch: browserFetch,
	later: (run, delay) => {
		const timer = setTimeout(run, delay)
		return () => clearTimeout(timer)
	},
	id: () => nanoid(),
}

// Saved framings of the server as the tab knows them, with the drafts the tab is writing.
export interface FramingsState {
	// Saved framings, by id.
	framings: Record<string, SavedFraming>
	// Whether the framings were read once.
	loaded: boolean
	// Documents edited and not yet saved, by framing id, with the revision they were edited from.
	drafts: Record<string, { document: FramingDocument; revision: number }>
	// Framings whose write is in flight.
	saving: Record<string, true>
	// Framings whose last write found another revision: what the server kept (null when it was deleted).
	conflicts: Record<string, SavedFraming | null>
	// Why the last write of a framing failed, such as a name another framing has.
	errors: Record<string, string>
}

// Mirror of the framings of the tab.
export const framingsState = proxy<FramingsState>({ framings: {}, loaded: false, drafts: {}, saving: {}, conflicts: {}, errors: {} })

// Generation of the latest read, so an older answer never replaces a newer one.
let generation = 0

// Ids of the framings removed since the latest read started, which its answer may still list.
let removedSinceRead = new Set<string>()

// Pending writes of the framings, by id.
const scheduled = new Map<string, () => void>()

// Returns a plain copy of a JSON value, such as a document read from a valtio proxy or snapshot.
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

// Returns the message of a failure.
function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

// Returns the fields of a framing document, without what the server adds.
function documentOf({ name, optics, rotation, color }: FramingDocument): FramingDocument {
	return { name, optics, rotation, color }
}

// Keeps a framing unless the tab already knows a newer revision of it.
function applyFraming(state: FramingsState, framing: SavedFraming) {
	const known = state.framings[framing.id]
	if (!known || known.revision <= framing.revision) state.framings[framing.id] = framing
}

// Reads every framing, keeping the newer revisions events brought while the read was in flight and leaving out the
// framings removed meanwhile.
export async function refreshFramings(state: FramingsState, io: Pick<FramingsIo, 'fetch'> = browserFramingsIo) {
	const current = ++generation
	removedSinceRead = new Set()

	try {
		const { framings } = await fetchJson<FramingsSnapshot>(io, '/api/framings')
		if (current !== generation) return
		const listed = new Set(framings.map((framing) => framing.id))
		for (const id of Object.keys(state.framings)) if (!listed.has(id) && !state.drafts[id]) delete state.framings[id]
		for (const framing of framings) if (!removedSinceRead.has(framing.id)) applyFraming(state, framing)
		state.loaded = true
	} catch {
		// Read again on the next socket open.
	}
}

// Applies an event of the framings.
export function handleFramingEvent(state: FramingsState, event: ServerEvent) {
	if (event.type === 'framing:updated') applyFraming(state, event.framing)
	else if (event.type === 'framing:removed') {
		removedSinceRead.add(event.id)
		delete state.framings[event.id]
		delete state.drafts[event.id]
	}
}

// Returns the document of a framing as the tab shows it: its draft, or what the server saved.
export function framingDocument(state: Pick<FramingsState, 'framings' | 'drafts'>, id: string): FramingDocument | undefined {
	return state.drafts[id]?.document ?? state.framings[id]
}

// Returns the framings as the tab shows them (drafts applied), by name without regard to case.
export function sortedFramings(state: Pick<FramingsState, 'framings' | 'drafts'>): SavedFraming[] {
	return Object.values(state.framings)
		.map((framing) => {
			const draft = state.drafts[framing.id]
			return draft ? Object.assign({}, framing, draft.document) : framing
		})
		.toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
}

// Whether the edits of a framing reached the server: saved, being written (or waiting to be), refused by another
// revision, or failed.
export type FramingSaveStatus = 'saved' | 'saving' | 'conflict' | 'failed'

// Returns how far the edits of a framing got.
export function framingSaveStatus(state: Pick<FramingsState, 'drafts' | 'saving' | 'conflicts' | 'errors'>, id: string): FramingSaveStatus {
	if (id in state.conflicts) return 'conflict'
	if (state.errors[id]) return 'failed'
	return state.drafts[id] || state.saving[id] ? 'saving' : 'saved'
}

// Changes the document of a saved framing and writes it a moment later; edits made meanwhile go in the same write.
export function editFraming(state: FramingsState, id: string, change: (document: FramingDocument) => FramingDocument, io: FramingsIo = browserFramingsIo) {
	const current = state.drafts[id] ?? (state.framings[id] && { document: documentOf(state.framings[id]), revision: state.framings[id].revision })
	if (!current) return
	state.drafts[id] = { document: change(plain(current.document)), revision: current.revision }
	delete state.errors[id]
	scheduled.get(id)?.()
	scheduled.set(
		id,
		io.later(() => {
			scheduled.delete(id)
			void flushFraming(state, id, io)
		}, SAVE_DELAY_MS),
	)
}

// Writes the draft of a framing, one write at a time; a draft changed during the write is written again after it. A
// failed write, such as a name another framing has, keeps the draft until the next edit.
export async function flushFraming(state: FramingsState, id: string, io: FramingsIo = browserFramingsIo) {
	const draft = state.drafts[id]
	if (!draft || state.saving[id] || id in state.conflicts) return
	const sent = draft.document
	state.saving[id] = true
	delete state.errors[id]

	try {
		const response = await io.fetch(`/api/framings/${encodeURIComponent(id)}`, jsonInit('PUT', { ...documentOf(sent), revision: draft.revision }))
		const body = response.status === 409 ? ((await response.clone().json()) as { code?: string; framing?: SavedFraming | null }) : undefined

		if (body?.code === 'conflict') {
			state.conflicts[id] = body.framing ?? null
		} else if (!response.ok) {
			state.errors[id] = await responseError(response)
		} else {
			const framing = (await response.json()) as SavedFraming
			applyFraming(state, framing)
			const latest = state.drafts[id]
			if (latest && latest.document !== sent) latest.revision = framing.revision
			else delete state.drafts[id]
		}
	} catch (error) {
		state.errors[id] = errorMessage(error)
	}

	delete state.saving[id]
	if (state.drafts[id] && state.drafts[id].document !== sent && !(id in state.conflicts) && !state.errors[id]) await flushFraming(state, id, io)
}

// Ends a conflict by keeping what the server saved, dropping the tab's draft.
export function discardFramingDraft(state: FramingsState, id: string) {
	delete state.drafts[id]
	delete state.conflicts[id]
	delete state.errors[id]
}

// Ends a conflict by writing the tab's draft over what the server saved, as the operator asked.
export async function overwriteFraming(state: FramingsState, id: string, io: FramingsIo = browserFramingsIo) {
	const draft = state.drafts[id]
	if (!draft || !(id in state.conflicts)) return
	draft.revision = state.conflicts[id]?.revision ?? 0
	delete state.conflicts[id]
	await flushFraming(state, id, io)
}

// Creates a framing and returns its id; rejects with the server's reason, such as a name another framing has.
export async function createFraming(state: FramingsState, document: FramingDocument, io: FramingsIo = browserFramingsIo) {
	const id = io.id()
	const framing = await fetchJson<SavedFraming>(io, `/api/framings/${encodeURIComponent(id)}`, jsonInit('PUT', { ...documentOf(document), revision: 0 }))
	applyFraming(state, framing)
	return id
}

// Copies a framing under a new name and colour and returns the id of the copy; rejects with the server's reason.
export async function duplicateFraming(state: FramingsState, id: string, name: string, color: number, io: FramingsIo = browserFramingsIo) {
	const copy = io.id()
	const framing = await fetchJson<SavedFraming>(io, `/api/framings/${encodeURIComponent(id)}/duplicate`, jsonInit('POST', { id: copy, name, color } satisfies FramingDuplicateRequest))
	applyFraming(state, framing)
	return copy
}

// Deletes a framing at the revision the tab knows; a newer revision is a conflict. Rejects with the server's reason.
export async function deleteFraming(state: FramingsState, id: string, io: FramingsIo = browserFramingsIo) {
	const framing = state.framings[id]
	if (!framing) return
	scheduled.get(id)?.()
	scheduled.delete(id)
	const response = await io.fetch(`/api/framings/${encodeURIComponent(id)}?revision=${framing.revision}`, { method: 'DELETE' })

	if (response.status === 409) {
		state.conflicts[id] = ((await response.json()) as { framing: SavedFraming | null }).framing
	} else if (!response.ok && response.status !== 404) {
		throw new ApiResponseError(await responseError(response), response.status)
	} else {
		delete state.framings[id]
		delete state.drafts[id]
		delete state.errors[id]
	}
}

// Returns a name for a copy of a framing that no framing has yet: "<name> copy", then "<name> copy 2", and so on.
export function copyName(state: Pick<FramingsState, 'framings'>, name: string) {
	const taken = new Set(Object.values(state.framings).map((framing) => framing.name.toLowerCase()))
	let candidate = `${name} copy`
	for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${name} copy ${i}`
	return candidate
}
