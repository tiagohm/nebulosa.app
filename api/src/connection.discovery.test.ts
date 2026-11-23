import { afterEach, expect, test } from 'bun:test'
import { networkInterfaces } from 'node:os'
import { AlpacaDiscoveryServer } from 'nebulosa/src/devices/alpaca/discovery'
import { discoverAlpacaServers } from './connection.discovery'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0)) disposable[Symbol.dispose]()
})

// Fake Alpaca management API on every interface, answering its description when given, and a discovery responder on a
// random UDP port that announces it.
async function listenAlpaca(description?: object) {
	const http = Bun.serve({
		hostname: '0.0.0.0',
		port: 0,
		routes: {
			'/management/v1/configureddevices': () =>
				Response.json({
					Value: [
						{ DeviceName: 'Main camera', DeviceType: 'Camera', DeviceNumber: 0, UniqueID: 'a' },
						{ DeviceName: 'Mount', DeviceType: 'Telescope', DeviceNumber: 0, UniqueID: 'b' },
					],
					ErrorNumber: 0,
					ErrorMessage: '',
				}),
			'/management/v1/description': () => (description ? Response.json({ Value: description, ErrorNumber: 0, ErrorMessage: '' }) : new Response(null, { status: 404 })),
		},
	})
	const responder = new AlpacaDiscoveryServer({ ignoreLocalhost: false })
	responder.addPort(http.port!)
	await responder.start('0.0.0.0', 0, false)
	disposables.push({ [Symbol.dispose]: () => (responder.stop(), void http.stop(true)) })
	return { port: http.port!, discoveryPort: responder.port }
}

test('finds a server once with its name, manufacturer, and devices', async () => {
	const { port, discoveryPort } = await listenAlpaca({ ServerName: 'Observatory', Manufacturer: 'ASCOM Initiative', ManufacturerVersion: '7.0', Location: 'Backyard' })
	const servers = (await discoverAlpacaServers({ port: discoveryPort, timeout: 1000 })).filter((s) => s.port === port)

	expect(servers).toEqual([
		{
			host: expect.any(String),
			port,
			name: 'Observatory',
			manufacturer: 'ASCOM Initiative',
			devices: [
				{ name: 'Main camera', type: 'camera' },
				{ name: 'Mount', type: 'telescope' },
			],
		},
	])
	// A server on this machine also answers on loopback; the address another device can reach wins when there is one.
	const external = Object.values(networkInterfaces()).some((list) => list?.some((i) => i.family === 'IPv4' && !i.internal))
	expect(servers[0]?.host.startsWith('127.')).toBe(!external)
})

test('finds a server without a description', async () => {
	const { port, discoveryPort } = await listenAlpaca()
	const server = (await discoverAlpacaServers({ port: discoveryPort, timeout: 1000 })).find((s) => s.port === port)

	expect(server?.name).toBeUndefined()
	expect(server?.devices).toHaveLength(2)
})

test('answers at once when the request is aborted', async () => {
	const { discoveryPort } = await listenAlpaca()
	const controller = new AbortController()
	const started = Date.now()
	const discovery = discoverAlpacaServers({ port: discoveryPort, timeout: 10000, signal: controller.signal })
	controller.abort()

	await discovery
	expect(Date.now() - started).toBeLessThan(2000)
})
