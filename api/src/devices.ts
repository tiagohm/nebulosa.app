import { type IndiClientHandler, IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import { CLIENT, type Client, type Device, type DeviceType } from 'nebulosa/src/devices/indi/device'
import { CameraManager } from 'nebulosa/src/devices/indi/manager/camera'
import { CoverManager } from 'nebulosa/src/devices/indi/manager/cover'
import type { DeviceManager, DeviceProvider } from 'nebulosa/src/devices/indi/manager/device'
import { DomeManager } from 'nebulosa/src/devices/indi/manager/dome'
import { FlatPanelManager } from 'nebulosa/src/devices/indi/manager/flatpanel'
import { FocuserManager } from 'nebulosa/src/devices/indi/manager/focuser'
import { GuideOutputManager } from 'nebulosa/src/devices/indi/manager/guideoutput'
import { MountManager } from 'nebulosa/src/devices/indi/manager/mount'
import { RotatorManager } from 'nebulosa/src/devices/indi/manager/rotator'
import { WheelManager } from 'nebulosa/src/devices/indi/manager/wheel'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'

// Application-wide registry of the devices discovered on every open connection. One device manager per
// managed type ingests the property stream of all clients; the registry maps each client back to the
// connection that opened it, summarizes devices for clients, and publishes their lifecycle and
// connection-state changes. Telemetry is not published.

// Device types the application manages.
export type ManagedDeviceType = Extract<DeviceType, 'camera' | 'mount' | 'focuser' | 'wheel' | 'rotator' | 'guideOutput' | 'dome' | 'cover' | 'flatPanel'>

// Device as reported to clients: identity and connection state only.
export interface DeviceSummary {
	// Stable id of the device, MD5 of its client id, type, and name; survives reconnects of the same endpoint.
	readonly id: string
	// Managed type the device is listed under.
	readonly type: ManagedDeviceType
	// Driver-reported device name.
	readonly name: string
	// Whether the driver reports the device as connected to its hardware.
	readonly connected: boolean
	// Id of the open connection that provides the device.
	readonly connectionId: string
}

// Notification published when a device appears, disappears, or changes its connection state.
export type DeviceEvent =
	| { readonly type: 'device:added'; readonly device: DeviceSummary }
	| { readonly type: 'device:removed'; readonly connectionId: string; readonly id: string }
	// State is the driver's CONNECTION property state: Busy while switching, Alert on failure.
	| { readonly type: 'device:updated'; readonly connectionId: string; readonly id: string; readonly connected: boolean; readonly state?: PropertyState }

// Receiver of device events.
export type DeviceListener = (event: DeviceEvent) => void

// Managed types in handler order: guide outputs come after mounts and cameras because they resolve
// their parent mount or camera.
const MANAGED_TYPES: readonly ManagedDeviceType[] = ['camera', 'mount', 'focuser', 'wheel', 'rotator', 'guideOutput', 'dome', 'cover', 'flatPanel']

// Lifecycle callbacks the registry registers on every manager, typed loosely enough for any device type.
interface LifecycleHandler {
	// Device created from its driver info.
	readonly added: (device: Device) => void
	// Device field changed; property is the field name and state the driver's property state.
	readonly updated: (device: Device, property: string, state?: PropertyState) => void
	// Device deleted by its driver or its client closing.
	readonly removed: (device: Device) => void
}

// Operations of one device manager, erased of its concrete device type.
interface ManagedDevices {
	// Manager fed with the property stream of every client.
	readonly handler: IndiClientHandler
	// Devices of a client.
	readonly list: (client: Client) => Iterable<Device>
	// Device by client and id, hardware id, or name.
	readonly get: (client: Client | string | undefined, id: string) => Device | undefined
	// Sends the CONNECTION switch to the client's device with exactly this id; false when there is none.
	readonly switch: (client: Client, id: string, connect: boolean) => boolean
	// Drops every device of a closed client.
	readonly close: (client: Client) => void
}

// Wraps a manager as ManagedDevices and registers handler for its device lifecycle.
function managed<D extends Device>(manager: DeviceManager<D>, handler: LifecycleHandler): ManagedDevices {
	manager.addHandler(handler)

	return {
		handler: manager,
		list: (client) => manager.list(client),
		get: (client, id) => manager.get(client, id),
		switch: (client, id, connect) => {
			const device = manager.get(client, id)
			if (device?.id !== id || device[CLIENT] !== client) return false
			if (connect) manager.connect(device)
			else manager.disconnect(device)
			return true
		},
		close: (client) => manager.close(client, false),
	}
}

// Device managers and the client-to-connection mapping shared by every open connection.
export class DeviceRegistry implements DeviceProvider<Device> {
	// Manager of each managed type.
	readonly #managers: Readonly<Record<ManagedDeviceType, ManagedDevices>>
	// Connection id of every attached client.
	readonly #connections = new WeakMap<Client, string>()
	// Receiver of every device event, called synchronously.
	readonly #listener: DeviceListener
	// Handler that feeds the property stream of a client to every manager, in MANAGED_TYPES order.
	readonly handler = new IndiClientHandlerSet()

	// Creates the managers; listener receives every device event synchronously.
	constructor(listener: DeviceListener) {
		this.#listener = listener

		const camera = new CameraManager()
		const mount = new MountManager()
		// A guide output is a standalone guider or a sub-interface of a mount or camera.
		const guideOutput = new GuideOutputManager({ get: (client, id, type) => (type === 'camera' ? camera.get(client, id) : mount.get(client, id)) })

		this.#managers = {
			camera: managed(camera, this.#lifecycle('camera')),
			mount: managed(mount, this.#lifecycle('mount')),
			focuser: managed(new FocuserManager(), this.#lifecycle('focuser')),
			wheel: managed(new WheelManager(), this.#lifecycle('wheel')),
			rotator: managed(new RotatorManager(), this.#lifecycle('rotator')),
			guideOutput: managed(guideOutput, this.#lifecycle('guideOutput')),
			dome: managed(new DomeManager(), this.#lifecycle('dome')),
			cover: managed(new CoverManager(), this.#lifecycle('cover')),
			flatPanel: managed(new FlatPanelManager(), this.#lifecycle('flatPanel')),
		}

		for (const type of MANAGED_TYPES) this.handler.add(this.#managers[type].handler)
	}

	// Associates a client with the connection that opens it. Must run before the client delivers
	// properties, so every device it defines is attributed to the connection.
	attach(client: Client, connectionId: string) {
		this.#connections.set(client, connectionId)
	}

	// Drops every device of a closed client, publishing device:removed for each.
	close(client: Client) {
		for (const type of MANAGED_TYPES) this.#managers[type].close(client)
	}

	// Lists the devices of a client, in MANAGED_TYPES order.
	list(client: Client): DeviceSummary[] {
		const devices: DeviceSummary[] = []

		for (const type of MANAGED_TYPES) {
			for (const device of this.#managers[type].list(client)) {
				const summary = this.#summary(device, type)
				if (summary) devices.push(summary)
			}
		}

		return devices
	}

	// Connects (connect = true) or disconnects a device of the client by id. Returns false when the client
	// has no such device. The new state arrives later as a device:updated event.
	switch(client: Client, id: string, connect: boolean): boolean {
		return MANAGED_TYPES.some((type) => this.#managers[type].switch(client, id, connect))
	}

	// Resolves a device by client and id or name, optionally constrained to a managed type (DeviceProvider).
	get(client: Client | string | undefined, id: string, type?: DeviceType): Device | undefined {
		for (const managed of MANAGED_TYPES) {
			if (type && type !== managed) continue
			const device = this.#managers[managed].get(client, id)
			if (device) return device
		}

		return undefined
	}

	// Summarizes a device listed under type; undefined when its client is not attached.
	#summary(device: Device, type: ManagedDeviceType): DeviceSummary | undefined {
		const client = device[CLIENT]
		const connectionId = client && this.#connections.get(client)
		if (!connectionId) return undefined
		return { id: device.id, type, name: device.name, connected: device.connected, connectionId }
	}

	// Builds the handler that publishes the lifecycle of the devices of one managed type.
	#lifecycle(type: ManagedDeviceType): LifecycleHandler {
		return {
			added: (device) => {
				const summary = this.#summary(device, type)
				if (summary) this.#listener({ type: 'device:added', device: summary })
			},
			updated: (device, property, state) => {
				if (property !== 'connected') return
				const summary = this.#summary(device, type)
				if (summary) this.#listener({ type: 'device:updated', connectionId: summary.connectionId, id: device.id, connected: device.connected, state })
			},
			removed: (device) => {
				const summary = this.#summary(device, type)
				if (summary) this.#listener({ type: 'device:removed', connectionId: summary.connectionId, id: device.id })
			},
		}
	}
}
