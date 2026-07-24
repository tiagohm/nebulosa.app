import type { Power } from 'nebulosa/src/devices/indi/device'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from 'src/types/device'

export type PowerAdded = DeviceAdded<Power>

export type PowerUpdated = DeviceUpdated<Power>

export type PowerRemoved = DeviceRemoved<Power>
