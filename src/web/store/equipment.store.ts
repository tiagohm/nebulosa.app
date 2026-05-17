import type { Camera, Cover, Device, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Power, Rotator, Thermometer, Wheel } from 'nebulosa/src/indi.device'
import { EventBus, type BusCallback } from 'src/shared/bus'
import type { DeviceUpdated } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '../shared/api'

export type EquipmentStore = typeof equipmentStore

export type DeviceState<D extends Device> = Omit<D, symbol> & {
	show?: boolean
	connecting?: boolean
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
})

const bus = new EventBus()

function get<T extends keyof EquipmentState>(type: T, id: string) {
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

function emit(device: DeviceState<Device>, action: 'add' | 'remove') {
	bus.emit(`device:${action}`, device)
	bus.emit(`${device.type}:${action}`, device)
	bus.emit(`${device.id}:${action}`, device)
}

function add(type: keyof EquipmentState, device: Device) {
	const devices = state[type]
	const index = devices.findIndex((e) => e.id === device.id)

	if (index < 0) {
		devices.push(device as never)
		// device.show = storageGet(`equipment.${type}.${device.name}.show`, false)
		emit(device, 'add')
	}
}

function update<T extends keyof EquipmentState>(type: T, event: DeviceUpdated<EquipmentState[T][number]>) {
	const device = get(type, event.device.id!)

	if (device !== undefined) {
		Object.assign(device, event.device)
		if (event.property === 'connected') device.connecting = false
		return
	}

	console.warn('device not found:', event.device.name)
}

function remove(type: keyof EquipmentState, device: Pick<Device, 'id'>) {
	const devices = state[type]
	const n = devices.length
	const id = device.id

	for (let i = 0; i < n; i++) {
		const device = devices[i]

		if (device.id === id) {
			devices.splice(i, 1)
			emit(device, 'remove')
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
			} finally {
				found.connecting = false
			}
		}
	}
}

function show(device: Device) {
	const found = get(device.type, device.id)

	if (found !== undefined) {
		found.show = true
	}
}

function hide(device: Device) {
	const found = get(device.type, device.id)

	if (found !== undefined) {
		found.show = false
	}
}

function on<T>(topic: string, callback: BusCallback<T>) {
	return bus.subscribe(topic, callback)
}

function off<T>(topic: string, callback: BusCallback<T>) {
	return bus.unsubscribe(topic, callback)
}

export const equipmentStore = {
	state,
	get,
	connect,
	add,
	update,
	remove,
	show,
	hide,
	on,
	off,
} as const
