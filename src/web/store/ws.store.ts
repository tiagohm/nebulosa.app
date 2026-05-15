import bus from 'src/shared/bus'
import type { DeviceAdded, DeviceRemoved, Notification } from 'src/shared/types'
import { proxy } from 'valtio'
import { toast } from '@/shared/toast'

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

		switch (key) {
			case 'camera:add':
			case 'camera:remove':
			case 'mount:add':
			case 'mount:remove':
			case 'focuser:add':
			case 'focuser:remove':
			case 'wheel:add':
			case 'wheel:remove':
			case 'guideOutput:add':
			case 'guideOutput:remove':
			case 'thermometer:add':
			case 'thermometer:remove':
			case 'cover:add':
			case 'cover:remove':
			case 'flatPanel:add':
			case 'flatPanel:remove':
			case 'dewHeater:add':
			case 'dewHeater:remove':
			case 'power:add':
			case 'power:remove':
			case 'rotator:add':
			case 'rotator:remove':
				bus.emit(key, (data as DeviceAdded | DeviceRemoved).device)
				break
			case 'notification':
				toast(data as Notification)
				break
			default:
				bus.emit(key, data)
				break
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
