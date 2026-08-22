import { Api } from '@shared/api'
import { cameraBus, coverBus, deviceBus, flatPanelBus, focuserBus, guiderBus, mountBus, rotatorBus, wheelBus } from '@shared/bus'
import type { Camera, Cover, Device, DeviceType, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Power, Rotator, SafetyMonitor, Thermometer, Weather, Wheel } from 'nebulosa/src/devices/indi/device'
import type { EventBus } from 'src/shared/bus'
import { proxy } from 'valtio'
import type { DeviceUpdated } from '#/device'
import type { GuiderSessionInfo } from '#/guider'

export type EquipmentStore = typeof equipmentStore

export type DeviceState<D extends Device> = Omit<D, symbol> & {
	connecting?: boolean
}

export interface CompoundedEquipmentState {
	show: boolean
	camera?: DeviceState<Camera>
	mount?: DeviceState<Mount>
	focuser?: DeviceState<Focuser>
}

export interface EquipmentState {
	readonly camera: DeviceState<Camera>[]
	readonly mount: DeviceState<Mount>[]
	readonly wheel: DeviceState<Wheel>[]
	readonly focuser: DeviceState<Focuser>[]
	readonly rotator: DeviceState<Rotator>[]
	readonly gps: DeviceState<Device>[]
	readonly dome: DeviceState<Device>[]
	readonly guideOutput: DeviceState<GuideOutput>[]
	readonly flatPanel: DeviceState<FlatPanel>[]
	readonly cover: DeviceState<Cover>[]
	readonly thermometer: DeviceState<Thermometer>[]
	readonly dewHeater: DeviceState<DewHeater>[]
	readonly power: DeviceState<Power>[]
	readonly guider: GuiderSessionInfo[]
	readonly safetyMonitor: DeviceState<SafetyMonitor>[]
	readonly weather: DeviceState<Weather>[]
}

const state = proxy<EquipmentState>({
	camera: [],
	mount: [],
	wheel: [],
	focuser: [],
	rotator: [],
	gps: [],
	dome: [],
	guideOutput: [],
	flatPanel: [],
	cover: [],
	thermometer: [],
	dewHeater: [],
	power: [],
	guider: [],
	safetyMonitor: [],
	weather: [],
})

function get<T extends DeviceType>(type: T, id: string) {
	const devices = state[type]
	const n = devices.length

	for (let i = 0; i < n; i++) {
		const device = devices[i] as DeviceState<EquipmentState[T][number]>

		if (device.id === id) {
			return device
		}
	}

	return undefined
}

const BUS = {
	camera: cameraBus,
	mount: mountBus,
	wheel: wheelBus,
	focuser: focuserBus,
	rotator: rotatorBus,
	flatPanel: flatPanelBus,
	cover: coverBus,
	// TODO: add buses for the following device types
	dewHeater: deviceBus,
	power: deviceBus,
	guideOutput: deviceBus,
	thermometer: deviceBus,
	dome: deviceBus,
	gps: deviceBus,
	safetyMonitor: deviceBus,
	weather: deviceBus,
} as const satisfies Record<DeviceType, EventBus<any>>

function emitAddOrRemove(device: DeviceState<Device>, action: 'add' | 'remove') {
	deviceBus.emit(action, device)
	const bus = BUS[device.type] as typeof deviceBus
	bus.emit(action, device)
}

function emitUpdate(device: DeviceState<Device>, property: string) {
	const action = `update:${property}`
	deviceBus.emit(action as never, device as never)
	const bus = BUS[device.type] as typeof deviceBus
	bus.emit(action as never, device as never)
}

function addDevice(type: DeviceType, device: Device) {
	const devices = state[type]
	const index = devices.findIndex((e) => e.id === device.id)

	if (index < 0) {
		devices.push(device as never)
		emitAddOrRemove(device, 'add')
		console.info(device.type, 'added:', device.name, device.id)
	}
}

function updateDevice<T extends DeviceType>(type: T, event: DeviceUpdated<EquipmentState[T][number]>) {
	const device = get(type, event.device.id!)

	if (device !== undefined) {
		Object.assign(device, event.device)
		if (event.property === 'connected' && event.state !== 'Busy') device.connecting = false
		emitUpdate(device, event.property)
		return
	}

	console.warn('device not found:', event.device.name, event.device.id)
}

function removeDevice(type: DeviceType, device: Pick<Device, 'id'>) {
	const devices = state[type]
	const n = devices.length
	const id = device.id

	for (let i = 0; i < n; i++) {
		const device = devices[i]

		if (device.id === id) {
			devices.splice(i, 1)

			emitAddOrRemove(device, 'remove')
			console.info(device.type, 'removed:', device.name, device.id)
			break
		}
	}
}

function addGuider(guider: GuiderSessionInfo) {
	const guiders = state.guider
	const id = guider.id
	const index = guiders.findIndex((e) => e.id === id)

	if (index < 0) {
		guiders.push(guider)
		guiderBus.emit('add', guider)
		console.info('guider added:', guider.target, id)
	}
}

function removeGuider(guider: GuiderSessionInfo) {
	const guiders = state.guider
	const n = guiders.length
	const id = guider.id

	for (let i = 0; i < n; i++) {
		if (guiders[i].id === id) {
			guiders.splice(i, 1)

			guiderBus.emit('remove', guider)
			console.info('guider removed:', guider.target, guider.id)
			break
		}
	}
}

async function connect(device: Device) {
	if (device.connected) {
		await Api.Indi.disconnect(device)
	} else {
		const found = get(device.type, device.id)

		if (found !== undefined) {
			found.connecting = true

			try {
				await Api.Indi.connect(device)
			} catch {
				found.connecting = false
			}
		}
	}
}

export const equipmentStore = {
	state,
	get,
	connect,
	addDevice,
	updateDevice,
	removeDevice,
	addGuider,
	removeGuider,
} as const
