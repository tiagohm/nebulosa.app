import type { Server } from 'bun'
import { CameraCaptures, type CaptureRequest } from './captures'
import { errorResponse } from './commands'
import { connections } from './connection'
import { handleListDirectory } from './files'
import { handleDeriveImage, handleDownloadImage, handleOpenImage, handleRenderImage, handleSaveImage, images } from './images'
import { MountCommands, type MountNudgeRequest, type MountSlewRateRequest, type MountSlewRequest } from './mounts'
import { OperationRegistry } from './operations'
import { skyLocator, skyRoutes } from './sky'
import { broadcast, websocket } from './websocket'

// HTTP routes and the WebSocket handler of the backend, mounted by the app server.

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
export type { DirectoryListing, FileEntry } from './files'
export type { MountNudgeDirection, MountNudgeEvent, MountNudgePhase, MountNudgeRequest, MountNudgeSession, MountNudgeStartResponse, MountSlewRateRequest, MountSlewRequest, MountSlewResponse } from './mounts'
export type { OperationDevice, OperationEvent, OperationKind, OperationRecord, OperationState } from './operations'
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
const captures = new CameraCaptures(connections.devices, (id) => connections.client(id), operations, images, broadcast)

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
	...skyRoutes,
	'/api/ws': {
		// Upgrades to the event WebSocket; Bun sends the handshake response itself.
		GET: (req: Request, server: Server<undefined>) => (server.upgrade(req) ? undefined : new Response('WebSocket upgrade failed', { status: 400 })),
	},
} as const as Readonly<Bun.Serve.Routes<undefined, string>>
