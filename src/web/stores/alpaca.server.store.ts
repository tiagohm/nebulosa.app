import { Api } from '@shared/api'
import { alpacaBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import type { AlpacaConfiguredDevice } from 'nebulosa/src/devices/alpaca/types'
import type { AlpacaServerStatus } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type AlpacaServerStore = typeof alpacaServerStore

export interface AlpacaServerState {
	port: number
	pendingAction?: 'start' | 'stop'
	readonly status: AlpacaServerStatus
}

export const MIN_ALPACA_PORT = 80
export const MAX_ALPACA_PORT = 65535
export const DEFAULT_ALPACA_PORT = 2222

const state = proxy<AlpacaServerState>({
	port: DEFAULT_ALPACA_PORT,
	status: {
		running: false,
		serverPort: 0,
		discoveryPort: 0,
		devices: [],
	},
})

let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return unmount

	console.info('alpaca mounted')

	mounted = true

	u[0] = initProxy(state, 'alpaca', ['p:port'])

	u[1] = alpacaBus.subscribe('start', (status: AlpacaServerStatus) => {
		Object.assign(state.status, status)
	})

	u[2] = alpacaBus.subscribe('add', (device: AlpacaConfiguredDevice) => {
		state.status.devices.push(device)
	})

	u[3] = alpacaBus.subscribe('remove', (device: AlpacaConfiguredDevice) => {
		const index = state.status.devices.findIndex((d) => d.DeviceNumber === device.DeviceNumber && d.DeviceType === device.DeviceType)
		if (index !== -1) state.status.devices.splice(index, 1)
	})

	u[4] = alpacaBus.subscribe('stop', () => {
		Object.assign(state.status, { running: false, serverPort: -1, discoveryPort: -1, devices: [] })
	})

	void status()

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('alpaca unmounted')
	unsubscribe(u)
	mounted = false
}

async function status() {
	const status = await Api.Alpaca.status()
	if (status !== undefined) Object.assign(state.status, status)
	return status
}

function normalizePort(port: unknown) {
	if (typeof port !== 'number' || !Number.isFinite(port)) return DEFAULT_ALPACA_PORT
	return Math.min(MAX_ALPACA_PORT, Math.max(MIN_ALPACA_PORT, Math.trunc(port)))
}

function updatePort(port: number) {
	state.port = normalizePort(port)
}

async function start() {
	try {
		state.pendingAction = 'start'
		await Api.Alpaca.start(state.port)
	} catch (e) {
		// toast({ title: 'ASCOM ALPACA', description: 'Failed to start server', color: 'danger' })
	} finally {
		state.pendingAction = undefined
	}
}

async function stop() {
	try {
		state.pendingAction = 'stop'
		await Api.Alpaca.stop()
	} catch (e) {
		// toast({ title: 'ASCOM ALPACA', description: 'Failed to stop server', color: 'danger' })
	} finally {
		state.pendingAction = undefined
	}
}

export const alpacaServerStore = {
	state,
	mount,
	unmount,
	status,
	updatePort,
	start,
	stop,
} as const
