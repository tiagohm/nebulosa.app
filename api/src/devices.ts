import { type IndiClientHandler, IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import { type Camera, type CameraTransferFormat, CLIENT, type Client, type Device, type DeviceType, type MinMaxValueProperty, type Mount, type NameAndLabel } from 'nebulosa/src/devices/indi/device'
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
import type { DeviceLifecycle } from 'nebulosa/src/devices/orchestration/device.lifecycle'

// Application-wide registry of the devices discovered on every open connection. One device manager per
// managed type ingests the property stream of all clients; the registry maps each client back to the
// connection that opened it, summarizes devices for clients, and publishes their lifecycle and
// connection-state changes. The only telemetry published is what the Sky and Capture workspaces need: the
// pointing and motion state of mounts, with coordinate changes coalesced to at most one event per second
// per mount, and the sensor geometry and capture capabilities of cameras when they change. Every event
// names its connection and device id, never a role.

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

// Pointing and motion state of a mount as reported to clients. The coordinate is meaningful only while
// connected is true: a disconnected mount has no position.
export interface MountState {
	// Id of the open connection that provides the mount.
	readonly connectionId: string
	// Stable id of the mount.
	readonly id: string
	// Whether the driver reports the mount as connected to its hardware.
	readonly connected: boolean
	// Reported right ascension in radians, true equator and equinox of date (JNOW), [0, 2π).
	readonly rightAscension: number
	// Reported declination in radians, equinox of date, [-π/2, π/2].
	readonly declination: number
	// Whether a goto or flip is in progress.
	readonly slewing: boolean
	// Whether tracking is on.
	readonly tracking: boolean
	// Whether the mount is parked.
	readonly parked: boolean
	// Whether the mount is moving to its park position.
	readonly parking: boolean
	// Whether the driver accepts goto commands.
	readonly canGoTo: boolean
	// Whether the driver accepts an abort of its motion.
	readonly canAbort: boolean
}

// Imaging area of a camera at full frame and without binning, as its driver reports it.
export interface CameraSensor {
	// Width in pixels.
	readonly width: number
	// Height in pixels.
	readonly height: number
	// Side of a pixel in micrometers; the horizontal size when the driver reports non-square pixels.
	readonly pixelSize: number
}

// Sensor geometry of a camera as reported to clients.
export interface CameraSensorState {
	// Id of the open connection that provides the camera.
	readonly connectionId: string
	// Stable id of the camera.
	readonly id: string
	// Sensor geometry; absent while the driver has not reported a positive frame size and pixel size.
	readonly sensor?: CameraSensor
}

// Range of a numeric camera control, in the units of the driver.
export interface CameraRange {
	// Lowest accepted value.
	readonly min: number
	// Highest accepted value.
	readonly max: number
}

// What a camera can be asked for in a capture, and its thermal state, as its driver reports them. A control
// the driver does not publish is absent, and the capture leaves it unchanged.
export interface CameraCapabilities {
	// Id of the open connection that provides the camera.
	readonly connectionId: string
	// Stable id of the camera.
	readonly id: string
	// Driver-reported camera name.
	readonly name: string
	// Whether the driver reports the camera as connected to its hardware.
	readonly connected: boolean
	// Accepted exposure time, in seconds; absent while the driver has not published a positive maximum.
	readonly exposure?: CameraRange
	// Gain range; absent when the driver has no gain control.
	readonly gain?: CameraRange
	// Offset range; absent when the driver has no offset control.
	readonly offset?: CameraRange
	// Largest horizontal and vertical binning factors; absent when the driver cannot bin.
	readonly bin?: { readonly x: number; readonly y: number }
	// Sensor size a subframe must fit in, in unbinned pixels; absent when the driver cannot take subframes.
	readonly subframe?: { readonly width: number; readonly height: number }
	// Whether an exposure in progress can be aborted.
	readonly canAbort: boolean
	// Readout modes, such as MONO or RGB; empty when the driver has none.
	readonly frameFormats: readonly NameAndLabel[]
	// Selected readout mode; empty when the driver has none.
	readonly frameFormat: string
	// Payload formats the driver offers; empty when it defines none, and then only FITS is available.
	readonly transferFormats: readonly CameraTransferFormat[]
	// Sensor temperature in degrees Celsius; absent when the camera has no thermometer.
	readonly temperature?: number
	// Cooler state: whether it is on (absent when it cannot be switched) and its power in percent.
	readonly cooler?: { readonly enabled?: boolean; readonly power: number }
}

// Notification published when a device appears, disappears, or changes its connection state, when a
// mount moves or changes its motion state, when a camera reports a different sensor geometry, and when a
// camera's capabilities or thermal state change.
export type DeviceEvent =
	| { readonly type: 'device:added'; readonly device: DeviceSummary }
	| { readonly type: 'device:removed'; readonly connectionId: string; readonly id: string }
	// State is the driver's CONNECTION property state: Busy while switching, Alert on failure.
	| { readonly type: 'device:updated'; readonly connectionId: string; readonly id: string; readonly connected: boolean; readonly state?: PropertyState }
	| { readonly type: 'mount:updated'; readonly state: MountState }
	| { readonly type: 'camera:sensor'; readonly state: CameraSensorState }
	| { readonly type: 'camera:capabilities'; readonly capabilities: CameraCapabilities }

// Receiver of device events.
export type DeviceListener = (event: DeviceEvent) => void

// Managed types in handler order: guide outputs come after mounts and cameras because they resolve
// their parent mount or camera.
const MANAGED_TYPES: readonly ManagedDeviceType[] = ['camera', 'mount', 'focuser', 'wheel', 'rotator', 'guideOutput', 'dome', 'cover', 'flatPanel']

// Shortest interval between two mount:updated events of one mount caused by coordinate changes, in
// milliseconds. Motion-state changes are published at once.
const MOUNT_STATE_INTERVAL = 1000

// Mount fields whose change is published at once, ahead of the coalesced coordinate updates.
const MOUNT_MOTION_FIELDS: ReadonlySet<string> = new Set(['connected', 'slewing', 'tracking', 'parked', 'parking', 'canGoTo', 'canAbort'])

// Camera fields the sensor geometry depends on.
const CAMERA_SENSOR_FIELDS: ReadonlySet<string> = new Set(['connected', 'frame', 'pixelSize'])

// Camera fields the capabilities depend on. The exposure field changes on every progress update, so its
// changes are published only when the capabilities themselves differ.
const CAMERA_CAPABILITY_FIELDS: ReadonlySet<string> = new Set(['connected', 'exposure', 'gain', 'offset', 'canBin', 'bin', 'canSubFrame', 'frame', 'canAbort', 'frameFormats', 'frameFormat', 'transferFormats', 'hasThermometer', 'temperature', 'hasCooler', 'hasCoolerControl', 'cooler', 'coolerPower'])

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
	// Makes a lifecycle bridge follow the manager's devices; returns a function that stops it.
	readonly observe: (lifecycle: DeviceLifecycle) => VoidFunction
}

// Coalescing state of the mount:updated events of one mount.
interface MountPublication {
	// Time of the last published event in milliseconds, on the performance clock.
	last: number
	// Pending trailing publication, if any.
	timer?: ReturnType<typeof setTimeout>
}

// Returns the device of a manager with exactly this id on exactly this client. Managers also match
// hardware ids and names, and match ids on any client, which must never select another connection's device.
function exactDevice<D extends Device>(manager: DeviceManager<D>, client: Client, id: string): D | undefined {
	const device = manager.get(client, id)
	return device?.id === id && device[CLIENT] === client ? device : undefined
}

// Returns the sensor geometry a camera reports, or undefined while any dimension is not positive.
export function cameraSensor(camera: Camera): CameraSensor | undefined {
	const width = camera.frame.width.max
	const height = camera.frame.height.max
	const pixelSize = camera.pixelSize.x
	return width > 0 && height > 0 && pixelSize > 0 ? { width, height, pixelSize } : undefined
}

// Returns a control range, or undefined when the driver published none (both ends zero).
function cameraRange({ min, max }: Pick<MinMaxValueProperty, 'min' | 'max'>): CameraRange | undefined {
	return max > min ? { min, max } : undefined
}

// Returns the capabilities and thermal state a camera reports, attributed to its connection.
export function cameraCapabilities(camera: Camera, connectionId: string): CameraCapabilities {
	return {
		connectionId,
		id: camera.id,
		name: camera.name,
		connected: camera.connected,
		exposure: camera.exposure.max > 0 ? { min: camera.exposure.min, max: camera.exposure.max } : undefined,
		gain: cameraRange(camera.gain),
		offset: cameraRange(camera.offset),
		bin: camera.canBin ? { x: Math.max(1, camera.bin.x.max), y: Math.max(1, camera.bin.y.max) } : undefined,
		subframe: camera.canSubFrame && camera.frame.width.max > 0 && camera.frame.height.max > 0 ? { width: camera.frame.width.max, height: camera.frame.height.max } : undefined,
		canAbort: camera.canAbort,
		frameFormats: camera.frameFormats,
		frameFormat: camera.frameFormat,
		transferFormats: camera.transferFormats,
		temperature: camera.hasThermometer ? camera.temperature : undefined,
		cooler: camera.hasCooler || camera.hasCoolerControl ? { enabled: camera.hasCoolerControl ? camera.cooler : undefined, power: camera.coolerPower } : undefined,
	}
}

// Whether two optional sensor geometries are equal.
function sameSensor(a?: CameraSensor, b?: CameraSensor) {
	return a === b || (a !== undefined && b !== undefined && a.width === b.width && a.height === b.height && a.pixelSize === b.pixelSize)
}

// Wraps a manager as ManagedDevices and registers handler for its device lifecycle.
function managed<D extends Device>(manager: DeviceManager<D>, handler: LifecycleHandler): ManagedDevices {
	manager.addHandler(handler)

	return {
		handler: manager,
		list: (client) => manager.list(client),
		get: (client, id) => manager.get(client, id),
		switch: (client, id, connect) => {
			const device = exactDevice(manager, client, id)
			if (!device) return false
			if (connect) manager.connect(device)
			else manager.disconnect(device)
			return true
		},
		close: (client) => manager.close(client, false),
		observe: (lifecycle) => lifecycle.observe(manager),
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
	// Coalescing state of each mount's state events, by device id.
	readonly #mountPublications = new Map<string, MountPublication>()
	// Last published sensor geometry of each camera, by device id.
	readonly #cameraSensors = new Map<string, CameraSensor | undefined>()
	// Last published capabilities of each camera as JSON, by device id.
	readonly #cameraCapabilities = new Map<string, string>()
	// Manager of the cameras of every connection, shared with the capture service.
	readonly cameras = new CameraManager()
	// Manager of the mounts of every connection, shared with the mount commands.
	readonly mounts = new MountManager()
	// Handler that feeds the property stream of a client to every manager, in MANAGED_TYPES order.
	readonly handler = new IndiClientHandlerSet()

	// Creates the managers; listener receives every device event synchronously.
	constructor(listener: DeviceListener) {
		this.#listener = listener

		const camera = this.cameras
		const mount = this.mounts
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

	// Makes a lifecycle bridge follow the devices of every managed type, so their availability and the
	// cancellation of their operations track connects, disconnects, and removals. Returns a function that
	// stops following them.
	observe(lifecycle: DeviceLifecycle): VoidFunction {
		const disposers = MANAGED_TYPES.map((type) => this.#managers[type].observe(lifecycle))
		return () => {
			for (const dispose of disposers) dispose()
		}
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

	// Returns the mount with exactly this id on the client, for commanding it.
	mount(client: Client, id: string): Mount | undefined {
		return exactDevice(this.mounts, client, id)
	}

	// Returns the state of the client's mount with this id; undefined when it has no such mount.
	mountState(client: Client, id: string): MountState | undefined {
		const mount = this.mount(client, id)
		return mount && this.#mountState(mount)
	}

	// Returns the camera with exactly this id on the client, for capturing with it.
	camera(client: Client, id: string): Camera | undefined {
		return exactDevice(this.cameras, client, id)
	}

	// Returns the capabilities of the client's camera with this id; undefined when it has no such camera.
	cameraCapabilities(client: Client, id: string): CameraCapabilities | undefined {
		const camera = this.camera(client, id)
		const connectionId = camera && this.#connections.get(client)
		return connectionId ? cameraCapabilities(camera, connectionId) : undefined
	}

	// Returns the sensor geometry of the client's camera with this id; undefined when it has no such camera.
	cameraSensor(client: Client, id: string): CameraSensorState | undefined {
		const camera = exactDevice(this.cameras, client, id)
		const connectionId = camera && this.#connections.get(client)
		return connectionId ? { connectionId, id, sensor: cameraSensor(camera) } : undefined
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

	// State of a mount; undefined when its client is not attached.
	#mountState(mount: Mount): MountState | undefined {
		const client = mount[CLIENT]
		const connectionId = client && this.#connections.get(client)
		if (!connectionId) return undefined
		const { connected, slewing, tracking, parked, parking, canGoTo, canAbort } = mount
		const { rightAscension, declination } = mount.equatorialCoordinate
		return { connectionId, id: mount.id, connected, rightAscension, declination, slewing, tracking, parked, parking, canGoTo, canAbort }
	}

	// Publishes the current state of a mount now, cancelling its pending trailing publication.
	#publishMount(mount: Mount, publication: MountPublication) {
		clearTimeout(publication.timer)
		publication.timer = undefined
		publication.last = performance.now()
		const state = this.#mountState(mount)
		if (state) this.#listener({ type: 'mount:updated', state })
	}

	// Publishes a change of a mount field: motion-state changes at once, coordinate changes at most once
	// per MOUNT_STATE_INTERVAL, with a trailing publication so the last coordinate is always delivered.
	#mountUpdated(mount: Mount, property: string) {
		const motion = MOUNT_MOTION_FIELDS.has(property)
		if (!motion && property !== 'equatorialCoordinate') return

		let publication = this.#mountPublications.get(mount.id)

		if (!publication) {
			publication = { last: -Infinity }
			this.#mountPublications.set(mount.id, publication)
		}

		if (motion) {
			this.#publishMount(mount, publication)
			return
		}

		if (publication.timer !== undefined) return

		const pending = publication
		const delay = pending.last + MOUNT_STATE_INTERVAL - performance.now()
		if (delay <= 0) this.#publishMount(mount, pending)
		else pending.timer = setTimeout(() => this.#publishMount(mount, pending), delay)
	}

	// Publishes the sensor geometry and the capabilities of a camera when a change of one of their source
	// fields altered them.
	#cameraUpdated(camera: Camera, property: string) {
		const client = camera[CLIENT]
		const connectionId = client && this.#connections.get(client)
		if (!connectionId) return

		if (CAMERA_CAPABILITY_FIELDS.has(property)) {
			const capabilities = cameraCapabilities(camera, connectionId)
			const json = JSON.stringify(capabilities)

			if (this.#cameraCapabilities.get(camera.id) !== json) {
				this.#cameraCapabilities.set(camera.id, json)
				this.#listener({ type: 'camera:capabilities', capabilities })
			}
		}

		if (!CAMERA_SENSOR_FIELDS.has(property)) return

		const sensor = cameraSensor(camera)
		if (this.#cameraSensors.has(camera.id) && sameSensor(this.#cameraSensors.get(camera.id), sensor)) return
		this.#cameraSensors.set(camera.id, sensor)
		this.#listener({ type: 'camera:sensor', state: { connectionId, id: camera.id, sensor } })
	}

	// Forgets the telemetry state of a removed device, cancelling its pending publication.
	#forget(device: Device) {
		clearTimeout(this.#mountPublications.get(device.id)?.timer)
		this.#mountPublications.delete(device.id)
		this.#cameraSensors.delete(device.id)
		this.#cameraCapabilities.delete(device.id)
	}

	// Builds the handler that publishes the lifecycle of the devices of one managed type, and the
	// telemetry of mounts and cameras.
	#lifecycle(type: ManagedDeviceType): LifecycleHandler {
		return {
			added: (device) => {
				const summary = this.#summary(device, type)
				if (summary) this.#listener({ type: 'device:added', device: summary })
			},
			updated: (device, property, state) => {
				if (property === 'connected') {
					const summary = this.#summary(device, type)
					if (summary) this.#listener({ type: 'device:updated', connectionId: summary.connectionId, id: device.id, connected: device.connected, state })
				}

				if (type === 'mount') this.#mountUpdated(device as Mount, property)
				else if (type === 'camera') this.#cameraUpdated(device as Camera, property)
			},
			removed: (device) => {
				if (type === 'mount' || type === 'camera') this.#forget(device)
				const summary = this.#summary(device, type)
				if (summary) this.#listener({ type: 'device:removed', connectionId: summary.connectionId, id: device.id })
			},
		}
	}
}
