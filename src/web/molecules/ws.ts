import { molecule } from 'bunshi'
import bus from 'src/shared/bus'
import type { DeviceAdded } from 'src/shared/types'
import { NotificationMolecule } from './notification'

export const WebSocketMolecule = molecule((m) => {
	const notification = m(NotificationMolecule)

	const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`
	const ws = new WebSocket(`${uri}/ws`)

	ws.addEventListener('open', () => console.info('web socket open'))
	ws.addEventListener('close', (e) => console.info('web socket close', e))

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

	return { ws } as const
})
