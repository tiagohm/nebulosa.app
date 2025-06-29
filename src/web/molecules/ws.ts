import { molecule } from 'bunshi'
import type { CameraCaptureTaskEvent, Confirmation, DeviceMessageEvent } from 'src/api/types'
import { BusMolecule } from './bus'

// Molecule that manages WebSocket connection for receiving messages
export const WebSocketMolecule = molecule((m) => {
	const bus = m(BusMolecule)

	const uri = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`
	const ws = new WebSocket(`${uri}/ws`)

	ws.addEventListener('open', () => console.info('web socket open'))
	ws.addEventListener('close', (e) => console.info('web socket close', e))

	ws.addEventListener('message', (message) => {
		const data = JSON.parse(message.data) as DeviceMessageEvent | Confirmation | CameraCaptureTaskEvent

		switch (data.type) {
			case 'CONFIRMATION':
			case 'CAMERA_UPDATE':
			case 'GUIDE_OUTPUT_UPDATE':
			case 'THERMOMETER_UPDATE':
			case 'CAMERA_CAPTURE':
				bus.emit(data.type, data)
				break
			case 'CAMERA_ADD':
			case 'CAMERA_REMOVE':
			case 'GUIDE_OUTPUT_ADD':
			case 'GUIDE_OUTPUT_REMOVE':
			case 'THERMOMETER_ADD':
			case 'THERMOMETER_REMOVE':
				bus.emit(data.type, data.device)
				break
		}
	})

	return { ws }
})
