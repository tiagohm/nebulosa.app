import { molecule } from 'bunshi'
import type { DeviceMessageEvent } from 'src/api/types'
import { EquipmentMolecule } from './indi/equipment'

// Molecule that manages WebSocket connection for receiving messages
export const WebSocketMolecule = molecule((m) => {
	const equipment = m(EquipmentMolecule)

	const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`
	const ws = new WebSocket(`${uri}/ws`)

	ws.addEventListener('open', () => console.info('web socket open'))
	ws.addEventListener('close', (e) => console.info('web socket close', e))

	ws.addEventListener('message', (message) => {
		const data = JSON.parse(message.data) as DeviceMessageEvent

		switch (data.type) {
			case 'camera.add':
				equipment.register('cameras', data.device)
				break
			case 'camera.remove':
				equipment.unregister('cameras', data.device)
				break
			case 'camera.update':
				equipment.update('cameras', data.device, data.property, data.value)
				break
			case 'guide_output.add':
				equipment.register('guideOutputs', data.device)
				break
			case 'guide_output.remove':
				equipment.unregister('guideOutputs', data.device)
				break
			case 'guide_output.update':
				equipment.update('guideOutputs', data.device, data.property, data.value)
				break
			case 'thermometer.add':
				equipment.register('thermometers', data.device)
				break
			case 'thermometer.remove':
				equipment.unregister('thermometers', data.device)
				break
			case 'thermometer.update':
				equipment.update('thermometers', data.device, data.property, data.value)
				break
		}
	})

	return { ws }
})
