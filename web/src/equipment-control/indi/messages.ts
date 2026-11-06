import type { IndiDeviceMessage, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { formatDateTime } from '../../format'
import type { IndiSend, IndiTarget } from './indi'

// Messages view of one physical device of an INDI connection: the <message> elements its driver sent, which the
// server keeps for the open connection and streams to this tab's socket while the view is shown. Like the INDI
// Properties view, it is not a mirror of SERVER_STORES: following subscribes (indi:messagesSubscribe), the server
// answers with a snapshot of what it kept on the same socket and then each new message of that device only, and
// leaving unsubscribes. The subscription belongs to the socket, so it is sent again on every socket open, and each
// snapshot replaces the view. A message of another epoch (an earlier client of the connection) or older than the
// last event applied is dropped. While the socket is closed the view keeps what it shows, marked disconnected.

// Messages kept by the view, oldest dropped first; the server keeps as many per device.
export const MAX_MESSAGES = 100

// Phase of the view: idle without a target, loading until the snapshot arrives, ready once it did, paused while
// the page is hidden, refused when the server refused the subscription, removed when the device left the directory,
// disconnected while the socket of the tab is closed.
export type IndiMessagesStatus = 'idle' | 'loading' | 'ready' | 'paused' | 'refused' | 'removed' | 'disconnected'

// State of the view.
export interface IndiMessagesViewState {
	// Device followed; absent while the view follows none.
	target?: IndiTarget
	// Phase of the view.
	status: IndiMessagesStatus
	// Why the subscription was refused.
	error?: string
	// Epoch of the latest snapshot; messages of another epoch are dropped.
	epoch?: string
	// Revision of the latest event applied; older events are dropped.
	revision: number
	// Messages of the device, oldest first, at most MAX_MESSAGES.
	messages: IndiDeviceMessage[]
}

// Creates the state of a view that follows no device.
export function newIndiMessagesView(): IndiMessagesViewState {
	return { status: 'idle', revision: 0, messages: [] }
}

// Messages view of the tab.
export const indiMessagesView = proxy<IndiMessagesViewState>(newIndiMessagesView())

// Whether two targets name the same device.
function sameTarget(a: IndiTarget | undefined, b: IndiTarget | undefined) {
	return a?.connectionId === b?.connectionId && a?.hardwareId === b?.hardwareId
}

// Drops everything the view shows of a device.
function clear(state: IndiMessagesViewState) {
	state.error = undefined
	state.epoch = undefined
	state.revision = 0
	state.messages = []
}

// Starts following a device, or keeps following it when it is already the target: the view waits for the snapshot
// the subscription is answered with. A socket that is not open subscribes when it opens (resubscribeMessages).
export function followMessages(state: IndiMessagesViewState, target: IndiTarget, send: IndiSend) {
	if (!sameTarget(state.target, target)) {
		if (state.target) send({ type: 'indi:messagesUnsubscribe', ...state.target })
		clear(state)
		state.target = { ...target }
	}

	state.status = 'loading'
	send({ type: 'indi:messagesSubscribe', ...target })
}

// Stops following the device: unsubscribes and drops what the view shows.
export function unfollowMessages(state: IndiMessagesViewState, send: IndiSend) {
	if (state.target) send({ type: 'indi:messagesUnsubscribe', ...state.target })
	state.target = undefined
	state.status = 'idle'
	clear(state)
}

// Pauses the subscription while the view is hidden, keeping what it shows until following the same device again
// brings a fresh snapshot.
export function pauseMessages(state: IndiMessagesViewState, send: IndiSend) {
	if (!state.target || state.status === 'paused') return
	send({ type: 'indi:messagesUnsubscribe', ...state.target })
	state.status = 'paused'
}

// Subscribes again after the socket opened, since the server ended the subscriptions of the closed one; what the
// view shows stays until the new snapshot replaces it.
export function resubscribeMessages(state: IndiMessagesViewState, send: IndiSend) {
	if (!state.target) return
	state.status = 'loading'
	send({ type: 'indi:messagesSubscribe', ...state.target })
}

// Marks the view disconnected after the socket of the tab closed, keeping what it shows.
export function disconnectMessages(state: IndiMessagesViewState) {
	if (state.target && state.status !== 'paused') state.status = 'disconnected'
}

// Applies a server event to the view: the stream of the followed device, its refusal, and its removal from the
// directory. Events of any other device are ignored.
export function handleMessagesEvent(state: IndiMessagesViewState, event: ServerEvent) {
	const { target } = state
	if (!target) return

	switch (event.type) {
		case 'indi:messagesSnapshot':
			if (!sameTarget(target, event)) return
			state.status = 'ready'
			state.error = undefined
			state.epoch = event.epoch
			state.revision = event.revision
			state.messages = event.messages.slice(-MAX_MESSAGES)
			return
		case 'indi:messagesSubscriptionError':
			if (!sameTarget(target, event)) return
			state.status = 'refused'
			state.error = event.error
			return
		case 'indi:deviceRemoved':
			if (sameTarget(target, event)) state.status = 'removed'
			return
		case 'indi:messageReceived':
			if (!sameTarget(target, event) || event.epoch !== state.epoch || !(event.revision > state.revision)) return
			state.revision = event.revision
			state.messages = [...state.messages, event.message].slice(-MAX_MESSAGES)
	}
}

// Returns the messages whose text contains the query, ignoring case; every message for a blank query.
export function searchMessages(messages: readonly IndiDeviceMessage[], query: string): readonly IndiDeviceMessage[] {
	const needle = query.trim().toLowerCase()
	return needle ? messages.filter((message) => message.text.toLowerCase().includes(needle)) : messages
}

// Returns messages as plain text for the clipboard, one line per message separated by tabs: the instant of receipt
// in the zone, the device name, and the text, which keeps its own line breaks.
export function messagesText(messages: readonly IndiDeviceMessage[], device: string, timeZone: string) {
	return messages.map((message) => `${formatDateTime(message.receivedAt, timeZone)}\t${device}\t${message.text}`).join('\n')
}
