import type { Cover } from 'nebulosa/src/devices/indi/device'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from '#/device'

export type CoverAdded = DeviceAdded<Cover>

export type CoverUpdated = DeviceUpdated<Cover>

export type CoverRemoved = DeviceRemoved<Cover>
