import type { FlatPanel } from 'nebulosa/src/devices/indi/device'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from 'src/types/device'

export type FlatPanelAdded = DeviceAdded<FlatPanel>

export type FlatPanelUpdated = DeviceUpdated<FlatPanel>

export type FlatPanelRemoved = DeviceRemoved<FlatPanel>
