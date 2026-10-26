import type { ClientMessage, CommandAccepted, IndiDeviceSummary, IndiErrorCode, IndiMessage, IndiProperty, IndiPropertyUpdate, IndiWriteRequest, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import { jsonInit } from '../../http'

// INDI Properties view of one physical device: the vectors the server streams to this tab's socket while the
// view is shown, and the writes the view started. Unlike the mirrors of SERVER_STORES, it lives only while the
// view follows a device: following subscribes (indi:subscribe), and the server answers with a snapshot on the
// same socket and then the changes of that device only; leaving unsubscribes, so nothing is streamed to a tab
// that does not show it. The subscription belongs to the socket, so it is sent again on every socket open and
// each snapshot replaces the view. A change of another epoch (an earlier connection of the device) or older
// than the last one applied is dropped, and a vector update older than the vector it would apply to too.

// Latest driver messages kept by the view, newest last; the server keeps as many for the snapshot.
export const MAX_MESSAGES = 20

// Physical device a view follows.
export interface IndiTarget {
	// Id of the open connection of the device.
	readonly connectionId: string
	// Id of the physical device.
	readonly hardwareId: string
}

// Phase of the view: idle without a target, loading until the snapshot arrives, ready once it did, paused while
// the page is hidden, refused when the server refused the subscription, removed when the device left the directory.
export type IndiViewStatus = 'idle' | 'loading' | 'ready' | 'paused' | 'refused' | 'removed'

// A write the view started for a vector.
export interface IndiVectorWrite {
	// Whether the request is in flight.
	readonly sending: boolean
	// Operation the server started for it, once accepted; its outcome arrives as operation:updated.
	readonly operationId?: string
	// Why the server refused it.
	readonly error?: string
	// Stable code of the refusal.
	readonly code?: IndiErrorCode
}

// State of the view.
export interface IndiViewState {
	// Device followed; absent while the view follows none.
	target?: IndiTarget
	// Phase of the view.
	status: IndiViewStatus
	// Why the subscription was refused.
	error?: string
	// The device as the latest snapshot named it.
	device?: IndiDeviceSummary
	// Epoch of the latest snapshot; changes of another epoch are dropped.
	epoch?: string
	// Revision of the latest event applied; older events are dropped.
	revision: number
	// Vectors of the device, in driver order.
	vectors: IndiProperty[]
	// Times each vector was defined since the latest snapshot, by name, so a redefinition discards the drafts of
	// the vector it replaces.
	definitions: Record<string, number>
	// Latest driver messages, newest last.
	messages: IndiMessage[]
	// Latest write of each vector, by name.
	writes: Record<string, IndiVectorWrite>
}

// Sends a control message over the socket of the tab; returns false when the socket is not open.
export type IndiSend = (message: ClientMessage) => boolean

// Creates the state of a view that follows no device.
export function newIndiView(): IndiViewState {
	return { status: 'idle', revision: 0, vectors: [], definitions: {}, messages: [], writes: {} }
}

// View of the INDI properties of the tab.
export const indiView = proxy<IndiViewState>(newIndiView())

// Whether two targets name the same device.
function sameTarget(a: IndiTarget | undefined, b: IndiTarget | undefined) {
	return a?.connectionId === b?.connectionId && a?.hardwareId === b?.hardwareId
}

// Drops everything the view shows of a device.
function clear(state: IndiViewState) {
	state.error = undefined
	state.device = undefined
	state.epoch = undefined
	state.revision = 0
	state.vectors = []
	state.definitions = {}
	state.messages = []
	state.writes = {}
}

// Starts following a device, or keeps following it when it is already the target: the view waits for the
// snapshot the subscription is answered with. A socket that is not open subscribes when it opens
// (resubscribeIndi).
export function followIndi(state: IndiViewState, target: IndiTarget, send: IndiSend) {
	if (!sameTarget(state.target, target)) {
		if (state.target) send({ type: 'indi:unsubscribe', ...state.target })
		clear(state)
		state.target = { ...target }
	}

	state.status = 'loading'
	send({ type: 'indi:subscribe', ...target })
}

// Stops following the device: unsubscribes and drops what the view shows.
export function unfollowIndi(state: IndiViewState, send: IndiSend) {
	if (state.target) send({ type: 'indi:unsubscribe', ...state.target })
	state.target = undefined
	state.status = 'idle'
	clear(state)
}

// Pauses the subscription while the view is hidden, keeping what it shows (and the drafts of its editors) until
// following the same device again brings a fresh snapshot.
export function pauseIndi(state: IndiViewState, send: IndiSend) {
	if (!state.target || state.status === 'paused') return
	send({ type: 'indi:unsubscribe', ...state.target })
	state.status = 'paused'
}

// Subscribes again after the socket opened, since the server ended the subscriptions of the closed one; the new
// snapshot replaces the view.
export function resubscribeIndi(state: IndiViewState, send: IndiSend) {
	if (!state.target) return
	state.status = 'loading'
	send({ type: 'indi:subscribe', ...state.target })
}

// Applies a server event to the view: the stream of the followed device, its refusal, and its removal from the
// directory. Events of any other device are ignored.
export function handleIndiEvent(state: IndiViewState, event: ServerEvent) {
	const { target } = state
	if (!target) return

	switch (event.type) {
		case 'indi:snapshot':
			if (!sameTarget(target, event)) return
			state.status = 'ready'
			state.error = undefined
			state.device = event.device
			state.epoch = event.epoch
			state.revision = event.revision
			state.vectors = [...event.vectors]
			state.definitions = {}
			state.messages = [...event.messages]
			return
		case 'indi:subscriptionError':
			if (!sameTarget(target, event)) return
			state.status = 'refused'
			state.error = event.error
			return
		case 'indi:deviceRemoved':
			if (!sameTarget(target, event)) return
			clear(state)
			state.status = 'removed'
			return
		case 'indi:propertyDefined':
		case 'indi:propertyUpdated':
		case 'indi:propertyRemoved':
		case 'indi:message':
			if (!sameTarget(target, event) || event.epoch !== state.epoch || !(event.revision > state.revision)) return
			state.revision = event.revision

			if (event.type === 'indi:propertyDefined') {
				state.vectors = [...state.vectors.filter((vector) => vector.name !== event.vector.name), event.vector]
				state.definitions[event.vector.name] = (state.definitions[event.vector.name] ?? 0) + 1
			} else if (event.type === 'indi:propertyUpdated') {
				applyUpdate(state, event.vector)
			} else if (event.type === 'indi:propertyRemoved') {
				state.vectors = state.vectors.filter((vector) => vector.name !== event.name)
				delete state.writes[event.name]
			} else {
				state.messages = [...state.messages, event.message].slice(-MAX_MESSAGES)
			}
	}
}

// Applies the changing part of a vector, unless the vector already is at that revision or later.
function applyUpdate(state: IndiViewState, update: IndiPropertyUpdate) {
	const vector = state.vectors.find((candidate) => candidate.name === update.name)
	if (!vector || !(update.revision > vector.revision)) return

	vector.revision = update.revision
	vector.state = update.state
	vector.message = update.message
	vector.timestamp = update.timestamp
	if (vector.type !== 'LIGHT') vector.timeout = update.timeout

	const elements = vector.elements as Record<string, unknown>
	for (const [name, element] of Object.entries(update.elements)) if (name in elements) elements[name] = element
}

// Replaces a vector with the current one a refused write answered with, unless the view already has it or later.
function applyVector(state: IndiViewState, vector: IndiProperty) {
	const index = state.vectors.findIndex((candidate) => candidate.name === vector.name)
	if (index >= 0 && vector.revision > state.vectors[index].revision) state.vectors[index] = vector
}

// Writes values to a vector of the followed device, naming the revision the view shows so a vector that changed
// meanwhile is refused as a conflict, whose current vector then replaces the one shown. Values left out are
// completed by the server (see IndiWriteRequest). The write's state is kept per vector until the next one; a
// response for a device the view no longer follows is dropped.
export async function writeIndiVector(state: IndiViewState, name: string, elements: IndiWriteRequest['elements'], request: typeof fetch = fetch) {
	const target = state.target
	const vector = state.vectors.find((candidate) => candidate.name === name)
	if (!target || !vector || state.writes[name]?.sending) return

	state.writes[name] = { sending: true }

	const url = `/api/connections/${encodeURIComponent(target.connectionId)}/indi/devices/${encodeURIComponent(target.hardwareId)}/properties/${encodeURIComponent(name)}`
	const body: IndiWriteRequest = { token: nanoid(), baseRevision: vector.revision, elements }

	try {
		const response = await request(url, jsonInit('POST', body))
		if (!sameTarget(state.target, target)) return

		if (response.ok) {
			const { operationId } = (await response.json()) as CommandAccepted
			state.writes[name] = { sending: false, operationId }
			return
		}

		const refusal = (await response.json()) as { error?: string; code?: IndiErrorCode; vector?: IndiProperty }
		if (!sameTarget(state.target, target)) return
		if (refusal.code === 'conflict' && refusal.vector) applyVector(state, refusal.vector)
		state.writes[name] = { sending: false, error: refusal.error ?? `${response.status} ${response.statusText}`.trim(), code: refusal.code }
	} catch {
		if (sameTarget(state.target, target)) state.writes[name] = { sending: false, error: 'The server could not be reached' }
	}
}
