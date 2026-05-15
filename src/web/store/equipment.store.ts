import type { Camera, Cover, Device, DeviceType, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Power, Rotator, Thermometer, Wheel } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { CameraUpdated, MountUpdated, GuideOutputUpdated, ThermometerUpdated, CoverUpdated, FlatPanelUpdated, DewHeaterUpdated, FocuserUpdated, WheelUpdated, RotatorUpdated, PowerUpdated, DeviceUpdated } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '../shared/api'

export type DeviceState<D extends Device> = Omit<D, symbol> & {
	show?: boolean
	connecting?: boolean
}

export interface EquipmentState {
	readonly CAMERA: DeviceState<Camera>[]
	readonly MOUNT: DeviceState<Mount>[]
	readonly WHEEL: DeviceState<Wheel>[]
	readonly FOCUSER: DeviceState<Focuser>[]
	readonly ROTATOR: DeviceState<Rotator>[]
	readonly GPS: DeviceState<Device>[]
	readonly DOME: DeviceState<Device>[]
	readonly GUIDE_OUTPUT: DeviceState<GuideOutput>[]
	readonly FLAT_PANEL: DeviceState<FlatPanel>[]
	readonly COVER: DeviceState<Cover>[]
	readonly THERMOMETER: DeviceState<Thermometer>[]
	readonly DEW_HEATER: DeviceState<DewHeater>[]
	readonly POWER: DeviceState<Power>[]
}

const state = proxy<EquipmentState>({
	CAMERA: [],
	MOUNT: [],
	WHEEL: [],
	FOCUSER: [],
	ROTATOR: [],
	GPS: [],
	DOME: [],
	GUIDE_OUTPUT: [],
	FLAT_PANEL: [],
	COVER: [],
	THERMOMETER: [],
	DEW_HEATER: [],
	POWER: [],
})

bus.subscribe<Camera>('camera:add', (event) => add('CAMERA', event))
bus.subscribe<Camera>('camera:remove', (event) => remove('CAMERA', event))
bus.subscribe<CameraUpdated>('camera:update', (event) => update('CAMERA', event))
bus.subscribe<Mount>('mount:add', (event) => add('MOUNT', event))
bus.subscribe<Mount>('mount:remove', (event) => remove('MOUNT', event))
bus.subscribe<MountUpdated>('mount:update', (event) => update('MOUNT', event))
bus.subscribe<GuideOutput>('guideOutput:add', (event) => add('GUIDE_OUTPUT', event))
bus.subscribe<GuideOutput>('guideOutput:remove', (event) => remove('GUIDE_OUTPUT', event))
bus.subscribe<GuideOutputUpdated>('guideOutput:update', (event) => update('GUIDE_OUTPUT', event))
bus.subscribe<Thermometer>('thermometer:add', (event) => add('THERMOMETER', event))
bus.subscribe<Thermometer>('thermometer:remove', (event) => remove('THERMOMETER', event))
bus.subscribe<ThermometerUpdated>('thermometer:update', (event) => update('THERMOMETER', event))
bus.subscribe<Cover>('cover:add', (event) => add('COVER', event))
bus.subscribe<Cover>('cover:remove', (event) => remove('COVER', event))
bus.subscribe<CoverUpdated>('cover:update', (event) => update('COVER', event))
bus.subscribe<FlatPanel>('flatPanel:add', (event) => add('FLAT_PANEL', event))
bus.subscribe<FlatPanel>('flatPanel:remove', (event) => remove('FLAT_PANEL', event))
bus.subscribe<FlatPanelUpdated>('flatPanel:update', (event) => update('FLAT_PANEL', event))
bus.subscribe<DewHeater>('dewHeater:add', (event) => add('DEW_HEATER', event))
bus.subscribe<DewHeater>('dewHeater:remove', (event) => remove('DEW_HEATER', event))
bus.subscribe<DewHeaterUpdated>('dewHeater:update', (event) => update('DEW_HEATER', event))
bus.subscribe<Focuser>('focuser:add', (event) => add('FOCUSER', event))
bus.subscribe<Focuser>('focuser:remove', (event) => remove('FOCUSER', event))
bus.subscribe<FocuserUpdated>('focuser:update', (event) => update('FOCUSER', event))
bus.subscribe<Wheel>('wheel:add', (event) => add('WHEEL', event))
bus.subscribe<Wheel>('wheel:remove', (event) => remove('WHEEL', event))
bus.subscribe<WheelUpdated>('wheel:update', (event) => update('WHEEL', event))
bus.subscribe<Rotator>('rotator:add', (event) => add('ROTATOR', event))
bus.subscribe<Rotator>('rotator:remove', (event) => remove('ROTATOR', event))
bus.subscribe<RotatorUpdated>('rotator:update', (event) => update('ROTATOR', event))
bus.subscribe<Power>('power:add', (event) => add('POWER', event))
bus.subscribe<Power>('power:remove', (event) => remove('POWER', event))
bus.subscribe<PowerUpdated>('power:update', (event) => update('POWER', event))

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

function add(type: DeviceType, device: Pick<Device, 'id'>) {
	const devices = state[type]

	if (!devices.some((e) => e.id === device.id)) {
		devices.push(device as never)
		// device.show = storageGet(`equipment.${type}.${device.name}.show`, false)
		bus.emit('device:add', device)
	}
}

function update<T extends DeviceType>(type: T, event: DeviceUpdated<EquipmentState[T][number]>) {
	const device = get(type, event.device.id!)

	if (device !== undefined) {
		Object.assign(device, event.device)
		if (event.property === 'connected') device.connecting = false
		return
	}

	console.warn('device not found:', event.device.name)
}

function remove(type: DeviceType, device: Pick<Device, 'id'>) {
	const devices = state[type]
	const n = devices.length
	const id = device.id

	for (let i = 0; i < n; i++) {
		const device = devices[i]

		if (device.id === id) {
			devices.splice(i, 1)
			bus.emit('device:remove', device)
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

export const equipment = {
	state,
	get,
	connect,
} as const
