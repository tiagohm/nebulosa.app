import type { DewHeater } from 'nebulosa/src/devices/indi/device'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from '#/device'

export type DewHeaterAdded = DeviceAdded<DewHeater>

export type DewHeaterUpdated = DeviceUpdated<DewHeater>

export type DewHeaterRemoved = DeviceRemoved<DewHeater>
