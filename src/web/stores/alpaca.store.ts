import type { AlpacaConfiguredDevice } from 'nebulosa/src/devices/alpaca/types'
import bus from 'src/shared/bus'
import type { AlpacaServerStatus } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'

export type AlpacaStore = typeof alpacaStore

export interface AlpacaState {
	show: boolean
	port: number
	pendingAction?: 'start' | 'stop'
	readonly status: AlpacaServerStatus
}

export const MIN_ALPACA_PORT = 80
export const MAX_ALPACA_PORT = 65535
export const DEFAULT_ALPACA_PORT = 2222

const state = proxy<AlpacaState>({
	show: false,
	port: DEFAULT_ALPACA_PORT,
	status: {
		running: false,
		serverPort: 0,
		discoveryPort: 0,
		devices: [],
	},
})

initProxy(state, 'alpaca', ['p:show', 'p:port'])

bus.subscribe('alpaca:start', (status: AlpacaServerStatus) => {
	Object.assign(state.status, status)
})

bus.subscribe('alpaca:device:add', (device: AlpacaConfiguredDevice) => {
	state.status.devices.push(device)
})

bus.subscribe('alpaca:device:remove', (device: AlpacaConfiguredDevice) => {
	const index = state.status.devices.findIndex((d) => d.DeviceNumber === device.DeviceNumber && d.DeviceType === device.DeviceType)
	if (index !== -1) state.status.devices.splice(index, 1)
})

bus.subscribe('alpaca:stop', () => {
	Object.assign(state.status, { running: false, serverPort: -1, discoveryPort: -1, devices: [] })
})

async function status() {
	if (!state.show) return undefined
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

function show() {
	state.show = true
}

function hide() {
	state.show = false
}

let mounted = false

function mount() {
	if (mounted) return

	console.info('alpaca mounted')

	mounted = true
}

function unmount() {
	if (!mounted) return
	console.info('alpaca unmounted')
	mounted = false
}

void status()

export const alpacaStore = {
	state,
	mount,
	unmount,
	status,
	updatePort,
	start,
	stop,
	show,
	hide,
} as const
