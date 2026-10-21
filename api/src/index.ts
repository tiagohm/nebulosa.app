import type { Server } from 'bun'
import { type CameraCoolerRequest, CameraCommands, type CameraTemperatureRequest } from './cameras'
import { CameraCaptures, type CaptureRequest } from './captures'
import { type CommandRequest, errorResponse } from './commands'
import { connections } from './connection'
import { CoverCommands } from './covers'
import { DewHeaterCommands, type DewHeaterDutyCycleRequest } from './dewheaters'
import { type DomeAltitudeRequest, type DomeBacklashRequest, DomeCommands, type DomeMotionRequest, type DomeMoveByRequest, type DomeShutterRequest, type DomeSlavingRequest, type DomeSlewRequest, type DomeSpeedRequest, type DomeSyncRequest } from './domes'
import { createExternalToolsRoutes, DEFAULT_SETTINGS_FILE, ExternalToolsStore } from './externaltools'
import { handleListDirectory } from './files'
import { FlatPanelCommands, type FlatPanelIntensityRequest, type FlatPanelLightRequest } from './flatpanels'
import { FocuserCommands, type FocuserMoveRequest, type FocuserMoveToRequest, type FocuserReverseRequest, type FocuserSyncRequest } from './focusers'
import { GuideOutputCommands, type GuidePulseRequest, type GuideRateRequest } from './guideoutputs'
import { handleDeriveImage, handleDownloadImage, handleOpenImage, handleRenderImage, handleSaveImage, images } from './images'
import { MountCommands, type MountGoToRequest, type MountNudgeRequest, type MountSiteRequest, type MountSlewRateRequest, type MountSlewRequest, type MountSyncRequest, type MountTimeRequest, type MountTrackingRequest, type MountTrackModeRequest } from './mounts'
import { OperationRegistry } from './operations'
import { RotatorCommands, type RotatorMoveByRequest, type RotatorMoveToRequest, type RotatorReverseRequest, type RotatorSyncRequest } from './rotators'
import { skyLocator, skyRoutes } from './sky'
import { broadcast, websocket } from './websocket'
import { WheelCommands, type WheelMoveRequest, type WheelNamesRequest } from './wheels'

// HTTP routes and the WebSocket handler of the backend, mounted by the app server.

export type { CameraCoolerRequest, CameraTemperatureRequest } from './cameras'
export type { CaptureEvent, CaptureFormat, CaptureFrame, CaptureOutput, CaptureOutputMode, CapturePhase, CaptureRequest, CaptureSession, CaptureSettings, CaptureSnapshot, CaptureStartResponse } from './captures'
export type { ConnectionEvent, ConnectionStatus, ConnectionType, ConnectRequest, RemoteConnectRequest, ServerEvent } from './connection'
export type { CommandAccepted, CommandError, CommandErrorCode, CommandRequest } from './commands'
export type {
	CameraCapabilities,
	CameraRange,
	CameraSensor,
	CameraSensorState,
	CoverState,
	DeviceEvent,
	DeviceRange,
	DeviceStateBase,
	DeviceStateEvent,
	DeviceStateMap,
	DeviceStates,
	DeviceSummary,
	DewHeaterState,
	DomeMeasurements,
	DomeState,
	FlatPanelState,
	FocuserState,
	GuideOutputState,
	ManagedDeviceType,
	MountSite,
	MountState,
	MountTime,
	RotatorState,
	WheelState,
} from './devices'
export type { DewHeaterDutyCycleRequest } from './dewheaters'
export type { DomeAltitudeRequest, DomeBacklashRequest, DomeMotionEvent, DomeMotionRequest, DomeMotionSession, DomeMotionStartResponse, DomeMoveByRequest, DomeShutterRequest, DomeSlavingRequest, DomeSlewRequest, DomeSpeedRequest, DomeSyncRequest } from './domes'
export type { ExternalToolCapability, ExternalToolCheck, ExternalToolCheckCode, ExternalToolCheckStatus, ExternalToolConfig, ExternalToolConfigStatus, ExternalToolDefinition, ExternalToolEvent, ExternalToolId, ExternalToolSaveRequest, ExternalToolState, ExternalToolTestRequest, TimeoutLimits } from './externaltools'
export type { LeasedPhase, LeasedSession, LeasedStartResponse, LeaseOptions } from './leases'
export type { DirectoryListing, FileEntry } from './files'
export type { FlatPanelIntensityRequest, FlatPanelLightRequest } from './flatpanels'
export type { FocuserDirection, FocuserMoveRequest, FocuserMoveToRequest, FocuserReverseRequest, FocuserSyncRequest } from './focusers'
export type { GuidePulseRequest, GuideRateRequest } from './guideoutputs'
export type {
	MountCoordinate,
	MountGoToRequest,
	MountNudgeDirection,
	MountNudgeEvent,
	MountNudgePhase,
	MountNudgeRequest,
	MountNudgeSession,
	MountNudgeStartResponse,
	MountSiteRequest,
	MountSlewRateRequest,
	MountSlewRequest,
	MountSlewResponse,
	MountSyncRequest,
	MountTimeRequest,
	MountTrackingRequest,
	MountTrackModeRequest,
} from './mounts'
export type { OperationDevice, OperationEvent, OperationKind, OperationRecord, OperationState } from './operations'
export type { RotatorMoveByRequest, RotatorMoveToRequest, RotatorReverseRequest, RotatorSyncRequest } from './rotators'
export type { WheelMoveRequest, WheelNamesRequest } from './wheels'
export type { EphemerisFallbackReason, EphemerisMode, EphemerisSource, SkyEvents, SkyObserver, SkyPosition } from './sky/ephemeris'
export type { MinorBody, MinorBodyParameter, MinorBodySearchResponse, SkyBodiesRequest, SkyBodyPosition, SkyCatalogObject, SkyConstellation, SkyConstellations, SkyDeepSkyData, SkyObjectCategory, SkyObjectRef, SkyPositionRequest, SkyPositionResponse, SkySearchResult, SkyStarData, SolarSystemBodyCode } from './sky/types'
export type { Binning, DeriveRequest, DisplayDebayer, DisplayScnr, DisplaySettings, DisplayStretch, ImageAcquisition, ImageCapture, ImageFormat, ImageInfo, ImageOrigin, ImageProperties, ImageProvenance, RenderRequest, RenderResult, SaveRequest, SaveResult, Stretch } from './images'
export { websocket }

connections.listen(broadcast)

// Device operations of the process, published to every tab.
const operations = new OperationRegistry(connections.devices, broadcast)

// Mount commands and nudge sessions over the devices of the open connections.
const mounts = new MountCommands(connections.devices, (id) => connections.client(id), skyLocator, operations, broadcast)

// Camera captures over the devices of the open connections, their frames entering the image store.
// Pulse guiding of the guide outputs of the open connections.
const guideOutputs = new GuideOutputCommands(connections.devices, (id) => connections.client(id), operations)

// Focuser, filter wheel, and rotator commands over the devices of the open connections.
const focusers = new FocuserCommands(connections.devices, (id) => connections.client(id), operations)
const wheels = new WheelCommands(connections.devices, (id) => connections.client(id), operations)
const rotators = new RotatorCommands(connections.devices, (id) => connections.client(id), operations)

// Cover, flat panel, and dew heater commands over the devices of the open connections.
const covers = new CoverCommands(connections.devices, (id) => connections.client(id), operations)
const flatPanels = new FlatPanelCommands(connections.devices, (id) => connections.client(id), operations)
const dewHeaters = new DewHeaterCommands(connections.devices, (id) => connections.client(id), operations)

// Dome commands and manual rotation sessions over the devices of the open connections.
const domes = new DomeCommands(connections.devices, (id) => connections.client(id), operations, broadcast)

// Cooling of the cameras of the open connections, arbitrated against their captures.
const cameras = new CameraCommands(connections.devices, (id) => connections.client(id), operations)

const captures = new CameraCaptures(connections.devices, (id) => connections.client(id), operations, images, broadcast)

// Settings of the external programs, such as ASTAP, read by the services that run them.
const externalTools = new ExternalToolsStore(DEFAULT_SETTINGS_FILE, broadcast)

// Opens a connection, or returns the existing one for the same endpoint. Responds 400 for an invalid
// body and 502 when the endpoint cannot be reached.
async function connect(req: Request): Promise<Response> {
	try {
		return Response.json(await connections.connect(await req.json()))
	} catch (error) {
		return Response.json({ error: Error.isError(error) ? error.message : 'Unable to connect' }, { status: 502 })
	}
}

// Sends the CONNECTION switch to a device of an open connection. Responds 202 once sent (the new state
// arrives as a device:updated event) and 404 when the connection is not open or has no such device.
function switchDevice(id: string, deviceId: string, connect: boolean): Response {
	const client = connections.client(id)
	if (!client || !connections.devices.switch(client, deviceId, connect)) return Response.json({ error: 'Device not found' }, { status: 404 })
	return new Response(null, { status: 202 })
}

// Bun.serve routes under /api/.
export const routes = {
	'/api/health': {
		GET: () => Response.json({ status: 'ok' }),
	},
	'/api/operations': {
		// The device operations still running, started by any tab.
		GET: () => Response.json(operations.running()),
	},
	'/api/connections': {
		// The open connections, shared by every tab.
		GET: () => Response.json(connections.list()),
		POST: connect,
	},
	'/api/connections/:id': {
		// Closes the connection for every tab; 404 when it is not open.
		DELETE: (req) => new Response(null, { status: connections.disconnect(req.params.id) ? 204 : 404 }),
	},
	'/api/connections/:id/devices': {
		// The managed devices of an open connection; 404 when it is not open.
		GET: (req) => {
			const client = connections.client(req.params.id)
			return client ? Response.json(connections.devices.list(client)) : Response.json({ error: 'Connection not found' }, { status: 404 })
		},
	},
	'/api/connections/:id/states': {
		// The control state of every managed device of an open connection, by type; 404 when it is not open.
		GET: (req) => {
			const client = connections.client(req.params.id)
			return client ? Response.json(connections.devices.states(client)) : errorResponse('Connection not found', 404, 'notFound')
		},
	},
	'/api/connections/:id/devices/:deviceId/connect': {
		POST: (req) => switchDevice(req.params.id, req.params.deviceId, true),
	},
	'/api/connections/:id/devices/:deviceId/disconnect': {
		POST: (req) => switchDevice(req.params.id, req.params.deviceId, false),
	},
	'/api/connections/:id/mounts/:deviceId': {
		// Pointing and motion state of a mount; 404 when the connection is not open or has no such mount.
		GET: (req) => mounts.state(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/mounts/:deviceId/slew': {
		// Slews a mount to an object resolved at the current time; the outcome arrives as operation:updated events.
		POST: async (req) => mounts.slew(req.params.id, req.params.deviceId, (await req.json()) as MountSlewRequest, req.signal),
	},
	'/api/connections/:id/mounts/:deviceId/stop': {
		// Cancels the operation of a mount and stops its motion.
		POST: (req) => mounts.stop(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/mounts/:deviceId/slew-rate': {
		// Selects the speed preset of manual motion; the new preset arrives as a mount:updated event.
		POST: async (req) => mounts.setSlewRate(req.params.id, req.params.deviceId, (await req.json()) as MountSlewRateRequest),
	},
	'/api/connections/:id/mounts/:deviceId/nudge': {
		// Starts a nudge held by a lease; its changes arrive as mount:nudge and operation:updated events.
		POST: async (req) => mounts.startNudge(req.params.id, req.params.deviceId, (await req.json()) as MountNudgeRequest),
	},
	'/api/connections/:id/mounts/:deviceId/goto': {
		// Starts a goto to a coordinate; the outcome arrives as operation:updated events.
		POST: async (req) => mounts.goTo(req.params.id, req.params.deviceId, (await req.json()) as MountGoToRequest),
	},
	'/api/connections/:id/mounts/:deviceId/flip': {
		// Starts a meridian flip to a coordinate; the outcome arrives as operation:updated events.
		POST: async (req) => mounts.flip(req.params.id, req.params.deviceId, (await req.json()) as MountGoToRequest),
	},
	'/api/connections/:id/mounts/:deviceId/sync': {
		// Redefines where the mount points.
		POST: async (req) => mounts.sync(req.params.id, req.params.deviceId, (await req.json()) as MountSyncRequest),
	},
	'/api/connections/:id/mounts/:deviceId/park': {
		// Starts parking; the outcome arrives as operation:updated events.
		POST: async (req) => mounts.park(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
	},
	'/api/connections/:id/mounts/:deviceId/unpark': {
		// Starts unparking; the outcome arrives as operation:updated events.
		POST: async (req) => mounts.unpark(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
	},
	'/api/connections/:id/mounts/:deviceId/home': {
		// Starts a slew to the home position; the outcome arrives as operation:updated events.
		POST: async (req) => mounts.home(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
	},
	'/api/connections/:id/mounts/:deviceId/find-home': {
		// Starts the search for the home position; the outcome arrives as operation:updated events.
		POST: async (req) => mounts.findHome(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
	},
	'/api/connections/:id/mounts/:deviceId/set-home': {
		// Stores the current position as the home position.
		POST: (req) => mounts.setHome(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/mounts/:deviceId/set-park': {
		// Stores the current position as the park position.
		POST: (req) => mounts.setPark(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/mounts/:deviceId/tracking': {
		// Switches tracking, answered once the mount reports it.
		POST: async (req) => mounts.setTracking(req.params.id, req.params.deviceId, (await req.json()) as MountTrackingRequest),
	},
	'/api/connections/:id/mounts/:deviceId/track-mode': {
		// Selects the tracking rate; the new rate arrives as a mount:updated event.
		POST: async (req) => mounts.setTrackMode(req.params.id, req.params.deviceId, (await req.json()) as MountTrackModeRequest),
	},
	'/api/connections/:id/mounts/:deviceId/site': {
		// Sends a site to the mount.
		POST: async (req) => mounts.setSite(req.params.id, req.params.deviceId, (await req.json()) as MountSiteRequest),
	},
	'/api/connections/:id/mounts/:deviceId/time': {
		// Sends a clock to the mount.
		POST: async (req) => mounts.setTime(req.params.id, req.params.deviceId, (await req.json()) as MountTimeRequest),
	},
	'/api/connections/:id/guide-outputs/:deviceId': {
		// Pulse-guide state of a guide output; 404 when the connection is not open or has no such output.
		GET: (req) => guideOutputs.state(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/guide-outputs/:deviceId/pulse': {
		// Starts a guide pulse; the outcome arrives as operation:updated events.
		POST: async (req) => guideOutputs.pulse(req.params.id, req.params.deviceId, (await req.json()) as GuidePulseRequest),
	},
	'/api/connections/:id/guide-outputs/:deviceId/guide-rate': {
		// Sets the guide rates; the new rates arrive as a guideOutput:updated event.
		POST: async (req) => guideOutputs.setGuideRate(req.params.id, req.params.deviceId, (await req.json()) as GuideRateRequest),
	},
	'/api/connections/:id/guide-outputs/:deviceId/stop': {
		// Stops every pulse of a guide output.
		POST: (req) => guideOutputs.stop(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/focusers/:deviceId': {
		// Position, motion, and capabilities of a focuser; 404 when the connection is not open or has no such focuser.
		GET: (req) => focusers.state(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/focusers/:deviceId/move-to': {
		// Starts a move to an absolute position; the outcome arrives as operation:updated events.
		POST: async (req) => focusers.moveTo(req.params.id, req.params.deviceId, (await req.json()) as FocuserMoveToRequest),
	},
	'/api/connections/:id/focusers/:deviceId/move': {
		// Starts a move by a number of steps; the outcome arrives as operation:updated events.
		POST: async (req) => focusers.move(req.params.id, req.params.deviceId, (await req.json()) as FocuserMoveRequest),
	},
	'/api/connections/:id/focusers/:deviceId/sync': {
		// Redefines the position counter without moving.
		POST: async (req) => focusers.sync(req.params.id, req.params.deviceId, (await req.json()) as FocuserSyncRequest),
	},
	'/api/connections/:id/focusers/:deviceId/reverse': {
		// Reverses or restores the motion direction.
		POST: async (req) => focusers.reverse(req.params.id, req.params.deviceId, (await req.json()) as FocuserReverseRequest),
	},
	'/api/connections/:id/focusers/:deviceId/stop': {
		// Cancels the move of a focuser and stops it.
		POST: (req) => focusers.stop(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/wheels/:deviceId': {
		// Slot, motion, and names of a filter wheel; 404 when the connection is not open or has no such wheel.
		GET: (req) => wheels.state(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/wheels/:deviceId/move': {
		// Starts a change of slot; the outcome arrives as operation:updated events.
		POST: async (req) => wheels.move(req.params.id, req.params.deviceId, (await req.json()) as WheelMoveRequest),
	},
	'/api/connections/:id/wheels/:deviceId/names': {
		// Renames the slots; the new names arrive as a wheel:updated event.
		POST: async (req) => wheels.setNames(req.params.id, req.params.deviceId, (await req.json()) as WheelNamesRequest),
	},
	'/api/connections/:id/rotators/:deviceId': {
		// Angle, motion, and capabilities of a rotator; 404 when the connection is not open or has no such rotator.
		GET: (req) => rotators.state(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/rotators/:deviceId/move-to': {
		// Starts a move to a mechanical angle; the outcome arrives as operation:updated events.
		POST: async (req) => rotators.moveTo(req.params.id, req.params.deviceId, (await req.json()) as RotatorMoveToRequest),
	},
	'/api/connections/:id/rotators/:deviceId/move-by': {
		// Starts a move by an angle; the outcome arrives as operation:updated events.
		POST: async (req) => rotators.moveBy(req.params.id, req.params.deviceId, (await req.json()) as RotatorMoveByRequest),
	},
	'/api/connections/:id/rotators/:deviceId/home': {
		// Starts a move to the home position; the outcome arrives as operation:updated events.
		POST: async (req) => rotators.home(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
	},
	'/api/connections/:id/rotators/:deviceId/sync': {
		// Redefines the angle without moving.
		POST: async (req) => rotators.sync(req.params.id, req.params.deviceId, (await req.json()) as RotatorSyncRequest),
	},
	'/api/connections/:id/rotators/:deviceId/reverse': {
		// Reverses or restores the rotation direction.
		POST: async (req) => rotators.reverse(req.params.id, req.params.deviceId, (await req.json()) as RotatorReverseRequest),
	},
	'/api/connections/:id/rotators/:deviceId/stop': {
		// Cancels the move of a rotator and stops it.
		POST: (req) => rotators.stop(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/covers/:deviceId': {
		// Position and capabilities of a cover; 404 when the connection is not open or has no such cover.
		GET: (req) => covers.state(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/covers/:deviceId/open': {
		// Starts opening a cover; the outcome arrives as operation:updated events.
		POST: async (req) => covers.open(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
	},
	'/api/connections/:id/covers/:deviceId/close': {
		// Starts closing a cover; the outcome arrives as operation:updated events.
		POST: async (req) => covers.close(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
	},
	'/api/connections/:id/covers/:deviceId/stop': {
		// Cancels the motion of a cover and stops it.
		POST: (req) => covers.stop(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/flat-panels/:deviceId': {
		// Light state of a flat panel; 404 when the connection is not open or has no such panel.
		GET: (req) => flatPanels.state(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/flat-panels/:deviceId/light': {
		// Switches the light; the new state arrives as a flatPanel:updated event.
		POST: async (req) => flatPanels.setLight(req.params.id, req.params.deviceId, (await req.json()) as FlatPanelLightRequest),
	},
	'/api/connections/:id/flat-panels/:deviceId/intensity': {
		// Sets the brightness; the new value arrives as a flatPanel:updated event.
		POST: async (req) => flatPanels.setIntensity(req.params.id, req.params.deviceId, (await req.json()) as FlatPanelIntensityRequest),
	},
	'/api/connections/:id/dew-heaters/:deviceId': {
		// Heating level of a dew heater; 404 when the connection is not open or has no such heater.
		GET: (req) => dewHeaters.state(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/dew-heaters/:deviceId/duty-cycle': {
		// Sets the duty cycle; the new value arrives as a dewHeater:updated event.
		POST: async (req) => dewHeaters.setDutyCycle(req.params.id, req.params.deviceId, (await req.json()) as DewHeaterDutyCycleRequest),
	},
	'/api/connections/:id/domes/:deviceId': {
		// Position, shutter, and capabilities of a dome; 404 when the connection is not open or has no such dome.
		GET: (req) => domes.state(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/domes/:deviceId/slew': {
		// Starts a slew to an azimuth; the outcome arrives as operation:updated events.
		POST: async (req) => domes.slew(req.params.id, req.params.deviceId, (await req.json()) as DomeSlewRequest),
	},
	'/api/connections/:id/domes/:deviceId/move-by': {
		// Starts a rotation by an angle; the outcome arrives as operation:updated events.
		POST: async (req) => domes.moveBy(req.params.id, req.params.deviceId, (await req.json()) as DomeMoveByRequest),
	},
	'/api/connections/:id/domes/:deviceId/altitude': {
		// Starts a move of the shutter to an altitude; the outcome arrives as operation:updated events.
		POST: async (req) => domes.moveToAltitude(req.params.id, req.params.deviceId, (await req.json()) as DomeAltitudeRequest),
	},
	'/api/connections/:id/domes/:deviceId/home': {
		// Starts the search for the home position; the outcome arrives as operation:updated events.
		POST: async (req) => domes.home(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
	},
	'/api/connections/:id/domes/:deviceId/park': {
		// Starts parking; the outcome arrives as operation:updated events.
		POST: async (req) => domes.park(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
	},
	'/api/connections/:id/domes/:deviceId/unpark': {
		// Starts unparking; the outcome arrives as operation:updated events.
		POST: async (req) => domes.unpark(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
	},
	'/api/connections/:id/domes/:deviceId/shutter': {
		// Starts opening or closing the shutter; the outcome arrives as operation:updated events.
		POST: async (req) => domes.shutter(req.params.id, req.params.deviceId, (await req.json()) as DomeShutterRequest),
	},
	'/api/connections/:id/domes/:deviceId/slaving': {
		// Switches the driver's slaving to the mount, answered once the dome reports it.
		POST: async (req) => domes.setSlaving(req.params.id, req.params.deviceId, (await req.json()) as DomeSlavingRequest),
	},
	'/api/connections/:id/domes/:deviceId/sync': {
		// Redefines the azimuth without moving.
		POST: async (req) => domes.sync(req.params.id, req.params.deviceId, (await req.json()) as DomeSyncRequest),
	},
	'/api/connections/:id/domes/:deviceId/set-park': {
		// Stores the current position as the park position.
		POST: (req) => domes.setPark(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/domes/:deviceId/speed': {
		// Sets the rotation speed.
		POST: async (req) => domes.setSpeed(req.params.id, req.params.deviceId, (await req.json()) as DomeSpeedRequest),
	},
	'/api/connections/:id/domes/:deviceId/backlash': {
		// Switches backlash compensation and sets its steps.
		POST: async (req) => domes.setBacklash(req.params.id, req.params.deviceId, (await req.json()) as DomeBacklashRequest),
	},
	'/api/connections/:id/domes/:deviceId/stop': {
		// Cancels the operation of a dome and stops its motion.
		POST: (req) => domes.stop(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/domes/:deviceId/motion': {
		// Starts a manual rotation held by a lease; its changes arrive as dome:motion and operation:updated events.
		POST: async (req) => domes.startMotion(req.params.id, req.params.deviceId, (await req.json()) as DomeMotionRequest),
	},
	'/api/domes/motions': {
		// The manual rotations still running, started by any tab.
		GET: () => Response.json(domes.motions()),
	},
	'/api/domes/motions/:token/heartbeat': {
		// Renews the lease of a running manual rotation.
		POST: (req) => domes.heartbeatMotion(req.params.token),
	},
	'/api/domes/motions/:token/stop': {
		// Ends a manual rotation, or records a press that has not started yet as ended; idempotent.
		POST: (req) => domes.stopMotion(req.params.token),
	},
	'/api/connections/:id/cameras/:deviceId/cooler': {
		// Switches the cooler; the new state arrives as a camera:capabilities event.
		POST: async (req) => cameras.setCooler(req.params.id, req.params.deviceId, (await req.json()) as CameraCoolerRequest),
	},
	'/api/connections/:id/cameras/:deviceId/temperature': {
		// Sets the cooling target; the sensor temperature arrives as camera:capabilities events.
		POST: async (req) => cameras.setTemperature(req.params.id, req.params.deviceId, (await req.json()) as CameraTemperatureRequest),
	},
	'/api/mounts/nudges': {
		// The nudge sessions still running, started by any tab.
		GET: () => Response.json(mounts.nudges()),
	},
	'/api/mounts/nudges/:token/heartbeat': {
		// Renews the lease of a running nudge.
		POST: (req) => mounts.heartbeatNudge(req.params.token),
	},
	'/api/mounts/nudges/:token/stop': {
		// Ends a nudge, or records a press that has not started yet as ended; idempotent.
		POST: (req) => mounts.stopNudge(req.params.token),
	},
	'/api/captures': {
		// The latest capture session and previewed frame of every camera, started by any tab.
		GET: () => Response.json(captures.snapshot()),
	},
	'/api/connections/:id/cameras/:deviceId': {
		// Capture capabilities and thermal state of a camera; 404 when the connection is not open or has no such camera.
		GET: (req) => captures.capabilities(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/cameras/:deviceId/capture': {
		// Starts a capture; its progress and outcome arrive as capture:updated and operation:updated events.
		POST: async (req) => captures.start(req.params.id, req.params.deviceId, (await req.json()) as CaptureRequest),
	},
	'/api/connections/:id/cameras/:deviceId/capture/stop': {
		// Stops the capture of a camera after the exposure in flight.
		POST: (req) => captures.stop(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/cameras/:deviceId/capture/abort': {
		// Aborts the exposure in flight and ends the capture of a camera.
		POST: (req) => captures.abort(req.params.id, req.params.deviceId),
	},
	'/api/connections/:id/cameras/:deviceId/sensor': {
		// Sensor geometry of a camera; 404 when the connection is not open or has no such camera.
		GET: (req) => {
			const client = connections.client(req.params.id)
			const sensor = client && connections.devices.cameraSensor(client, req.params.deviceId)
			return sensor ? Response.json(sensor) : Response.json({ error: 'Camera not found' }, { status: 404 })
		},
	},
	'/api/files': {
		// A directory of the server's filesystem; 404 when missing, 403 when unreadable.
		GET: handleListDirectory,
	},
	'/api/images': {
		// Opens a FITS or XISF file of the server as an image document.
		POST: handleOpenImage,
	},
	'/api/images/:id': {
		// Closes an image document; 404 when it is not open.
		DELETE: (req) => new Response(null, { status: images.close(req.params.id) ? 204 : 404 }),
	},
	'/api/images/:id/render': {
		POST: (req) => handleRenderImage(req, req.params.id),
	},
	'/api/images/:id/derive': {
		// Creates an unsaved document from an image document and display settings.
		POST: (req) => handleDeriveImage(req, req.params.id),
	},
	'/api/images/:id/save': {
		// Writes an image document to a file of the server.
		POST: (req) => handleSaveImage(req, req.params.id),
	},
	'/api/images/:id/file': {
		// Downloads an image document as a FITS or XISF file.
		GET: (req) => handleDownloadImage(req, req.params.id),
	},
	...createExternalToolsRoutes(externalTools),
	...skyRoutes,
	'/api/ws': {
		// Upgrades to the event WebSocket; Bun sends the handshake response itself.
		GET: (req: Request, server: Server<undefined>) => (server.upgrade(req) ? undefined : new Response('WebSocket upgrade failed', { status: 400 })),
	},
} as const as Readonly<Bun.Serve.Routes<undefined, string>>
