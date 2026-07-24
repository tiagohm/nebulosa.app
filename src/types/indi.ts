import type { DeviceProperty, DeviceType } from 'nebulosa/src/devices/indi/device'

export interface IndiServerStart {
	port?: number
	drivers: readonly string[]
	verbose?: number
	repeat?: number
}

export interface IndiServerStatus {
	readonly enabled: boolean
	readonly running: boolean
}

export interface IndiServerEvent {
	readonly pid: number
	readonly code?: number
}

export interface IndiDevicePropertyEvent {
	readonly client: string
	readonly device: string
	readonly name: string
	readonly property: DeviceProperty
}

export const DEFAULT_INDI_SERVER_START: Required<IndiServerStart> = {
	port: 7624,
	repeat: 1,
	verbose: 0,
	drivers: [],
}
