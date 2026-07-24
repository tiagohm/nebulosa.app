import type { Rotator } from 'nebulosa/src/devices/indi/device'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from 'src/types/device'

export type RotatorAdded = DeviceAdded<Rotator>

export type RotatorUpdated = DeviceUpdated<Rotator>

export type RotatorRemoved = DeviceRemoved<Rotator>
