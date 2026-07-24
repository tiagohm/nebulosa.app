import type { Image, ImageLoaded, ImageRoiRequest } from '@shared/types'
import type { DeviceState } from '@stores/equipment.store'
import type { AlpacaConfiguredDevice } from 'nebulosa/src/devices/alpaca/types'
import type { Camera, Cover, Device, FlatPanel, Focuser, Mount, Rotator, Wheel } from 'nebulosa/src/devices/indi/device'
import type { Message } from 'nebulosa/src/devices/indi/types'
import { EventBus } from 'src/shared/bus'
import type { IndiDevicePropertyEvent, IndiServerEvent } from 'src/shared/types'
import type { AlpacaServerStatus } from 'src/types/alpaca'
import type { AutoFocusEvent } from 'src/types/autofocus'
import type { CameraFrameEvent, CameraCaptureEvent } from 'src/types/camera'
import type { ConnectionEvent } from 'src/types/connection'
import type { DarvEvent } from 'src/types/darv'
import type { FlatWizardEvent } from 'src/types/flatwizard'
import type { GuiderEvent } from 'src/types/guider'
import type { TppaEvent } from 'src/types/tppa'

export interface WebSocketBusEvents {
	readonly open: unknown
	readonly close: unknown
}

export type DeviceBusEvents<D extends Device = Device> = {
	[K in keyof D & string as `update:${K}`]: DeviceState<D>
} & {
	readonly add: DeviceState<D>
	readonly remove: DeviceState<D>
}

export interface CameraBusEvents extends DeviceBusEvents<Camera> {
	readonly frame: CameraFrameEvent
	readonly capture: CameraCaptureEvent
	readonly roi: ImageRoiRequest
}

export interface ImageBusEvents {
	readonly add: Image
	readonly update: Readonly<{ image: Image; path: string }>
	readonly remove: Image
	readonly load: ImageLoaded
	readonly roi: ImageRoiRequest
}

export interface DarvBusEvents {
	readonly update: DarvEvent
}

export interface TppaBusEvents {
	readonly update: TppaEvent
}

export interface FlatWizardBusEvents {
	readonly update: FlatWizardEvent
}

export interface AutoFocusBusEvents {
	readonly update: AutoFocusEvent
}

export interface AlpacaBusEvents {
	readonly start: AlpacaServerStatus
	readonly add: AlpacaConfiguredDevice
	readonly remove: AlpacaConfiguredDevice
	readonly stop: unknown
}

export interface ConnectionBusEvents {
	readonly open: ConnectionEvent
	readonly close: ConnectionEvent
}

export interface GuiderBusEvents {
	readonly update: GuiderEvent
	readonly close: unknown
}

export interface IndiBusEvents {
	readonly addProperty: IndiDevicePropertyEvent
	readonly updateProperty: IndiDevicePropertyEvent
	readonly removeProperty: IndiDevicePropertyEvent
	readonly message: Message
	readonly serverStart: IndiServerEvent
	readonly serverStop: IndiServerEvent
}

export interface PlanetariumBusEvents {
	readonly selectedObjectCoordinate: unknown
}

export const webSocketBus = new EventBus<WebSocketBusEvents>()

export const deviceBus = new EventBus<DeviceBusEvents>()

export const cameraBus = new EventBus<CameraBusEvents>()

export const mountBus = new EventBus<DeviceBusEvents<Mount>>()

export const wheelBus = new EventBus<DeviceBusEvents<Wheel>>()

export const focuserBus = new EventBus<DeviceBusEvents<Focuser>>()

export const rotatorBus = new EventBus<DeviceBusEvents<Rotator>>()

export const flatPanelBus = new EventBus<DeviceBusEvents<FlatPanel>>()

export const coverBus = new EventBus<DeviceBusEvents<Cover>>()

export const imageBus = new EventBus<ImageBusEvents>()

export const darvBus = new EventBus<DarvBusEvents>()

export const tppaBus = new EventBus<TppaBusEvents>()

export const flatWizardBus = new EventBus<FlatWizardBusEvents>()

export const autoFocusBus = new EventBus<AutoFocusBusEvents>()

export const alpacaBus = new EventBus<AlpacaBusEvents>()

export const connectionBus = new EventBus<ConnectionBusEvents>()

export const guiderBus = new EventBus<GuiderBusEvents>()

export const indiBus = new EventBus<IndiBusEvents>()

export const planetariumBus = new EventBus<PlanetariumBusEvents>()
