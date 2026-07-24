import { Api } from '@shared/api'
import { indiBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { unsubscribe } from 'src/shared/util'
import { DEFAULT_INDI_SERVER_START } from 'src/types/indi'
import type { IndiServerStart } from 'src/types/indi'
import { proxy } from 'valtio'

export type IndiServerStore = typeof indiServerStore

export interface IndiServerState {
	enabled: boolean
	running: boolean
	showAll: boolean
	request: IndiServerStart
}

const state = proxy<IndiServerState>({
	enabled: true,
	running: false,
	showAll: false,
	request: structuredClone(DEFAULT_INDI_SERVER_START),
})

let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return unmount

	console.info('indi server mounted')

	mounted = true

	u[0] = initProxy(state, 'indi.server', ['p:showAll', 'o:request'])

	indiBus.subscribe('serverStart', () => {
		state.running = true
	})

	indiBus.subscribe('serverStop', () => {
		state.running = false
	})

	void status()

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('indi server unmounted')
	unsubscribe(u)
	mounted = false
}

async function status() {
	const status = await Api.Indi.Server.status()
	status && Object.assign(state, status)
}

function setPort(value: number | undefined) {
	state.request.port = value
}

function setRepeat(value: number | undefined) {
	state.request.repeat = value
}

function setVerbose(value: number | undefined) {
	state.request.verbose = value
}

function setDrivers(value: readonly string[]) {
	state.request.drivers = value
}

function start() {
	return Api.Indi.Server.start(state.request)
}

function stop() {
	return Api.Indi.Server.stop()
}

export const indiServerStore = {
	state,
	mount,
	unmount,
	setPort,
	setRepeat,
	setVerbose,
	setDrivers,
	start,
	stop,
} as const
