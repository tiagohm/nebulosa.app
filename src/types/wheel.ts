import type { Wheel } from 'nebulosa/src/devices/indi/device'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from 'src/types/device'

export type WheelAdded = DeviceAdded<Wheel>

export type WheelUpdated = DeviceUpdated<Wheel>

export type WheelRemoved = DeviceRemoved<Wheel>
