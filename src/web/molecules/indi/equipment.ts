import { molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import type { Camera, CameraUpdated, Cover, CoverUpdated, Device, DeviceType, DewHeater, DewHeaterUpdated, FlatPanel, FlatPanelUpdated, Focuser, FocuserUpdated, GuideOutput, GuideOutputUpdated, Mount, MountUpdated, Thermometer, ThermometerUpdated, Wheel, WheelUpdated } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'

export type EquipmentDevice<T extends Device> = T & {
	show?: boolean
	connecting?: boolean
}

export interface EquipmentState {
	selected?: DeviceType
	readonly CAMERA: EquipmentDevice<Camera>[]
	readonly MOUNT: EquipmentDevice<Mount>[]
	readonly WHEEL: EquipmentDevice<Wheel>[]
	readonly FOCUSER: EquipmentDevice<Focuser>[]
	readonly ROTATOR: EquipmentDevice<Device>[]
	readonly GPS: EquipmentDevice<Device>[]
	readonly DOME: EquipmentDevice<Device>[]
	readonly GUIDE_OUTPUT: EquipmentDevice<GuideOutput>[]
	readonly FLAT_PANEL: EquipmentDevice<FlatPanel>[]
	readonly COVER: EquipmentDevice<Cover>[]
	readonly THERMOMETER: EquipmentDevice<Thermometer>[]
	readonly DEW_HEATER: EquipmentDevice<DewHeater>[]
}

const state = proxy<EquipmentState>({
	selected: undefined,
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
})

initProxy(state, 'equipment', ['p:selected'])

export const EquipmentMolecule = molecule(() => {
	onMount(() => {
		const unsubscribers: VoidFunction[] = []

		unsubscribers.push(bus.subscribe<Camera>('camera:add', (event) => add('CAMERA', event)))
		unsubscribers.push(bus.subscribe<Camera>('camera:remove', (event) => remove('CAMERA', event)))
		unsubscribers.push(bus.subscribe<CameraUpdated>('camera:update', ({ device, property }) => update('CAMERA', device.name, property, device[property]!)))
		unsubscribers.push(bus.subscribe<Mount>('mount:add', (event) => add('MOUNT', event)))
		unsubscribers.push(bus.subscribe<Mount>('mount:remove', (event) => remove('MOUNT', event)))
		unsubscribers.push(bus.subscribe<MountUpdated>('mount:update', ({ device, property }) => update('MOUNT', device.name, property, device[property]!)))
		unsubscribers.push(bus.subscribe<GuideOutput>('guideOutput:add', (event) => add('GUIDE_OUTPUT', event)))
		unsubscribers.push(bus.subscribe<GuideOutput>('guideOutput:remove', (event) => remove('GUIDE_OUTPUT', event)))
		unsubscribers.push(bus.subscribe<GuideOutputUpdated>('guideOutput:update', ({ device, property }) => update('GUIDE_OUTPUT', device.name, property, device[property]!)))
		unsubscribers.push(bus.subscribe<Thermometer>('thermometer:add', (event) => add('THERMOMETER', event)))
		unsubscribers.push(bus.subscribe<Thermometer>('thermometer:remove', (event) => remove('THERMOMETER', event)))
		unsubscribers.push(bus.subscribe<ThermometerUpdated>('thermometer:update', ({ device, property }) => update('THERMOMETER', device.name, property, device[property]!)))
		unsubscribers.push(bus.subscribe<Cover>('cover:add', (event) => add('COVER', event)))
		unsubscribers.push(bus.subscribe<Cover>('cover:remove', (event) => remove('COVER', event)))
		unsubscribers.push(bus.subscribe<CoverUpdated>('cover:update', ({ device, property }) => update('COVER', device.name, property, device[property]!)))
		unsubscribers.push(bus.subscribe<FlatPanel>('flatPanel:add', (event) => add('FLAT_PANEL', event)))
		unsubscribers.push(bus.subscribe<FlatPanel>('flatPanel:remove', (event) => remove('FLAT_PANEL', event)))
		unsubscribers.push(bus.subscribe<FlatPanelUpdated>('flatPanel:update', ({ device, property }) => update('FLAT_PANEL', device.name, property, device[property]!)))
		unsubscribers.push(bus.subscribe<DewHeater>('dewHeater:add', (event) => add('DEW_HEATER', event)))
		unsubscribers.push(bus.subscribe<DewHeater>('dewHeater:remove', (event) => remove('DEW_HEATER', event)))
		unsubscribers.push(bus.subscribe<DewHeaterUpdated>('dewHeater:update', ({ device, property }) => update('DEW_HEATER', device.name, property, device[property]!)))
		unsubscribers.push(bus.subscribe<Focuser>('focuser:add', (event) => add('FOCUSER', event)))
		unsubscribers.push(bus.subscribe<Focuser>('focuser:remove', (event) => remove('FOCUSER', event)))
		unsubscribers.push(bus.subscribe<FocuserUpdated>('focuser:update', ({ device, property }) => update('FOCUSER', device.name, property, device[property]!)))
		unsubscribers.push(bus.subscribe<Wheel>('wheel:add', (event) => add('WHEEL', event)))
		unsubscribers.push(bus.subscribe<Wheel>('wheel:remove', (event) => remove('WHEEL', event)))
		unsubscribers.push(bus.subscribe<WheelUpdated>('wheel:update', ({ device, property }) => update('WHEEL', device.name, property, device[property]!)))

		unsubscribers.push(
			bus.subscribe('ws:close', () => {
				state.CAMERA.forEach((device) => remove('CAMERA', device))
				state.MOUNT.forEach((device) => remove('MOUNT', device))
				state.GUIDE_OUTPUT.forEach((device) => remove('GUIDE_OUTPUT', device))
				state.THERMOMETER.forEach((device) => remove('THERMOMETER', device))
				state.COVER.forEach((device) => remove('COVER', device))
				state.FLAT_PANEL.forEach((device) => remove('FLAT_PANEL', device))
				state.DEW_HEATER.forEach((device) => remove('DEW_HEATER', device))
				state.FOCUSER.forEach((device) => remove('FOCUSER', device))
				state.WHEEL.forEach((device) => remove('WHEEL', device))
			}),
		)

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function get<T extends DeviceType, D extends EquipmentState[T][number]>(type: T, name: string) {
		return state[type].find((e) => e.name === name) as D | undefined
	}

	function list<T extends Device = Device>(type: DeviceType) {
		return state[type] as EquipmentDevice<T>[]
	}

	function add<T extends DeviceType>(type: T, device: EquipmentState[T][number]) {
		const devices = state[type]
		const index = devices.findIndex((e) => e.name === device.name)
		index < 0 && devices.push(device as never)
	}

	function update<T extends DeviceType, P extends keyof EquipmentState[T][number]>(type: T, name: string, property: P, value: EquipmentState[T][number][P]) {
		const device = state[type].find((e) => e.name === name)
		if (!device) return console.warn('device not found:', name)
		;(device as Record<keyof EquipmentState[T][number], unknown>)[property] = value
		if (property === 'connected') device.connecting = false
	}

	function remove<T extends DeviceType>(type: T, device: EquipmentState[T][number]) {
		const devices = state[type]
		const index = devices.findIndex((e) => e.name === device.name)

		if (index >= 0) {
			devices.splice(index, 1)

			if (devices.length === 0 && state.selected === type) {
				state.selected = undefined
			}
		}
	}

	function select(type: DeviceType) {
		if (state.selected === type) {
			state.selected = undefined
		} else {
			state.selected = type
		}
	}

	function connect(device: Device) {
		if (device.connected) {
			return Api.Indi.disconnect(device)
		} else {
			get(device.type, device.name)!.connecting = true
			return Api.Indi.connect(device)
		}
	}

	function show(type: DeviceType, device: Device) {
		state[type].find((e) => e.name === device.name)!.show = true
		bus.emit('homeMenu:toggle', false)
	}

	function showIndi(device: Device, e?: React.PointerEvent) {
		e?.stopPropagation()
		bus.emit('homeMenu:toggle', false)
		bus.emit('indiPanelControl:show', device)
	}

	function hide(type: DeviceType, device: Device) {
		state[type].find((e) => e.name === device.name)!.show = false
	}

	return { state, get, list, add, update, remove, select, connect, show, showIndi, hide } as const
})
