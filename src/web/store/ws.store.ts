import bus from 'src/shared/bus'
import type { DeviceAdded, DeviceRemoved, Notification } from 'src/shared/types'
import { proxy } from 'valtio'
import { toast } from '@/shared/toast'
import { confirmationStore } from './confirmation.store'
import { equipmentStore } from './equipment.store'

export type WebSocketStore = typeof ws

export interface WebSocketState {
	connected: boolean
}

let webSocket: WebSocket | undefined
let connected = false
let disconnected = false
let timer: number | undefined

const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`

const state = proxy<WebSocketState>({
	connected: true,
})

function updateDisconnectedStyleProperty(grayscale: string, display: string) {
	document.documentElement.style.setProperty('--ws-disconnected-grayscale', grayscale)
	document.documentElement.style.setProperty('--ws-disconnected-display', display)
}

function create() {
	if (webSocket && (webSocket.readyState === WebSocket.OPEN || webSocket.readyState === WebSocket.CONNECTING)) {
		return
	}

	console.info('creating web socket...')

	webSocket = new WebSocket(`${uri}/ws`)

	webSocket.addEventListener('open', () => {
		if (disconnected) {
			state.connected = true
			console.info('web socket reopen')
			window.location.reload()
		} else {
			connected = true
			state.connected = true
			bus.emit('ws:open', null)
			console.info('web socket open')
		}

		updateDisconnectedStyleProperty('0%', 'none')
	})

	webSocket.addEventListener('close', (e) => {
		disconnected = connected
		state.connected = false
		updateDisconnectedStyleProperty('100%', 'flex')
		bus.emit('ws:close', null)
		console.info('web socket close', e)
	})

	webSocket.addEventListener('message', (message) => {
		if (!bus.hasSubscribers()) return

		const content = message.data as string
		const index = content.indexOf('@')

		if (index === -1) {
			console.warn('invalid web socket message:', message.data)
			return
		}

		const key = content.slice(0, index)
		const text = content.slice(index + 1)
		const data = text !== '' ? JSON.parse(text) : undefined

		if (
			key.startsWith('camera:') ||
			key.startsWith('cover:') ||
			key.startsWith('dewHeater:') ||
			key.startsWith('flatPanel:') ||
			key.startsWith('focuser:') ||
			key.startsWith('guideOutput:') ||
			key.startsWith('mount:') ||
			key.startsWith('power:') ||
			key.startsWith('rotator:') ||
			key.startsWith('thermometer:') ||
			key.startsWith('wheel:')
		) {
			const [type, action] = key.split(':')

			if (action === 'update') {
				equipmentStore.update(type as never, data)
			} else if (action === 'add') {
				equipmentStore.add(type as never, (data as DeviceAdded).device)
			} else if (action === 'remove') {
				equipmentStore.remove(type as never, (data as DeviceRemoved).device)
			} else {
				bus.emit(key, data)
			}
		} else if (key === 'notification') {
			toast(data as Notification)
		} else if (key === 'confirmation') {
			confirmationStore.show(data)
		} else {
			bus.emit(key, data)
		}
	})
}

function mount() {
	timer = window.setInterval(() => {
		if (webSocket && webSocket.readyState === WebSocket.CLOSED) {
			console.info('reconnecting web socket...')
			create()
		}
	}, 5000)

	create()

	return unmount
}

function unmount() {
	window.clearInterval(timer)
	timer = undefined
}

function send(data: string | Blob | BufferSource) {
	webSocket?.send(data)
}

function close() {
	webSocket?.close()
	webSocket = undefined
}

export const ws = {
	state,
	mount,
	unmount,
	send,
	close,
} as const
