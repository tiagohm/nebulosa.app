import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import type { DeviceAdded } from 'src/shared/types'
import { NotificationMolecule } from './notification'

let ws: WebSocket | undefined

export const WebSocketMolecule = molecule((m) => {
	const notification = m(NotificationMolecule)

	const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`

	function create() {
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
			return
		}

		ws = new WebSocket(`${uri}/ws`)

		ws.addEventListener('open', () => {
			send('RESEND')
			console.info('web socket open')
		})

		ws.addEventListener('close', (e) => {
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
			const data = JSON.parse(text)

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
					bus.emit(key, (data as DeviceAdded).device)
					break
				case 'notification':
					notification.send(data)
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

	return { send, close } as const
})
