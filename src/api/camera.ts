import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import { CLIENT } from 'nebulosa/src/devices/indi/device'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import type { CameraManager, DeviceHandler, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import type { BlobEncoding, PropertyState } from 'nebulosa/src/devices/indi/types'
import { EventBus } from 'src/shared/bus'
import type { CameraFrameEvent, CameraCaptureEvent, CameraCaptureStart, CameraAdded, CameraRemoved, CameraUpdated } from '#/camera'
import type { CameraCaptureListener } from './camera.capture'
import { CameraCapturer } from './camera.capture'
import { query, response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'
import type { OperationCoordinator, OperationScope } from './operation'
import { resourceKey } from './resource'

// Presentation events fanned out to WebSocket subscribers. These publish state and never participate in
// the correctness of a capture: dropping one loses a UI update, not a frame or a device command.
export interface CameraBusEvents {
	// A camera became known to its manager.
	readonly add: CameraAdded
	// One camera property changed, carrying only the changed field and its INDI state.
	readonly update: CameraUpdated
	// A camera disappeared from its manager.
	readonly remove: CameraRemoved
	// One frame finished processing, naming the path it was written to.
	readonly frame: CameraFrameEvent
	// Capture progress or a terminal snapshot for one session.
	readonly capture: CameraCaptureEvent
}

// Process-wide fanout of camera presentation events.
export const cameraBus = new EventBus<CameraBusEvents>()

// Publishes camera transport events and delegates capture ownership to CameraCapturer.
export class CameraHandler implements DeviceHandler<Camera> {
	// Registers the camera transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraManager: CameraManager,
		readonly mountManager: MountManager,
		readonly wheelManager: WheelManager,
		readonly focuserManager: FocuserManager,
		readonly rotatorManager: RotatorManager,
		readonly capturer: CameraCapturer,
		readonly coordinator: OperationCoordinator,
	) {
		cameraManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of cameraManager.list()) {
				wsm.send<CameraAdded>('camera:add', { device }, socket)
			}
		})

		cameraBus.subscribe('add', (event) => wsm.send('camera:add', event))
		cameraBus.subscribe('update', (event) => wsm.send('camera:update', event))
		cameraBus.subscribe('remove', (event) => wsm.send('camera:remove', event))
		cameraBus.subscribe('frame', (event) => wsm.send('camera:frame', event))
		cameraBus.subscribe('capture', (event) => wsm.send('camera:capture', event))
	}

	// Image processor retained for feature adapters that have not moved to camera services yet.
	get imageProcessor() {
		return this.capturer.imageProcessor
	}

	// Publishes a newly discovered camera.
	added(device: Camera) {
		cameraBus.emit('add', { device })
		console.info('camera added:', device.name, device.id)
	}

	// Publishes property changes and routes capture-relevant state to the current session.
	updated(camera: Camera, property: keyof Camera & string, state?: PropertyState) {
		cameraBus.emit('update', { device: { id: camera.id, name: camera.name, [property]: camera[property] }, property, state })
		this.capturer.updated(camera, property, state)
	}

	// Publishes removal after notifying the current session.
	removed(camera: Camera) {
		this.capturer.removed(camera)
		cameraBus.emit('remove', { device: camera })
		console.info('camera removed:', camera.name)
	}

	// Routes a camera BLOB to the current generation without involving the presentation bus.
	blobReceived(camera: Camera, data: Buffer, encoding: BlobEncoding) {
		this.capturer.blobReceived(camera, data, encoding)
	}

	// Lists cameras, optionally scoped to one INDI client.
	list(client?: string | IndiClient) {
		return Array.from(this.cameraManager.list(client))
	}

	// Publishes either capture progress or one processed frame path.
	sendEvent(event: CameraCaptureEvent, path?: string) {
		if (path) {
			cameraBus.emit('frame', { operation: event.operation, session: event.session, generation: event.generation, camera: event.camera, path })
		} else {
			// Sessions emit a fresh snapshot per event and never mutate it afterwards, so no further copy is needed.
			cameraBus.emit('capture', event)
		}
	}

	// Starts a capture under the given scope and returns its operation-backed milestones.
	//
	// The scope is what decides whether the capture is an operation of its own or a step of a larger one. A
	// route passes the coordinator and gets a new tree; a composite feature passes its own context and the
	// capture nests inside it, inheriting the camera the feature already holds instead of competing for it.
	capture(scope: OperationScope, camera: Camera, request: CameraCaptureStart, onCameraCaptureEvent?: CameraCaptureListener, rejectedListener: CameraCaptureListener | undefined = onCameraCaptureEvent) {
		const client = camera[CLIENT]!

		// Snoop devices are resolved but deliberately not acquired: the driver only reads them to stamp FITS
		// headers, so requiring ownership would make a capture conflict with whoever is actually slewing the
		// mount or moving the focuser. Only the camera is exclusive here.
		const mount = request.mount ? this.mountManager.get(client, request.mount) : undefined
		const wheel = request.wheel ? this.wheelManager.get(client, request.wheel) : undefined
		const focuser = request.focuser ? this.focuserManager.get(client, request.focuser) : undefined
		const rotator = request.rotator ? this.rotatorManager.get(client, request.rotator) : undefined

		return this.capturer.start(scope, camera, request, {
			listener: (event, path) => {
				this.sendEvent(event, path)
				onCameraCaptureEvent?.(event, path)
			},
			prepare: () => this.cameraManager.snoop(camera, mount, focuser, wheel, rotator),
			rejectedListener,
		})
	}

	// Cancels one capture scope by operation id, or whatever operation currently owns the camera.
	//
	// The arbiter already knows the owner, so no local index is kept here: one would miss every capture a
	// composite feature starts from its own context, since those never pass through this handler. Stopping
	// by device cancels the whole owning tree, which is what stopping a camera means to the caller holding
	// only a device id; stopping by operation id cancels exactly that scope and leaves its parent running.
	async stop(target: string | Camera) {
		if (typeof target !== 'string') return await this.coordinator.cancelByResource(resourceKey(target))
		// A camera route must not cancel an unrelated operation that happens to be named in its query.
		if (this.coordinator.get(target)?.kind === 'cameraCapture') await this.coordinator.cancel(target)
	}
}

// Builds camera HTTP routes over coordinated capture operations.
export function camera(cameraHandler: CameraHandler) {
	const { cameraManager } = cameraHandler

	// Resolves the camera named by route params and optional client query.
	function cameraFromParams(req: Bun.BunRequest) {
		return cameraManager.get(query(req).client, req.params.id)!
	}

	return {
		'/cameras': { GET: (req) => response(cameraHandler.list(query(req).client)) },
		'/cameras/:id': { GET: (req) => response(cameraFromParams(req)) },
		'/cameras/:id/cooler': { POST: async (req) => response(cameraManager.cooler(cameraFromParams(req), await req.json())) },
		'/cameras/:id/temperature': { POST: async (req) => response(cameraManager.temperature(cameraFromParams(req), await req.json())) },
		'/cameras/:id/start': {
			POST: async (req) => {
				const handle = cameraHandler.capture(cameraHandler.coordinator, cameraFromParams(req), await req.json())
				return response({ id: handle.id, started: await handle.started })
			},
		},
		'/cameras/:id/stop': { POST: async (req) => response(await cameraHandler.stop(query(req).operation || cameraFromParams(req))) },
	} as const satisfies Endpoints
}
