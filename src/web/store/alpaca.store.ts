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
		void status()
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
		void status()
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

let timer: number | undefined
let mounted = false

function mount() {
	if (mounted) return

	console.info('alpaca mounted')

	mounted = true

	if (state.show) void status()

	window.clearInterval(timer)
	timer = window.setInterval(status, 5000)
}

function unmount() {
	if (!mounted) return
	console.info('alpaca unmounted')
	window.clearInterval(timer)
	timer = undefined
	mounted = false
}

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
