import { expect, test } from 'bun:test'
import type { IndiDeviceSummary } from 'api'
import { proxy } from 'valtio'
import { handleIndiDirectoryEvent, type IndiDirectoryState, refreshIndiDirectory, watchIndiDirectory } from './directory'

function device(hardwareId: string, connectionId = 'c', connected?: boolean): IndiDeviceSummary {
	return { connectionId, hardwareId, name: hardwareId, connected }
}

test('lists the watched connection, replaying the events received while it loads', async () => {
	const state = proxy<IndiDirectoryState>({ devices: [], loading: false })
	const { promise, resolve } = Promise.withResolvers<Response>()
	const urls: string[] = []
	const request = ((url: string) => {
		urls.push(url)
		return promise
	}) as typeof fetch

	watchIndiDirectory(state, 'c', request)
	expect(state.loading).toBeTrue()
	handleIndiDirectoryEvent(state, { type: 'indi:deviceAdded', device: device('relay') }, request)
	handleIndiDirectoryEvent(state, { type: 'indi:deviceAdded', device: device('other', 'x') }, request)
	resolve(Response.json([device('mount', 'c', true)]))
	await Promise.resolve()
	await Bun.sleep(0)

	expect(urls).toEqual(['/api/connections/c/indi/devices'])
	expect(state.loading).toBeFalse()
	expect(state.devices.map((d) => d.hardwareId)).toEqual(['mount', 'relay'])

	handleIndiDirectoryEvent(state, { type: 'indi:deviceUpdated', device: device('relay', 'c', true) }, request)
	handleIndiDirectoryEvent(state, { type: 'indi:deviceRemoved', connectionId: 'c', hardwareId: 'mount' }, request)
	expect(state.devices).toEqual([device('relay', 'c', true)])

	handleIndiDirectoryEvent(state, { type: 'connection:close', id: 'c' }, request)
	expect(state.devices).toEqual([])
})

test('a connection that is not INDI lists no device', async () => {
	const state = proxy<IndiDirectoryState>({ watched: 's', devices: [device('stale', 's')], loading: false })
	await refreshIndiDirectory(state, (() => Promise.resolve(Response.json({ error: 'no', code: 'unsupported' }, { status: 422 }))) as unknown as typeof fetch)
	expect(state.devices).toEqual([])
})
