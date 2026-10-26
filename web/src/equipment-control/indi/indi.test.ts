import { describe, expect, test } from 'bun:test'
import type { ClientMessage, IndiNumberProperty, IndiProperty, IndiSnapshotEvent, IndiSwitchProperty, ServerEvent } from 'api'
import { proxy, snapshot as snap } from 'valtio'
import { followIndi, handleIndiEvent, type IndiViewState, newIndiView, pauseIndi, resubscribeIndi, unfollowIndi, writeIndiVector } from './indi'

const target = { connectionId: 'c', hardwareId: 'h' }

function temperature(value: number, revision: number): IndiNumberProperty {
	return {
		type: 'NUMBER',
		device: 'Relay',
		name: 'TEMPERATURE',
		group: 'Sensors',
		state: 'Idle',
		permission: 'rw',
		elementNames: ['TEMP', 'HUMIDITY'],
		revision,
		elements: { TEMP: { name: 'TEMP', format: '%g', min: -50, max: 50, step: 1, value }, HUMIDITY: { name: 'HUMIDITY', format: '%g', min: 0, max: 100, step: 1, value: 40 } },
	}
}

function connection(revision: number): IndiSwitchProperty {
	return { type: 'SWITCH', device: 'Relay', name: 'CONNECTION', state: 'Ok', permission: 'rw', rule: 'OneOfMany', elementNames: ['CONNECT', 'DISCONNECT'], revision, elements: { CONNECT: { name: 'CONNECT', value: true }, DISCONNECT: { name: 'DISCONNECT', value: false } } }
}

function snapshot(vectors: IndiProperty[], epoch = 'e1', revision = 10): IndiSnapshotEvent {
	return { type: 'indi:snapshot', ...target, epoch, revision, device: { ...target, name: 'Relay', connected: true }, vectors, messages: [] }
}

function setup() {
	const state = proxy<IndiViewState>(newIndiView())
	const sent: ClientMessage[] = []
	const send = (message: ClientMessage) => {
		sent.push(message)
		return true
	}
	return { state, sent, send }
}

function ready() {
	const context = setup()
	followIndi(context.state, target, context.send)
	handleIndiEvent(context.state, snapshot([connection(1), temperature(10, 2)]))
	return context
}

function header(revision: number, epoch = 'e1') {
	return { ...target, epoch, revision }
}

function temperatureOf(state: IndiViewState) {
	return (state.vectors.find((vector) => vector.name === 'TEMPERATURE') as IndiNumberProperty | undefined)?.elements.TEMP.value
}

describe('subscription', () => {
	test('follows, pauses, resubscribes, and leaves a device', () => {
		const { state, sent, send } = setup()

		followIndi(state, target, send)
		expect(state.status).toBe('loading')
		handleIndiEvent(state, snapshot([temperature(10, 2)]))
		pauseIndi(state, send)
		pauseIndi(state, send)
		expect(state.status).toBe('paused')
		expect(state.vectors).toHaveLength(1)
		resubscribeIndi(state, send)
		unfollowIndi(state, send)

		expect(sent.map((message) => message.type)).toEqual(['indi:subscribe', 'indi:unsubscribe', 'indi:subscribe', 'indi:unsubscribe'])
		expect(snap(state)).toMatchObject({ status: 'idle', target: undefined, vectors: [] })
	})

	test('following another device unsubscribes the previous one and drops what it showed', () => {
		const { state, sent, send } = ready()

		followIndi(state, { connectionId: 'c', hardwareId: 'other' }, send)

		expect(sent.slice(1)).toEqual([
			{ type: 'indi:unsubscribe', ...target },
			{ type: 'indi:subscribe', connectionId: 'c', hardwareId: 'other' },
		])
		expect(state.vectors).toEqual([])
	})
})

describe('stream', () => {
	test('a snapshot replaces the view, then changes apply in order', () => {
		const { state } = ready()

		handleIndiEvent(state, { type: 'indi:propertyUpdated', ...header(11), kind: 'values', vector: { name: 'TEMPERATURE', revision: 3, state: 'Busy', elements: { TEMP: { name: 'TEMP', format: '%g', min: -50, max: 50, step: 1, value: 12 } } } })
		handleIndiEvent(state, { type: 'indi:propertyDefined', ...header(12), vector: { type: 'LIGHT', device: 'Relay', name: 'STATUS', state: 'Ok', elementNames: ['READY'], revision: 4, elements: { READY: { name: 'READY', value: 'Ok' } } } })
		handleIndiEvent(state, { type: 'indi:message', ...header(13), message: { id: 'm', message: 'armed' } })
		handleIndiEvent(state, { type: 'indi:propertyRemoved', ...header(14), name: 'CONNECTION' })

		expect(state.status).toBe('ready')
		expect(temperatureOf(state)).toBe(12)
		expect(state.vectors.find((vector) => vector.name === 'TEMPERATURE')).toMatchObject({ state: 'Busy', revision: 3, elements: { HUMIDITY: { value: 40 } } })
		expect(state.vectors.map((vector) => vector.name)).toEqual(['TEMPERATURE', 'STATUS'])
		expect(state.definitions).toEqual({ STATUS: 1 })
		expect(state.messages).toEqual([{ id: 'm', message: 'armed' }])
		expect(state.revision).toBe(14)
	})

	test('drops late events, events of another epoch or device, and updates older than the vector', () => {
		const { state } = ready()
		const update = (revision: number, vectorRevision: number, value: number, epoch = 'e1'): ServerEvent => ({
			type: 'indi:propertyUpdated',
			...header(revision, epoch),
			kind: 'values',
			vector: { name: 'TEMPERATURE', revision: vectorRevision, state: 'Idle', elements: { TEMP: { name: 'TEMP', format: '%g', min: -50, max: 50, step: 1, value } } },
		})

		handleIndiEvent(state, update(9, 5, 1))
		handleIndiEvent(state, update(11, 5, 2, 'e0'))
		handleIndiEvent(state, { ...update(11, 5, 3), hardwareId: 'other' } as ServerEvent)
		handleIndiEvent(state, update(11, 1, 4))

		expect(temperatureOf(state)).toBe(10)
		expect(state.revision).toBe(11)
	})

	test('a refusal and a removal are shown, and the next snapshot recovers', () => {
		const { state } = ready()

		handleIndiEvent(state, { type: 'indi:deviceRemoved', ...target })
		expect(snap(state)).toMatchObject({ status: 'removed', vectors: [] })

		handleIndiEvent(state, { type: 'indi:subscriptionError', ...target, code: 'notFound', error: 'gone' })
		expect(snap(state)).toMatchObject({ status: 'refused', error: 'gone' })

		handleIndiEvent(state, snapshot([temperature(20, 7)], 'e2', 3))
		expect(snap(state)).toMatchObject({ status: 'ready', epoch: 'e2', revision: 3, error: undefined })
		expect(temperatureOf(state)).toBe(20)
	})
})

describe('write', () => {
	function fakeFetch(respond: () => Response | Promise<Response>) {
		const requests: { url: string; body: unknown }[] = []
		const request = ((url: string, init?: RequestInit) => {
			requests.push({ url, body: JSON.parse(init?.body as string) })
			return Promise.resolve(respond())
		}) as typeof fetch
		return { requests, request }
	}

	test('names the revision shown and keeps the accepted operation', async () => {
		const { state } = ready()
		const { requests, request } = fakeFetch(() => Response.json({ operationId: 'op' }, { status: 202 }))

		await writeIndiVector(state, 'TEMPERATURE', { TEMP: 15 }, request)

		expect(requests).toEqual([{ url: '/api/connections/c/indi/devices/h/properties/TEMPERATURE', body: { token: expect.any(String), baseRevision: 2, elements: { TEMP: 15 } } }])
		expect(state.writes.TEMPERATURE).toEqual({ sending: false, operationId: 'op' })
	})

	test('a conflict shows the current vector and keeps the refusal', async () => {
		const { state } = ready()
		const { request } = fakeFetch(() => Response.json({ error: 'The property TEMPERATURE changed on the device', code: 'conflict', vector: temperature(13, 9) }, { status: 409 }))

		await writeIndiVector(state, 'TEMPERATURE', { TEMP: 15 }, request)

		expect(temperatureOf(state)).toBe(13)
		expect(state.writes.TEMPERATURE).toMatchObject({ sending: false, code: 'conflict' })
	})

	test('a response for a device the view no longer follows is dropped', async () => {
		const { state, send } = ready()
		const { promise, resolve } = Promise.withResolvers<Response>()
		const { request } = fakeFetch(() => promise)

		const write = writeIndiVector(state, 'TEMPERATURE', { TEMP: 15 }, request)
		expect(state.writes.TEMPERATURE).toEqual({ sending: true })
		unfollowIndi(state, send)
		resolve(Response.json({ operationId: 'op' }, { status: 202 }))
		await write

		expect(state.writes).toEqual({})
	})
})
