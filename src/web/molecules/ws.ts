import { molecule } from 'bunshi'
import bus from 'src/shared/bus'
import type { DeviceMessageEvent, Notification } from 'src/shared/types'
import { NotificationMolecule } from './notification'

export const WebSocketMolecule = molecule((m) => {
	const notification = m(NotificationMolecule)

	const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`
	const ws = new WebSocket(`${uri}/ws`)

	ws.addEventListener('open', () => console.info('web socket open'))
	ws.addEventListener('close', (e) => console.info('web socket close', e))

	ws.addEventListener('message', (message) => {
		if (!bus.hasSubscribers()) return

		const data = JSON.parse(message.data) as DeviceMessageEvent | Notification

		switch (data.type) {
			case 'camera:add':
			case 'camera:remove':
			case 'mount:add':
			case 'mount:remove':
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
				bus.emit(data.type, data.device)
				break
			case 'notification':
				notification.send(data)
				break
			default:
				bus.emit(data.type, data)
				break
		}
	})

	return { ws }
})
