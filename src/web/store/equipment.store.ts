import type { Camera, Cover, Device, DeviceType, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Power, Rotator, Thermometer, Wheel } from 'nebulosa/src/indi.device'
import type { RequiredOnly } from 'nebulosa/src/types'
import bus from 'src/shared/bus'
import type { DeviceUpdated } from 'src/shared/types'
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
	readonly tppa: RequiredOnly<CompoundedEquipmentState, 'camera' | 'mount'>[]
	readonly darv: RequiredOnly<CompoundedEquipmentState, 'camera' | 'mount'>[]
	readonly autoFocus: RequiredOnly<CompoundedEquipmentState, 'camera' | 'focuser'>[]
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
	tppa: [],
	darv: [],
	autoFocus: [],
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
		// device.show = storageGet(`equipment.${type}.${device.name}.show`, false)
		emit(device, 'add')
		console.info(device.type, 'added:', device.name)
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

			removeTppa(device)
			removeDarv(device)
			removeAutoFocus(device)

			emit(device, 'remove')
			console.info(device.type, 'removed:', device.name)
			break
		}
	}
}

function removeTppa(device: Device) {
	const index = state.tppa.findIndex((e) => e.camera === device || e.mount === device)
	index >= 0 && state.tppa.splice(index, 1)
}

function removeDarv(device: Device) {
	const index = state.darv.findIndex((e) => e.camera === device || e.mount === device)
	index >= 0 && state.darv.splice(index, 1)
}

function removeAutoFocus(device: Device) {
	const index = state.autoFocus.findIndex((e) => e.camera === device || e.focuser === device)
	index >= 0 && state.autoFocus.splice(index, 1)
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

function showTppa(camera: Camera, mount: Mount) {
	const tppa = state.tppa.find((e) => e.camera === camera && e.mount === mount)

	if (tppa === undefined) {
		state.tppa.push({ show: true, camera, mount })
	} else {
		tppa.show = true
	}
}

function hideTppa(camera: Camera, mount: Mount) {
	const index = state.tppa.findIndex((e) => e.camera === camera && e.mount === mount)
	index >= 0 && state.tppa.splice(index, 1)
}

function showDarv(camera: Camera, mount: Mount) {
	const darv = state.darv.find((e) => e.camera === camera && e.mount === mount)

	if (darv === undefined) {
		state.darv.push({ show: true, camera, mount })
	} else {
		darv.show = true
	}
}

function hideDarv(camera: Camera, mount: Mount) {
	const index = state.darv.findIndex((e) => e.camera === camera && e.mount === mount)
	index >= 0 && state.darv.splice(index, 1)
}

function showAutoFocus(camera: Camera, focuser: Focuser) {
	const autoFocus = state.autoFocus.find((e) => e.camera === camera && e.focuser === focuser)

	if (autoFocus === undefined) {
		state.autoFocus.push({ show: true, camera, focuser })
	} else {
		autoFocus.show = true
	}
}

function hideAutoFocus(camera: Camera, focuser: Focuser) {
	const index = state.autoFocus.findIndex((e) => e.camera === camera && e.focuser === focuser)
	index >= 0 && state.autoFocus.splice(index, 1)
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
	get,
	connect,
	add,
	update,
	remove,
	showTppa,
	hideTppa,
	showDarv,
	hideDarv,
	showAutoFocus,
	hideAutoFocus,
	show,
	hide,
} as const
