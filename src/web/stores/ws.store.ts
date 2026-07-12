import type { DeviceType } from 'nebulosa/src/devices/indi/device'
import type { DeviceAdded, DeviceRemoved, Notification } from 'src/shared/types'
import { proxy } from 'valtio'
import { toast } from '@/shared/toast'
import { cameraBus, autoFocusBus, darvBus, flatWizardBus, tppaBus, alpacaBus, connectionBus, guiderBus, indiBus, webSocketBus } from '../shared/bus'
import { confirmationStore } from './confirmation.store'
import { equipmentStore } from './equipment.store'

export type WebSocketStore = typeof wsStore

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

const DEVICE_TYPES = new Set<DeviceType>(['camera', 'cover', 'dewHeater', 'flatPanel', 'focuser', 'guideOutput', 'mount', 'power', 'rotator', 'thermometer', 'wheel'])

function isDeviceType(type: string): type is DeviceType {
	return DEVICE_TYPES.has(type as never)
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
			webSocketBus.emit('open', undefined)
			console.info('web socket open')
		}

		updateDisconnectedStyleProperty('0%', 'none')
	})

	webSocket.addEventListener('close', (e) => {
		disconnected = connected
		state.connected = false
		updateDisconnectedStyleProperty('100%', 'flex')
		webSocketBus.emit('close', undefined)
		console.info('web socket close', e)
	})

	webSocket.addEventListener('message', (message) => {
		const content = message.data as string
		const index = content.indexOf('@')

		if (index === -1) {
			console.warn('invalid web socket message:', message.data)
			return
		}

		const key = content.slice(0, index)
		const text = content.slice(index + 1)
		const data = text !== '' ? JSON.parse(text) : undefined

		if (key === 'notification') {
			toast(data as Notification)
		} else if (key === 'confirmation') {
			confirmationStore.show(data)
		} else {
			const [type, action] = key.split(':')

			if (isDeviceType(type)) {
				if (action === 'update') {
					equipmentStore.update(type, data)
				} else if (action === 'add') {
					equipmentStore.add(type, (data as DeviceAdded).device)
				} else if (action === 'remove') {
					equipmentStore.remove(type, (data as DeviceRemoved).device)
				} else {
					if (type === 'camera') cameraBus.emit(action as never, data as never)
				}
			} else {
				if (type === 'darv') darvBus.emit(action as never, data as never)
				else if (type === 'tppa') tppaBus.emit(action as never, data as never)
				else if (type === 'autoFocus') autoFocusBus.emit(action as never, data as never)
				else if (type === 'flatWizard') flatWizardBus.emit(action as never, data as never)
				else if (type === 'alpaca') alpacaBus.emit(action as never, data as never)
				else if (type === 'connection') connectionBus.emit(action as never, data as never)
				else if (type === 'guider') guiderBus.emit(action as never, data as never)
				else if (type === 'indi') indiBus.emit(action as never, data as never)
			}
		}
	})
}

let mounted = false

function mount() {
	if (mounted) return

	console.info('web socket mounted')

	mounted = true

	timer = window.setInterval(() => {
		if (webSocket && webSocket.readyState === WebSocket.CLOSED) {
			webSocket.close()
			webSocket = undefined
			console.info('reconnecting web socket...')
			create()
		}
	}, 5000)

	create()

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('web socket unmounted')
	window.clearInterval(timer)
	timer = undefined
	mounted = false
}

function send(data: string | Blob | BufferSource) {
	webSocket?.send(data)
}

function close() {
	webSocket?.close()
	webSocket = undefined
}

export const wsStore = {
	state,
	mount,
	unmount,
	send,
	close,
} as const
