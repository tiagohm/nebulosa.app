import type { Writable } from 'nebulosa/src/core/types'
import type { Camera, GuideOutput } from 'nebulosa/src/devices/indi/device'
import bus from 'src/shared/bus'
import { DEFAULT_GUIDER_EVENT, DEFAULT_GUIDER_INTERNAL_CONNECT, DEFAULT_GUIDER_REMOTE_CONNECT, type GuiderClientMode, type GuiderDither, type GuiderEvent, type GuiderLocalConnect, type GuiderRemoteConnect, type GuiderStatus } from 'src/shared/types'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { DeviceState } from './equipment.store'

export type GuiderStore = typeof guiderStore

export interface GuiderState extends GuiderStatus {
	show: boolean
	readonly connection: Writable<Omit<GuiderRemoteConnect, 'mode'> & Omit<GuiderLocalConnect, 'mode'> & { mode: GuiderClientMode }>
	camera?: DeviceState<Camera>
	guideOutput?: DeviceState<GuideOutput>
	readonly event: GuiderEvent
	index: number
	connecting: boolean
	pendingCommand?: 'loop' | 'findStar' | 'start' | 'stop' | 'calibrate' | 'clear'
}

const state = proxy<GuiderState>({
	show: false,
	connected: false,
	looping: false,
	running: false,
	connection: {
		...DEFAULT_GUIDER_REMOTE_CONNECT,
		...DEFAULT_GUIDER_INTERNAL_CONNECT,
		mode: 'remote',
	},
	event: structuredClone(DEFAULT_GUIDER_EVENT),
	index: 0,
	connecting: false,
	pendingCommand: undefined,
})

initProxy(state, 'guider', ['p:show', 'o:connection'])

bus.subscribe<GuiderEvent>('guider', (event) => {
	if (!state.connected) return

	Object.assign(state.event, event)

	state.looping = state.event.state === 'looping'
	state.running = state.event.state === 'guiding'
})

bus.subscribe('guider:close', () => {
	state.connected = false
	state.looping = false
	state.running = false
	state.profile = undefined
})

subscribeKey(state, 'show', (show) => {
	if (show) {
		void load()
	}
})

subscribeKey(state, 'camera', (camera) => {
	state.connection.camera = camera?.id ?? ''
})

subscribeKey(state, 'guideOutput', (guideOutput) => {
	state.connection.guideOutput = guideOutput?.id ?? ''
})

if (state.show) {
	void load()
}

async function load() {
	const status = await Api.Guider.status()
	status && Object.assign(state, status)

	const event = await Api.Guider.event()
	event && Object.assign(state.event, event)
}

function updateConnection<K extends keyof GuiderState['connection']>(key: K, value: GuiderState['connection'][K]) {
	state.connection[key] = value
}

function updateDither<K extends keyof GuiderDither>(key: K, value: GuiderDither[K]) {
	state.connection.dither[key] = value
}

function updateSettle<K extends keyof GuiderState['connection']['dither']['settle']>(key: K, value: GuiderState['connection']['dither']['settle'][K]) {
	state.connection.dither.settle[key] = value
}

function updateCapture<K extends keyof GuiderState['connection']['capture']>(key: K, value: GuiderState['connection']['capture'][K]) {
	state.connection.capture[key] = value
}

async function connect() {
	if (!state.connected) {
		try {
			if (state.connecting) return

			state.connecting = true
			await Api.Guider.connect(state.connection)
			await load()
		} finally {
			state.connecting = false
		}
	} else {
		await Api.Guider.disconnect()
	}
}

async function runCommand(command: NonNullable<GuiderState['pendingCommand']>) {
	try {
		if (state.pendingCommand !== undefined) return
		state.pendingCommand = command
		return await Api.Guider[command]()
	} finally {
		state.pendingCommand = undefined
	}
}

function clear() {
	state.event.rmsRA = 0
	state.event.rmsDEC = 0
	state.index = 0
	return runCommand('clear')
}

function loop() {
	return runCommand('loop')
}

function findStar() {
	return runCommand('findStar')
}

function start() {
	return runCommand('start')
}

function stop() {
	return runCommand('stop')
}

function calibrate() {
	return runCommand('calibrate')
}

function show() {
	bus.emit('homeMenu:toggle', false)
	state.show = true
}

function hide() {
	state.show = false
}

export const guiderStore = {
	state,
	updateConnection,
	updateDither,
	updateSettle,
	updateCapture,
	connect,
	clear,
	loop,
	findStar,
	start,
	stop,
	calibrate,
	show,
	hide,
}
