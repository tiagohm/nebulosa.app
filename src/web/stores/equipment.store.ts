import type { Camera, Cover, Device, DeviceType, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Power, Rotator, Thermometer, Wheel } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { ConnectionStatus, DeviceUpdated } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '../shared/api'

export type EquipmentStore = typeof equipmentStore

export type DeviceState<D extends Device> = Omit<D, symbol> & {
	show?: boolean
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

function list(connection: ConnectionStatus) {
	const devices: DeviceState<Device>[] = []
	for (const device of state.camera) device.client.id === connection.id && devices.push(device)
	for (const device of state.mount) device.client.id === connection.id && devices.push(device)
	for (const device of state.wheel) device.client.id === connection.id && devices.push(device)
	for (const device of state.focuser) device.client.id === connection.id && devices.push(device)
	for (const device of state.rotator) device.client.id === connection.id && devices.push(device)
	for (const device of state.gps) device.client.id === connection.id && devices.push(device)
	for (const device of state.dome) device.client.id === connection.id && devices.push(device)
	for (const device of state.guideOutput) device.client.id === connection.id && devices.push(device)
	for (const device of state.flatPanel) device.client.id === connection.id && devices.push(device)
	for (const device of state.cover) device.client.id === connection.id && devices.push(device)
	for (const device of state.thermometer) device.client.id === connection.id && devices.push(device)
	for (const device of state.dewHeater) device.client.id === connection.id && devices.push(device)
	for (const device of state.power) device.client.id === connection.id && devices.push(device)
	return devices
}

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

function emit(device: DeviceState<Device>, action: 'add' | 'remove') {
	bus.emit(`device:${action}`, device)
	bus.emit(`${device.type}:${action}`, device)
	bus.emit(`${device.id}:${action}`, device)
}

function add(type: DeviceType, device: Device) {
	const devices = state[type]
	const index = devices.findIndex((e) => e.id === device.id)

	if (index < 0) {
		devices.push(device as never)
		// device.show = storageGet(`equipment.${device.id}.show`, false)
		emit(device, 'add')
		console.info(device.type, 'added:', device.name, device.id)
	}
}

function update<T extends DeviceType>(type: T, event: DeviceUpdated<EquipmentState[T][number]>) {
	const device = get(type, event.device.id!)

	if (device !== undefined) {
		Object.assign(device, event.device)
		if (event.property === 'connected' && event.state !== 'Busy') device.connecting = false
		return
	}

	console.warn('device not found:', event.device.name, event.device.id)
}

function remove(type: DeviceType, device: Pick<Device, 'id'>) {
	const devices = state[type]
	const n = devices.length
	const id = device.id

	for (let i = 0; i < n; i++) {
		const device = devices[i]

		if (device.id === id) {
			devices.splice(i, 1)

			emit(device, 'remove')
			console.info(device.type, 'removed:', device.name, device.id)
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

function show(device: Device, type = device.type) {
	const found = get(type, device.id)

	if (found !== undefined) {
		found.show = true
	}
}

function hide(device: Device, type = device.type) {
	const found = get(type, device.id)

	if (found !== undefined) {
		found.show = false
	}
}

export const equipmentStore = {
	state,
	list,
	get,
	connect,
	add,
	update,
	remove,
	show,
	hide,
} as const
