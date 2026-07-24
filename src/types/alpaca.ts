import type { AlpacaConfiguredDevice } from 'nebulosa/src/devices/alpaca/types'

export interface AlpacaServerStatus {
	readonly running: boolean
	readonly serverPort: number
	readonly discoveryPort: number
	readonly devices: AlpacaConfiguredDevice[]
}
