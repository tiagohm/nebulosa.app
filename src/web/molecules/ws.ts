import { molecule } from 'bunshi'
import { BusMolecule } from 'src/shared/bus'
import type { DeviceMessageEvent } from 'src/shared/types'

// Molecule that manages WebSocket connection for receiving messages
export const WebSocketMolecule = molecule((m) => {
	const bus = m(BusMolecule)

	const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`
	const ws = new WebSocket(`${uri}/ws`)

	ws.addEventListener('open', () => console.info('web socket open'))
	ws.addEventListener('close', (e) => console.info('web socket close', e))

	ws.addEventListener('message', (message) => {
		if (!bus.hasSubscribers()) return

		const data = JSON.parse(message.data) as DeviceMessageEvent

		switch (data.type) {
			case 'camera:add':
			case 'camera:remove':
			case 'mount:add':
			case 'mount:remove':
			case 'guideOutput:add':
			case 'guideOutput:remove':
			case 'thermometer:add':
			case 'thermometer:remove':
				bus.emit(data.type, data.device)
				break
			default:
				bus.emit(data.type, data)
				break
		}
	})

	return { ws }
})
