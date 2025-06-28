import { molecule } from 'bunshi'
import type { DeviceMessageEvent } from 'src/api/types'
import { BusMolecule } from './bus'

// Molecule that manages WebSocket connection for receiving messages
export const WebSocketMolecule = molecule((m) => {
	const bus = m(BusMolecule)

	const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`
	const ws = new WebSocket(`${uri}/ws`)

	ws.addEventListener('open', () => console.info('web socket open'))
	ws.addEventListener('close', (e) => console.info('web socket close', e))

	ws.addEventListener('message', (message) => {
		const data = JSON.parse(message.data) as DeviceMessageEvent

		switch (data.type) {
			case 'camera.add':
				bus.emit('addCamera', data.device)
				break
			case 'camera.remove':
				bus.emit('removeCamera', data.device)
				break
			case 'camera.update':
				bus.emit('updateCamera', data)
				break
			case 'guide_output.add':
				bus.emit('addGuideOutput', data.device)
				break
			case 'guide_output.remove':
				bus.emit('removeGuideOutput', data.device)
				break
			case 'guide_output.update':
				bus.emit('updateGuideOutput', data)
				break
			case 'thermometer.add':
				bus.emit('addThermometer', data.device)
				break
			case 'thermometer.remove':
				bus.emit('removeThermometer', data.device)
				break
			case 'thermometer.update':
				bus.emit('updateThermometer', data)
				break
		}
	})

	return { ws }
})
