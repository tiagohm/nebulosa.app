import type { Focuser } from 'nebulosa/src/devices/indi/device'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from '#/device'

export type FocuserAdded = DeviceAdded<Focuser>

export type FocuserUpdated = DeviceUpdated<Focuser>

export type FocuserRemoved = DeviceRemoved<Focuser>
