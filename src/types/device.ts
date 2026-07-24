import type { RequiredOnly } from 'nebulosa/src/core/types'
import type { Camera, Cover, Device, DeviceType, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Power, Rotator, Thermometer, Wheel } from 'nebulosa/src/devices/indi/device'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'

export interface DeviceAdded<D extends Device = Device> {
	readonly device: D
}

export interface DeviceUpdated<D extends Device = Device> {
	readonly device: RequiredOnly<Partial<D>, 'name' | 'id'>
	readonly property: keyof D & string
	readonly state?: PropertyState
}

export interface DeviceRemoved<D extends Device = Device> {
	readonly device: D
}

export interface DeviceTypeMap {
	readonly camera: Camera
	readonly mount: Mount
	readonly wheel: Wheel
	readonly focuser: Focuser
	readonly rotator: Rotator
	readonly flatPanel: FlatPanel
	readonly cover: Cover
	readonly thermometer: Thermometer
	readonly guideOutput: GuideOutput
	readonly dewHeater: DewHeater
	readonly power: Power
}

export const DEVICE_TYPES = new Set<DeviceType>(['camera', 'mount', 'focuser', 'wheel', 'cover', 'flatPanel', 'rotator', 'guideOutput', 'thermometer', 'dewHeater'])

export function isDeviceType(type: unknown): type is DeviceType {
	return typeof type === 'string' && DEVICE_TYPES.has(type as never)
}
