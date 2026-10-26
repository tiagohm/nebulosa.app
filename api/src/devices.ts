import { type IndiClientHandler, IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
// oxfmt-ignore
import { type Camera, type CameraTransferFormat, CLIENT, type Client, type Cover, type Device, type DeviceType, type DewHeater, type Dome, type DomeDirection, type DomeOTASide, type DomeShutterState, type DriverInfo, type FlatPanel, type Focuser, type GuideOutput, type MinMaxValueProperty, type Mount, type MountType, type NameAndLabel, type PierSide, type Rotator, type TrackMode, type Wheel } from 'nebulosa/src/devices/indi/device'
import { CameraManager } from 'nebulosa/src/devices/indi/manager/camera'
import { CoverManager } from 'nebulosa/src/devices/indi/manager/cover'
import type { DeviceManager, DeviceProvider } from 'nebulosa/src/devices/indi/manager/device'
import { DewHeaterManager } from 'nebulosa/src/devices/indi/manager/dewheater'
import { DomeManager } from 'nebulosa/src/devices/indi/manager/dome'
import { FlatPanelManager } from 'nebulosa/src/devices/indi/manager/flatpanel'
import { FocuserManager } from 'nebulosa/src/devices/indi/manager/focuser'
import { GuideOutputManager } from 'nebulosa/src/devices/indi/manager/guideoutput'
import { MountManager } from 'nebulosa/src/devices/indi/manager/mount'
import { RotatorManager } from 'nebulosa/src/devices/indi/manager/rotator'
import { ThermometerManager } from 'nebulosa/src/devices/indi/manager/thermometer'
import { WheelManager } from 'nebulosa/src/devices/indi/manager/wheel'
import { IndiPropertyRegistry } from 'nebulosa/src/devices/indi/properties'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import type { DeviceLifecycle } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { toMeter } from 'nebulosa/src/math/units/distance'

// Application-wide registry of the devices discovered on every open connection. One device manager per
// managed type ingests the property stream of all clients; the registry maps each client back to the
// connection that opened it, summarizes devices for clients, and publishes their lifecycle, their
// connection-state changes, and the control state of every managed type: what each device reports and
// what it can be asked for. A state is published whole, never as a delta, and only when it differs from
// the last one published for the device; changes of continuously moving values (a mount's coordinate, a
// focuser's position, a rotator's angle, a dome's azimuth) are coalesced to at most one event per second
// per device, with a trailing publication so the last value is always delivered. Every event names its
// connection and device id, never a role. The raw property vectors of every device, managed or not, are
// kept once in a property registry the managers share and read.

// Device types the application manages.
export type ManagedDeviceType = Extract<DeviceType, 'camera' | 'mount' | 'focuser' | 'wheel' | 'rotator' | 'guideOutput' | 'dome' | 'cover' | 'flatPanel' | 'dewHeater'>

// Device model of each managed type.
export interface ManagedDeviceMap {
	// Camera.
	readonly camera: Camera
	// Mount.
	readonly mount: Mount
	// Focuser.
	readonly focuser: Focuser
	// Filter wheel.
	readonly wheel: Wheel
	// Field rotator.
	readonly rotator: Rotator
	// Guide output, standalone or the pulse-guide interface of a mount or camera.
	readonly guideOutput: GuideOutput
	// Dome.
	readonly dome: Dome
	// Dust cover or flip-flat.
	readonly cover: Cover
	// Flat-field light panel.
	readonly flatPanel: FlatPanel
	// Dew heater, the heater interface of a device such as a cover.
	readonly dewHeater: DewHeater
}

// Device as reported to clients: identity, physical identity, and connection state.
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
	// Id of the physical device, MD5 of its client id and name; shared by every interface of one device
	// (a cover and its flat panel, a mount and its guide output), and the key operations arbitrate on.
	readonly hardwareId: string
	// Interfaces the driver declares for the physical device, managed or not.
	readonly interfaces: readonly DeviceType[]
	// Driver executable and version; empty strings when the driver reports none.
	readonly driver: DriverInfo
}

// Numeric value with the range and resolution its driver publishes, in the units of the owning field.
export interface DeviceRange {
	// Current value.
	readonly value: number
	// Lowest accepted value.
	readonly min: number
	// Highest accepted value.
	readonly max: number
	// Increment the driver advertises; 0 when it advertises none.
	readonly step: number
}

// Identity and connection of a device state.
export interface DeviceStateBase {
	// Id of the open connection that provides the device.
	readonly connectionId: string
	// Stable id of the device.
	readonly id: string
	// Whether the driver reports the device as connected to its hardware.
	readonly connected: boolean
}

// Geodetic site a mount reports.
export interface MountSite {
	// Latitude in radians, north positive.
	readonly latitude: number
	// Longitude in radians, east positive, (-π, π].
	readonly longitude: number
	// Height above the ellipsoid in meters.
	readonly elevation: number
}

// Clock a mount reports.
export interface MountTime {
	// UTC instant, Unix milliseconds; 0 while the driver has reported none.
	readonly utc: number
	// Offset of local time from UTC, in minutes.
	readonly offset: number
}

// Pointing, motion, configuration, and capabilities of a mount as reported to clients. The coordinate is
// meaningful only while connected is true: a disconnected mount has no position.
export interface MountState extends DeviceStateBase {
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
	// Whether the mount is moving to its home position.
	readonly homing: boolean
	// Whether the driver accepts goto commands.
	readonly canGoTo: boolean
	// Whether the driver accepts a meridian flip to a target.
	readonly canFlip: boolean
	// Whether the driver accepts a sync to a coordinate.
	readonly canSync: boolean
	// Whether the driver accepts an abort of its motion.
	readonly canAbort: boolean
	// Whether tracking can be switched.
	readonly canTracking: boolean
	// Whether the driver accepts park and unpark.
	readonly canPark: boolean
	// Whether the current position can be stored as the park position.
	readonly canSetPark: boolean
	// Whether the driver accepts a slew to its home position.
	readonly canHome: boolean
	// Whether the driver accepts a search for its home position.
	readonly canFindHome: boolean
	// Whether the current position can be stored as the home position.
	readonly canSetHome: boolean
	// Whether at least one axis accepts manual motion.
	readonly canMove: boolean
	// Whether the north/south axis accepts manual motion.
	readonly canMoveNS: boolean
	// Whether the west/east axis accepts manual motion.
	readonly canMoveWE: boolean
	// Whether the driver reports an axis in manual motion.
	readonly moving: boolean
	// Speed presets of manual motion, in driver order; empty when the driver offers no choice.
	readonly slewRates: readonly NameAndLabel[]
	// Name of the selected speed preset; absent when the driver reports none.
	readonly slewRate?: string
	// Tracking rates the driver offers, in its order; empty when it offers no choice.
	readonly trackModes: readonly TrackMode[]
	// Selected tracking rate.
	readonly trackMode: TrackMode
	// Mechanical design of the mount.
	readonly mountType: MountType
	// Whether the driver reports the side of the pier.
	readonly hasPierSide: boolean
	// Side of the pier the telescope is on; NEITHER when unknown.
	readonly pierSide: PierSide
	// Site the mount uses for its own coordinate conversions.
	readonly site: MountSite
	// Clock of the mount.
	readonly time: MountTime
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

// Range of a numeric camera control, in the units of the driver.
export interface CameraRange {
	// Lowest accepted value.
	readonly min: number
	// Highest accepted value.
	readonly max: number
}

// What a camera can be asked for in a capture, and its thermal state, as its driver reports them. A control
// the driver does not publish is absent, and the capture leaves it unchanged.
export interface CameraCapabilities extends DeviceStateBase {
	// Driver-reported camera name.
	readonly name: string
	// Accepted exposure time, in seconds; absent while the driver has not published a positive maximum.
	readonly exposure?: CameraRange
	// Gain range; absent when the driver has no gain control.
	readonly gain?: CameraRange
	// Offset range; absent when the driver has no offset control.
	readonly offset?: CameraRange
	// Largest horizontal and vertical binning factors; absent when the driver cannot bin.
	readonly bin?: { readonly x: number; readonly y: number }
	// Full-frame sensor geometry; absent while the driver has not reported a positive frame size and pixel size.
	readonly sensor?: CameraSensor
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
	// Cooler state: whether it is on (absent when it cannot be switched) and its power in percent; absent
	// when the camera has no cooler, that is, neither a cooler switch nor a settable target temperature.
	readonly cooler?: { readonly enabled?: boolean; readonly power: number }
	// Whether a cooling target temperature can be set.
	readonly canSetTemperature: boolean
}

// Position, motion, and capabilities of a focuser as reported to clients.
export interface FocuserState extends DeviceStateBase {
	// Whether the focuser is moving.
	readonly moving: boolean
	// Position in steps, with the travel the driver accepts.
	readonly position: DeviceRange
	// Whether the focuser accepts a move to an absolute position.
	readonly canAbsoluteMove: boolean
	// Whether the focuser accepts a move by a number of steps.
	readonly canRelativeMove: boolean
	// Whether a move can be aborted.
	readonly canAbort: boolean
	// Whether the motion direction can be reversed.
	readonly canReverse: boolean
	// Whether the motion direction is reversed.
	readonly reversed: boolean
	// Whether the position counter can be redefined without moving.
	readonly canSync: boolean
	// Whether the driver offers a backlash compensation of its own that can be switched.
	readonly hasBacklash: boolean
	// Whether the driver compensates the backlash of every move itself; compensated moves of Nebulosa are then refused.
	readonly backlashEnabled: boolean
	// Backlash the driver compensates, in steps.
	readonly backlash: DeviceRange
	// Temperature in degrees Celsius; absent when the focuser has no thermometer.
	readonly temperature?: number
}

// Slot, motion, and filter names of a filter wheel as reported to clients.
export interface WheelState extends DeviceStateBase {
	// Whether the wheel is moving.
	readonly moving: boolean
	// Slot the wheel stands at, 0-based.
	readonly position: number
	// Number of slots.
	readonly count: number
	// Filter names in slot order; may be shorter than count when the driver names fewer slots.
	readonly names: readonly string[]
	// Whether the filter names can be changed.
	readonly canSetNames: boolean
}

// Angle, motion, and capabilities of a field rotator as reported to clients.
export interface RotatorState extends DeviceStateBase {
	// Whether the rotator is moving.
	readonly moving: boolean
	// Mechanical angle in degrees, with the range the driver accepts; not a sky position angle.
	readonly angle: DeviceRange
	// Whether a move can be aborted.
	readonly canAbort: boolean
	// Whether the rotation direction can be reversed.
	readonly canReverse: boolean
	// Whether the rotation direction is reversed.
	readonly reversed: boolean
	// Whether the angle can be redefined without moving.
	readonly canSync: boolean
	// Whether the rotator accepts a move to its home position.
	readonly canHome: boolean
}

// Position and capabilities of a dust cover as reported to clients. Parked means closed.
export interface CoverState extends DeviceStateBase {
	// Whether the cover stands closed.
	readonly parked: boolean
	// Whether the cover is moving.
	readonly parking: boolean
	// Whether the cover accepts open and close.
	readonly canPark: boolean
	// Whether a motion can be aborted.
	readonly canAbort: boolean
}

// Light state of a flat panel as reported to clients.
export interface FlatPanelState extends DeviceStateBase {
	// Whether the light is on.
	readonly enabled: boolean
	// Brightness in the driver's own units, with the range it accepts.
	readonly intensity: DeviceRange
}

// Optional geometry a dome reports, in meters.
export interface DomeMeasurements {
	// Radius of the dome.
	readonly radius: number
	// Width of the shutter opening.
	readonly shutterWidth: number
	// Offset of the mount from the dome center towards north.
	readonly northDisplacement: number
	// Offset of the mount from the dome center towards east.
	readonly eastDisplacement: number
	// Offset of the mount from the dome center upwards.
	readonly upDisplacement: number
	// Distance of the optical tube from the mount axis, along the driver's convention.
	readonly otaOffset: number
	// Side of the mount the optical tube is on.
	readonly otaSide: DomeOTASide
}

// Position, shutter, motion, configuration, and capabilities of a dome as reported to clients.
export interface DomeState extends DeviceStateBase {
	// Whether a slew to a target is in progress.
	readonly slewing: boolean
	// Whether the dome rotates in manual motion.
	readonly moving: boolean
	// Whether the dome is searching its home position.
	readonly homing: boolean
	// Whether the dome stands at its home position.
	readonly atHome: boolean
	// Direction of the manual motion; absent while none runs.
	readonly direction?: DomeDirection
	// Whether the dome is parked.
	readonly parked: boolean
	// Whether the dome is moving to its park position.
	readonly parking: boolean
	// Whether the dome accepts park.
	readonly canPark: boolean
	// Whether the dome accepts unpark.
	readonly canUnpark: boolean
	// Whether the current position can be stored as the park position.
	readonly canSetPark: boolean
	// Whether a motion can be aborted.
	readonly canAbort: boolean
	// Whether the dome accepts manual rotation.
	readonly canMove: boolean
	// Whether the dome accepts a rotation by an angle.
	readonly canRelativeMove: boolean
	// Whether the dome accepts a slew to an azimuth.
	readonly canSetAzimuth: boolean
	// Whether the shutter accepts a move to an altitude.
	readonly canSetAltitude: boolean
	// Whether the dome accepts a search for its home position.
	readonly canFindHome: boolean
	// Whether the rotation speed can be set.
	readonly canSetSpeed: boolean
	// Whether the azimuth can be redefined without moving.
	readonly canSync: boolean
	// Whether the driver offers backlash compensation.
	readonly hasBacklash: boolean
	// Whether backlash compensation is on.
	readonly backlashEnabled: boolean
	// Backlash compensation in controller steps.
	readonly backlash: DeviceRange
	// Whether the dome has a shutter.
	readonly hasShutter: boolean
	// Whether the shutter accepts open and close.
	readonly canSetShutter: boolean
	// State of the shutter.
	readonly shutterState: DomeShutterState
	// Whether the driver can follow the mount by itself.
	readonly canSlave: boolean
	// Whether the driver follows the mount.
	readonly slaved: boolean
	// Azimuth in radians from north through east, with the range the driver accepts.
	readonly azimuth: DeviceRange
	// Shutter altitude in radians, with the range the driver accepts.
	readonly altitude: DeviceRange
	// Rotation speed in RPM, with the range the driver accepts.
	readonly speed: DeviceRange
	// Geometry of the dome; absent when the driver reports none.
	readonly measurements?: DomeMeasurements
}

// Pulse-guide state and capabilities of a guide output as reported to clients.
export interface GuideOutputState extends DeviceStateBase {
	// Whether the output accepts guide pulses.
	readonly canPulseGuide: boolean
	// Whether a pulse is in progress on any axis.
	readonly pulsing: boolean
	// Whether a pulse is in progress on the north/south axis.
	readonly pulsingNS: boolean
	// Whether a pulse is in progress on the west/east axis.
	readonly pulsingWE: boolean
	// Whether the driver reports guide rates.
	readonly hasGuideRate: boolean
	// Whether the guide rates can be set.
	readonly canSetGuideRate: boolean
	// Guide rates as fractions of the sidereal rate.
	readonly guideRate: { readonly rightAscension: number; readonly declination: number }
}

// Heating level of a dew heater as reported to clients.
export interface DewHeaterState extends DeviceStateBase {
	// Whether the heater channel exists.
	readonly hasDewHeater: boolean
	// Duty cycle in the driver's own PWM units, with the range it accepts.
	readonly dutyCycle: DeviceRange
}

// Control state of each managed type.
export interface DeviceStateMap {
	// Capabilities and thermal state of a camera.
	readonly camera: CameraCapabilities
	// State of a mount.
	readonly mount: MountState
	// State of a focuser.
	readonly focuser: FocuserState
	// State of a filter wheel.
	readonly wheel: WheelState
	// State of a field rotator.
	readonly rotator: RotatorState
	// State of a guide output.
	readonly guideOutput: GuideOutputState
	// State of a dome.
	readonly dome: DomeState
	// State of a dust cover.
	readonly cover: CoverState
	// State of a flat panel.
	readonly flatPanel: FlatPanelState
	// State of a dew heater.
	readonly dewHeater: DewHeaterState
}

// Control states of the devices of one connection, by managed type.
export type DeviceStates = { readonly [T in ManagedDeviceType]: readonly DeviceStateMap[T][] }

// Notification carrying the control state of one device: camera capabilities keep their historical shape,
// every other type publishes a `<type>:updated` event with the whole state.
export type DeviceStateEvent = { readonly type: 'camera:capabilities'; readonly capabilities: CameraCapabilities } | { readonly [T in Exclude<ManagedDeviceType, 'camera'>]: { readonly type: `${T}:updated`; readonly state: DeviceStateMap[T] } }[Exclude<ManagedDeviceType, 'camera'>]

// Notification published when a device appears, disappears, or changes its connection state, and when its
// control state changes.
export type DeviceEvent =
	| { readonly type: 'device:added'; readonly device: DeviceSummary }
	| { readonly type: 'device:removed'; readonly connectionId: string; readonly id: string }
	// State is the driver's CONNECTION property state: Busy while switching, Alert on failure.
	| { readonly type: 'device:updated'; readonly connectionId: string; readonly id: string; readonly connected: boolean; readonly state?: PropertyState }
	| DeviceStateEvent

// Receiver of device events.
export type DeviceListener = (event: DeviceEvent) => void

// Managed types in handler order: guide outputs come after mounts and cameras, and dew heaters after
// covers, because each resolves the device it is an interface of.
const MANAGED_TYPES: readonly ManagedDeviceType[] = ['camera', 'mount', 'focuser', 'wheel', 'rotator', 'guideOutput', 'dome', 'cover', 'flatPanel', 'dewHeater']

// Shortest interval between two state events of one device caused by changes of continuously moving
// values, in milliseconds. Other changes are published at once.
const STATE_INTERVAL = 1000

// How the control state of one managed type is built and published.
interface StatePublisher<T extends ManagedDeviceType> {
	// Device fields whose change may alter the state; absent when any field may. Changes of other fields
	// are ignored without building the state, which matters for fields updated many times per second.
	readonly fields?: ReadonlySet<string>
	// Fields whose changes are coalesced to at most one event per STATE_INTERVAL.
	readonly coalesced?: ReadonlySet<string>
	// Builds the state of a device attributed to its connection.
	readonly state: (device: ManagedDeviceMap[T], connectionId: string) => DeviceStateMap[T]
	// Wraps a state in its event.
	readonly event: (state: DeviceStateMap[T]) => DeviceEvent
}

// Publisher of every managed type.
type StatePublishers = { readonly [T in ManagedDeviceType]: StatePublisher<T> }

// Mount fields the state depends on.
const MOUNT_FIELDS: ReadonlySet<string> = new Set([
	'connected',
	'equatorialCoordinate',
	'slewing',
	'tracking',
	'parked',
	'parking',
	'homing',
	'canGoTo',
	'canFlip',
	'canSync',
	'canAbort',
	'canTracking',
	'canPark',
	'canSetPark',
	'canHome',
	'canFindHome',
	'canSetHome',
	'canMove',
	'canMoveNS',
	'canMoveWE',
	'moving',
	'slewRates',
	'slewRate',
	'trackModes',
	'trackMode',
	'mountType',
	'hasPierSide',
	'pierSide',
	'geographicCoordinate',
	'time',
])

// Camera fields the capabilities depend on. The exposure field changes on every progress update, so its
// changes are published only when the capabilities themselves differ.
const CAMERA_CAPABILITY_FIELDS: ReadonlySet<string> = new Set([
	'connected',
	'exposure',
	'gain',
	'offset',
	'canBin',
	'bin',
	'canSubFrame',
	'frame',
	'pixelSize',
	'canAbort',
	'frameFormats',
	'frameFormat',
	'transferFormats',
	'hasThermometer',
	'temperature',
	'hasCoolerControl',
	'cooler',
	'coolerPower',
	'canSetTemperature',
])

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
	// Device with exactly this id on exactly this client.
	readonly exact: (client: Client, id: string) => Device | undefined
	// Sends the CONNECTION switch to the client's device with exactly this id; false when there is none.
	readonly switch: (client: Client, id: string, connect: boolean) => boolean
	// Drops every device of a closed client.
	readonly close: (client: Client) => void
	// Makes a lifecycle bridge follow the manager's devices; returns a function that stops it.
	readonly observe: (lifecycle: DeviceLifecycle) => VoidFunction
}

// Publication state of one device's control state.
interface StatePublication {
	// Time of the last published event in milliseconds, on the performance clock.
	last: number
	// Last published state as JSON.
	json?: string
	// Pending trailing publication, if any.
	timer?: Timer
}

// Returns the device of a manager with exactly this id on exactly this client. Managers also match
// hardware ids and names, and match ids on any client, which must never select another connection's device.
function exactDevice<D extends Device>(manager: DeviceManager<D>, client: Client, id: string): D | undefined {
	const device = manager.get(client, id)
	return device?.id === id && device[CLIENT] === client ? device : undefined
}

// Returns a numeric property with its range.
function range({ value, min, max, step }: MinMaxValueProperty): DeviceRange {
	return { value, min, max, step }
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
		sensor: cameraSensor(camera),
		subframe: camera.canSubFrame && camera.frame.width.max > 0 && camera.frame.height.max > 0 ? { width: camera.frame.width.max, height: camera.frame.height.max } : undefined,
		canAbort: camera.canAbort,
		frameFormats: camera.frameFormats,
		frameFormat: camera.frameFormat,
		transferFormats: camera.transferFormats,
		temperature: camera.hasThermometer ? camera.temperature : undefined,
		// hasCooler only says CCD_TEMPERATURE is defined, which a camera with a bare thermometer also does.
		cooler: camera.hasCoolerControl || camera.canSetTemperature ? { enabled: camera.hasCoolerControl ? camera.cooler : undefined, power: camera.coolerPower } : undefined,
		canSetTemperature: camera.canSetTemperature,
	}
}

// Returns the state of a mount, attributed to its connection.
export function mountState(mount: Mount, connectionId: string): MountState {
	const { connected, slewing, tracking, parked, parking, homing, canGoTo, canFlip, canSync, canAbort, canTracking, canPark, canSetPark, canHome, canFindHome, canSetHome, canMove, canMoveNS, canMoveWE, moving, slewRate, trackMode, mountType, hasPierSide, pierSide } = mount
	const { rightAscension, declination } = mount.equatorialCoordinate
	const { latitude, longitude, elevation } = mount.geographicCoordinate
	const slewRates = mount.slewRates.map(({ name, label }) => ({ name, label }))
	const site = { latitude, longitude, elevation: toMeter(elevation) }
	const time = { utc: mount.time.utc, offset: mount.time.offset }
	// oxfmt-ignore
	return { connectionId, id: mount.id, connected, rightAscension, declination, slewing, tracking, parked, parking, homing, canGoTo, canFlip, canSync, canAbort, canTracking, canPark, canSetPark, canHome, canFindHome, canSetHome, canMove, canMoveNS, canMoveWE, moving, slewRates, slewRate, trackModes: [...mount.trackModes], trackMode, mountType, hasPierSide, pierSide, site, time }
}

// Returns the state of a focuser, attributed to its connection.
export function focuserState(focuser: Focuser, connectionId: string): FocuserState {
	const { id, connected, moving, canAbsoluteMove, canRelativeMove, canAbort, canReverse, reversed, canSync, hasBacklash, backlashEnabled } = focuser
	return { connectionId, id, connected, moving, position: range(focuser.position), canAbsoluteMove, canRelativeMove, canAbort, canReverse, reversed, canSync, hasBacklash, backlashEnabled, backlash: range(focuser.backlash), temperature: focuser.hasThermometer ? focuser.temperature : undefined }
}

// Returns the state of a filter wheel, attributed to its connection.
export function wheelState(wheel: Wheel, connectionId: string): WheelState {
	const { id, connected, moving, position, count, canSetNames } = wheel
	return { connectionId, id, connected, moving, position, count, names: [...wheel.names], canSetNames }
}

// Returns the state of a field rotator, attributed to its connection.
export function rotatorState(rotator: Rotator, connectionId: string): RotatorState {
	const { id, connected, moving, canAbort, canReverse, reversed, canSync, canHome } = rotator
	return { connectionId, id, connected, moving, angle: range(rotator.angle), canAbort, canReverse, reversed, canSync, canHome }
}

// Returns the state of a dust cover, attributed to its connection.
export function coverState(cover: Cover, connectionId: string): CoverState {
	const { id, connected, parked, parking, canPark, canAbort } = cover
	return { connectionId, id, connected, parked, parking, canPark, canAbort }
}

// Returns the state of a flat panel, attributed to its connection.
export function flatPanelState(panel: FlatPanel, connectionId: string): FlatPanelState {
	return { connectionId, id: panel.id, connected: panel.connected, enabled: panel.enabled, intensity: range(panel.intensity) }
}

// Returns the state of a dome, attributed to its connection.
export function domeState(dome: Dome, connectionId: string): DomeState {
	// oxfmt-ignore
	const { id, connected, slewing, moving, homing, atHome, direction, parked, parking, canPark, canUnpark, canSetPark, canAbort, canMove, canRelativeMove, canSetAzimuth, canSetAltitude, canFindHome, canSetSpeed, canSync, hasBacklash, backlashEnabled, hasShutter, canSetShutter, shutterState, canSlave, slaved } = dome
	const measurements = dome.hasMeasurements ? { ...dome.measurements } : undefined
	// oxfmt-ignore
	return { connectionId, id, connected, slewing, moving, homing, atHome, direction, parked, parking, canPark, canUnpark, canSetPark, canAbort, canMove, canRelativeMove, canSetAzimuth, canSetAltitude, canFindHome, canSetSpeed, canSync, hasBacklash, backlashEnabled, backlash: range(dome.backlash), hasShutter, canSetShutter, shutterState, canSlave, slaved, azimuth: range(dome.azimuth), altitude: range(dome.altitude), speed: range(dome.speed), measurements }
}

// Returns the state of a guide output, attributed to its connection.
export function guideOutputState(output: GuideOutput, connectionId: string): GuideOutputState {
	const { id, connected, canPulseGuide, pulsing, pulsingNS, pulsingWE, hasGuideRate, canSetGuideRate } = output
	return { connectionId, id, connected, canPulseGuide, pulsing, pulsingNS, pulsingWE, hasGuideRate, canSetGuideRate, guideRate: { rightAscension: output.guideRate.rightAscension, declination: output.guideRate.declination } }
}

// Returns the state of a dew heater, attributed to its connection.
export function dewHeaterState(heater: DewHeater, connectionId: string): DewHeaterState {
	return { connectionId, id: heater.id, connected: heater.connected, hasDewHeater: heater.hasDewHeater, dutyCycle: range(heater.dutyCycle) }
}

// How the control state of every managed type is built and published.
const PUBLISHERS: StatePublishers = {
	camera: { fields: CAMERA_CAPABILITY_FIELDS, state: cameraCapabilities, event: (capabilities) => ({ type: 'camera:capabilities', capabilities }) },
	mount: { fields: MOUNT_FIELDS, coalesced: new Set(['equatorialCoordinate', 'time']), state: mountState, event: (state) => ({ type: 'mount:updated', state }) },
	focuser: { coalesced: new Set(['position', 'temperature']), state: focuserState, event: (state) => ({ type: 'focuser:updated', state }) },
	wheel: { state: wheelState, event: (state) => ({ type: 'wheel:updated', state }) },
	rotator: { coalesced: new Set(['angle']), state: rotatorState, event: (state) => ({ type: 'rotator:updated', state }) },
	guideOutput: { state: guideOutputState, event: (state) => ({ type: 'guideOutput:updated', state }) },
	dome: { coalesced: new Set(['azimuth', 'altitude']), state: domeState, event: (state) => ({ type: 'dome:updated', state }) },
	cover: { state: coverState, event: (state) => ({ type: 'cover:updated', state }) },
	flatPanel: { state: flatPanelState, event: (state) => ({ type: 'flatPanel:updated', state }) },
	dewHeater: { state: dewHeaterState, event: (state) => ({ type: 'dewHeater:updated', state }) },
}

// Wraps a manager as ManagedDevices and registers handler for its device lifecycle.
function managed<D extends Device>(manager: DeviceManager<D>, handler: LifecycleHandler): ManagedDevices {
	manager.addHandler(handler)

	return {
		handler: manager,
		list: (client) => manager.list(client),
		get: (client, id) => manager.get(client, id),
		exact: (client, id) => exactDevice(manager, client, id),
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
	// Publication state of each device's control state, by device id.
	readonly #publications = new Map<string, StatePublication>()
	// Raw property vectors of every device of every connection, managed or not: the one copy the managers
	// read and the INDI property view is served from. First in the handler, so a manager handling one vector
	// reads the others already merged.
	readonly properties = new IndiPropertyRegistry()
	// Manager of the cameras of every connection, shared with the camera services.
	readonly cameras = new CameraManager(this.properties)
	// Manager of the mounts of every connection, shared with the mount commands.
	readonly mounts = new MountManager(this.properties)
	// Manager of the focusers of every connection.
	readonly focusers = new FocuserManager(this.properties)
	// Manager of the filter wheels of every connection.
	readonly wheels = new WheelManager(this.properties)
	// Manager of the field rotators of every connection.
	readonly rotators = new RotatorManager(this.properties)
	// Manager of the guide outputs of every connection, each one standalone or an interface of a mount or camera.
	readonly guideOutputs: GuideOutputManager
	// Manager of the domes of every connection.
	readonly domes = new DomeManager(this.properties)
	// Manager of the dust covers of every connection.
	readonly covers = new CoverManager(this.properties)
	// Manager of the flat panels of every connection.
	readonly flatPanels = new FlatPanelManager(this.properties)
	// Manager of the dew heaters of every connection, each one an interface of a device such as a cover.
	readonly dewHeaters: DewHeaterManager
	// Reader of the sensor temperature (degrees Celsius) of the cameras and focusers of every connection. It
	// only writes the temperature of the parent device, published with the parent's control state; its
	// thermometer proxies are not a managed type.
	readonly thermometers: ThermometerManager
	// Handler that feeds the property stream of a client to the property registry, then to every manager in
	// MANAGED_TYPES order, then to the thermometer manager.
	readonly handler = new IndiClientHandlerSet([this.properties])

	// Creates the managers; listener receives every device event synchronously.
	constructor(listener: DeviceListener) {
		this.#listener = listener

		const camera = this.cameras
		const mount = this.mounts
		const cover = this.covers
		// A guide output is a standalone guider or a sub-interface of a mount or camera.
		this.guideOutputs = new GuideOutputManager({ get: (client, id, type) => (type === 'camera' ? camera.get(client, id) : mount.get(client, id)) }, this.properties)
		// A dew heater is the heater channel of a device that declares one, such as a cover.
		this.dewHeaters = new DewHeaterManager({ get: (client, id) => cover.get(client, id) }, this.properties)
		// A thermometer is the temperature vector of a camera (CCD_TEMPERATURE) or a focuser (FOCUS_TEMPERATURE).
		const focuser = this.focusers
		this.thermometers = new ThermometerManager({ get: (client, id, type) => (type === 'camera' ? camera.get(client, id) : focuser.get(client, id)) }, this.properties)

		this.#managers = {
			camera: managed(camera, this.#lifecycle('camera')),
			mount: managed(mount, this.#lifecycle('mount')),
			focuser: managed(this.focusers, this.#lifecycle('focuser')),
			wheel: managed(this.wheels, this.#lifecycle('wheel')),
			rotator: managed(this.rotators, this.#lifecycle('rotator')),
			guideOutput: managed(this.guideOutputs, this.#lifecycle('guideOutput')),
			dome: managed(this.domes, this.#lifecycle('dome')),
			cover: managed(cover, this.#lifecycle('cover')),
			flatPanel: managed(this.flatPanels, this.#lifecycle('flatPanel')),
			dewHeater: managed(this.dewHeaters, this.#lifecycle('dewHeater')),
		}

		for (const type of MANAGED_TYPES) this.handler.add(this.#managers[type].handler)

		// After the camera and focuser managers, which create the parents the proxies wrap.
		this.thermometers.addHandler({
			added: () => {},
			updated: (device, property) => {
				if (device.type === 'camera' || device.type === 'focuser') this.#stateUpdated(device.type, device as never, property)
			},
			removed: () => {},
		})
		this.handler.add(this.thermometers)
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

	// Drops every device and property vector of a closed client, publishing device:removed for each.
	close(client: Client) {
		for (const type of MANAGED_TYPES) this.#managers[type].close(client)
		this.thermometers.close(client, false)
		this.properties.close(client, false)
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

	// Returns the device of a managed type with exactly this id on the client, for commanding it.
	device<T extends ManagedDeviceType>(client: Client, type: T, id: string): ManagedDeviceMap[T] | undefined {
		return this.#managers[type].exact(client, id) as ManagedDeviceMap[T] | undefined
	}

	// Returns the control state of the client's device of a managed type with this id; undefined when it
	// has no such device or the client is not attached.
	state<T extends ManagedDeviceType>(client: Client, type: T, id: string): DeviceStateMap[T] | undefined {
		const device = this.device(client, type, id)
		const connectionId = device && this.#connections.get(client)
		return connectionId ? PUBLISHERS[type].state(device, connectionId) : undefined
	}

	// Returns the control states of every device of the client, by managed type; empty when the client is
	// not attached.
	states(client: Client): DeviceStates {
		const connectionId = this.#connections.get(client)
		const states = {} as Record<ManagedDeviceType, unknown[]>

		for (const type of MANAGED_TYPES) {
			const publisher = PUBLISHERS[type] as StatePublisher<ManagedDeviceType>
			const list: unknown[] = []
			if (connectionId) for (const device of this.#managers[type].list(client)) if (device.type === type) list.push(publisher.state(device as never, connectionId))
			states[type] = list
		}

		return states as unknown as DeviceStates
	}

	// Returns the mount with exactly this id on the client, for commanding it.
	mount(client: Client, id: string): Mount | undefined {
		return this.device(client, 'mount', id)
	}

	// Returns the state of the client's mount with this id; undefined when it has no such mount.
	mountState(client: Client, id: string): MountState | undefined {
		return this.state(client, 'mount', id)
	}

	// Returns the camera with exactly this id on the client, for capturing with it.
	camera(client: Client, id: string): Camera | undefined {
		return this.device(client, 'camera', id)
	}

	// Returns the capabilities of the client's camera with this id; undefined when it has no such camera.
	cameraCapabilities(client: Client, id: string): CameraCapabilities | undefined {
		return this.state(client, 'camera', id)
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

	// Id of the open connection a client belongs to; undefined when it is not attached.
	connection(client: Client): string | undefined {
		return this.#connections.get(client)
	}

	// Id of the open connection that provides a device; undefined when its client is not attached.
	connectionOf(device: Device): string | undefined {
		const client = device[CLIENT]
		return client && this.#connections.get(client)
	}

	// Summarizes a device listed under type; undefined when its client is not attached.
	#summary(device: Device, type: ManagedDeviceType): DeviceSummary | undefined {
		const client = device[CLIENT]
		const connectionId = client && this.#connections.get(client)
		if (!connectionId) return undefined
		const { executable, version } = device.driver
		return { id: device.id, type, name: device.name, connected: device.connected, connectionId, hardwareId: device.hardwareId, interfaces: [...device.interfaces], driver: { executable, version } }
	}

	// Publishes the current control state of a device now, cancelling its pending trailing publication,
	// unless it equals the last one published.
	#publishState<T extends ManagedDeviceType>(type: T, device: ManagedDeviceMap[T], publication: StatePublication) {
		clearTimeout(publication.timer)
		publication.timer = undefined
		publication.last = performance.now()

		const client = device[CLIENT]
		const connectionId = client && this.#connections.get(client)
		if (!connectionId) return

		const publisher = PUBLISHERS[type]
		const state = publisher.state(device, connectionId)
		const json = JSON.stringify(state)
		if (publication.json === json) return
		publication.json = json
		this.#listener(publisher.event(state))
	}

	// Publishes a change of a device field: coalesced fields at most once per STATE_INTERVAL, with a
	// trailing publication so the last value is always delivered, every other field at once.
	#stateUpdated<T extends ManagedDeviceType>(type: T, device: ManagedDeviceMap[T], property: string) {
		const publisher = PUBLISHERS[type]
		if (publisher.fields && !publisher.fields.has(property)) return

		let publication = this.#publications.get(device.id)

		if (!publication) {
			publication = { last: -Infinity }
			this.#publications.set(device.id, publication)
		}

		if (!publisher.coalesced?.has(property)) {
			this.#publishState(type, device, publication)
			return
		}

		if (publication.timer !== undefined) return

		const pending = publication
		const delay = pending.last + STATE_INTERVAL - performance.now()
		if (delay <= 0) this.#publishState(type, device, pending)
		else pending.timer = setTimeout(() => this.#publishState(type, device, pending), delay)
	}

	// Forgets the publication state of a removed device, cancelling its pending publication.
	#forget(device: Device) {
		clearTimeout(this.#publications.get(device.id)?.timer)
		this.#publications.delete(device.id)
	}

	// Builds the handler that publishes the lifecycle and the control state of the devices of one managed
	// type. A sub-interface manager also reports changes of the parent device it wraps (a mount behind a
	// guide output); those belong to the parent's own type and are not published as this type's state.
	#lifecycle(type: ManagedDeviceType): LifecycleHandler {
		return {
			added: (device) => {
				const summary = this.#summary(device, type)
				if (summary) this.#listener({ type: 'device:added', device: summary })
			},
			updated: (device, property, state) => {
				if (device.type !== type) return

				if (property === 'connected') {
					const summary = this.#summary(device, type)
					if (summary) this.#listener({ type: 'device:updated', connectionId: summary.connectionId, id: device.id, connected: device.connected, state })
				}

				this.#stateUpdated(type, device as never, property)
			},
			removed: (device) => {
				if (device.type === type) this.#forget(device)
				const summary = this.#summary(device, type)
				if (summary) this.#listener({ type: 'device:removed', connectionId: summary.connectionId, id: device.id })
			},
		}
	}
}
