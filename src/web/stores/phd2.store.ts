import type { Writable } from 'nebulosa/src/core/types'
import type { PHD2Settle } from 'nebulosa/src/devices/guiding/phd2'
import type { Camera, GuideOutput } from 'nebulosa/src/devices/indi/device'
import bus from 'src/shared/bus'
import { DEFAULT_PHD2_EVENT, DEFAULT_PHD2_INTERNAL_CONNECT, DEFAULT_PHD2_REMOTE_CONNECT, type PHD2ClientMode, type PHD2Dither, type PHD2Event, type PHD2InternalConnect, type PHD2RemoteConnect, type PHD2Status } from 'src/shared/types'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { DeviceState } from './equipment.store'

export type PHD2Store = typeof phd2Store

export interface PHD2State extends PHD2Status {
	show: boolean
	readonly connection: Writable<Omit<PHD2RemoteConnect, 'mode'> & Omit<PHD2InternalConnect, 'mode'> & { mode: PHD2ClientMode }>
	camera?: DeviceState<Camera>
	guideOutput?: DeviceState<GuideOutput>
	readonly event: PHD2Event
	index: number
	connecting: boolean
	pendingCommand?: 'loop' | 'findStar' | 'start' | 'stop' | 'calibrate' | 'clear'
}

const state = proxy<PHD2State>({
	show: false,
	connected: false,
	looping: false,
	running: false,
	connection: {
		...DEFAULT_PHD2_REMOTE_CONNECT,
		...DEFAULT_PHD2_INTERNAL_CONNECT,
		mode: 'remote',
	},
	event: structuredClone(DEFAULT_PHD2_EVENT),
	index: 0,
	connecting: false,
	pendingCommand: undefined,
})

initProxy(state, 'phd2', ['p:show', 'o:connection'])

bus.subscribe<PHD2Event>('phd2', (event) => {
	if (!state.connected) return

	Object.assign(state.event, event)

	state.looping = state.event.state === 'looping'
	state.running = state.event.state === 'guiding'
})

bus.subscribe('phd2:close', () => {
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
	const status = await Api.PHD2.status()
	status && Object.assign(state, status)

	const event = await Api.PHD2.event()
	event && Object.assign(state.event, event)
}

function updateConnection<K extends keyof PHD2State['connection']>(key: K, value: PHD2State['connection'][K]) {
	state.connection[key] = value
}

function updateDither<K extends keyof PHD2Dither>(key: K, value: PHD2Dither[K]) {
	state.connection.dither[key] = value
}

function updateSettle<K extends keyof PHD2Settle>(key: K, value: PHD2Settle[K]) {
	state.connection.dither.settle[key] = value
}

function updateCapture<K extends keyof PHD2State['connection']['capture']>(key: K, value: PHD2State['connection']['capture'][K]) {
	state.connection.capture[key] = value
}

async function connect() {
	if (!state.connected) {
		try {
			if (state.connecting) return

			state.connecting = true
			await Api.PHD2.connect(state.connection)
			await load()
		} finally {
			state.connecting = false
		}
	} else {
		await Api.PHD2.disconnect()
	}
}

async function runCommand(command: NonNullable<PHD2State['pendingCommand']>) {
	try {
		if (state.pendingCommand !== undefined) return
		state.pendingCommand = command
		return await Api.PHD2[command]()
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

export const phd2Store = {
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
