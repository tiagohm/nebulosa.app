import { addToast } from '@heroui/react'
import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import type { DeviceAdded, Notification } from 'src/shared/types'
import { proxy } from 'valtio'

export interface WebSocketState {
	connected: boolean
}

let ws: WebSocket | undefined

let connected = false
let disconnected = false

const state = proxy<WebSocketState>({
	connected: true,
})

export const WebSocketMolecule = molecule(() => {
	const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`

	function create() {
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
			return
		}

		ws = new WebSocket(`${uri}/ws`)

		ws.addEventListener('open', () => {
			if (disconnected) {
				state.connected = true
				bus.emit('ws:reopen', null)
				send('RESEND')
				console.info('web socket reopen')
			} else {
				connected = true
				state.connected = true
				bus.emit('ws:open', null)
				console.info('web socket open')
			}

			document.documentElement.style.setProperty('--ws-disconnected-grayscale', '0%')
			document.documentElement.style.setProperty('--ws-disconnected-display', 'none')
		})

		ws.addEventListener('close', (e) => {
			disconnected = connected
			state.connected = false
			document.documentElement.style.setProperty('--ws-disconnected-grayscale', '100%')
			document.documentElement.style.setProperty('--ws-disconnected-display', 'flex')
			bus.emit('ws:close', null)
			console.info('web socket close', e)
		})

		ws.addEventListener('message', (message) => {
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
					bus.emit(key, (data as DeviceAdded).device)
					break
				case 'notification':
					addToast(data as Notification)
					break
				default:
					bus.emit(key, data)
					break
			}
		})
	}

	function send(data: string | ArrayBufferLike | Blob | ArrayBufferView<ArrayBufferLike>) {
		ws?.send(data)
	}

	function close() {
		ws?.close()
		ws = undefined
	}

	onMount(() => {
		const timer = setInterval(() => {
			if (ws && ws.readyState === WebSocket.CLOSED) {
				console.info('reconnecting web socket...')
				create()
			}
		}, 5000)

		create()

		return () => {
			clearInterval(timer)
		}
	})

	return { state, send, close } as const
})
