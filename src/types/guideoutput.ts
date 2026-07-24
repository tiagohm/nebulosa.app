import type { GuideDirection, GuideOutput } from 'nebulosa/src/devices/indi/device'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from 'src/types/device'

export type GuideOutputAdded = DeviceAdded<GuideOutput>

export type GuideOutputUpdated = DeviceUpdated<GuideOutput>

export type GuideOutputRemoved = DeviceRemoved<GuideOutput>

export interface GuidePulse {
	direction: GuideDirection
	duration: number
}
