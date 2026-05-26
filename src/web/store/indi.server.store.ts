import { DEFAULT_INDI_SERVER_START, type IndiServerStart } from 'src/shared/types'
import { proxy } from 'valtio'
import { initProxy } from '../shared/proxy'
import { Api } from '../shared/api'
import bus from 'src/shared/bus'

export interface IndiServerState {
	enabled: boolean
	running: boolean
	showAll: boolean
	show: boolean
	request: IndiServerStart
}

const state = proxy<IndiServerState>({
	enabled: true,
	running: false,
	showAll: false,
	show: false,
	request: structuredClone(DEFAULT_INDI_SERVER_START),
})

initProxy(state, 'indi.server', ['p:show', 'p:showAll', 'o:request'])

bus.subscribe('indi:server:start', () => {
	state.running = true
})

bus.subscribe('indi:server:stop', () => {
	state.running = false
})

async function status() {
	const status = await Api.Indi.Server.status()
	status && Object.assign(state, status)
}

function update<K extends keyof IndiServerStart>(key: K, value: IndiServerStart[K]) {
	state.request[key] = value
}

function start() {
	return Api.Indi.Server.start(state.request)
}

function stop() {
	return Api.Indi.Server.stop()
}

function show() {
	state.show = true
}

function hide() {
	state.show = false
}

await status()

export const indiServerStore = {
	state,
	update,
	start,
	stop,
	show,
	hide,
} as const
