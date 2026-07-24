import type { Thermometer } from 'nebulosa/src/devices/indi/device'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from 'src/types/device'

export type ThermometerAdded = DeviceAdded<Thermometer>

export type ThermometerUpdated = DeviceUpdated<Thermometer>

export type ThermometerRemoved = DeviceRemoved<Thermometer>
