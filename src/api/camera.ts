import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import { CLIENT } from 'nebulosa/src/devices/indi/device'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import type { CameraManager, DeviceHandler, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import type { BlobEncoding, PropertyState } from 'nebulosa/src/devices/indi/types'
import { EventBus } from 'src/shared/bus'
import type { CameraFrameEvent, CameraCaptureEvent, CameraCaptureStart, CameraAdded, CameraRemoved, CameraUpdated } from '#/camera'
import type { CameraCaptureHandle } from './camera.capture'
import { CameraCapturer } from './camera.capture'
import { query, response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'

export interface CameraBusEvents {
	readonly add: CameraAdded
	readonly update: CameraUpdated
	readonly remove: CameraRemoved
	readonly frame: CameraFrameEvent
	readonly capture: CameraCaptureEvent
}

export const cameraBus = new EventBus<CameraBusEvents>()

// Publishes camera transport events and delegates capture ownership to CameraCapturer.
export class CameraHandler implements DeviceHandler<Camera> {
	private readonly captures = new Map<string, CameraCaptureHandle>()
	private readonly capturesByCamera = new Map<string, CameraCaptureHandle>()

	// Registers the camera transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraManager: CameraManager,
		readonly mountManager: MountManager,
		readonly wheelManager: WheelManager,
		readonly focuserManager: FocuserManager,
		readonly rotatorManager: RotatorManager,
		readonly capturer: CameraCapturer,
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
			cameraBus.emit('capture', structuredClone(event))
		}
	}

	// Starts a coordinated capture and returns its operation-backed milestones.
	capture(camera: Camera, request: CameraCaptureStart, onCameraCaptureEvent?: (event: CameraCaptureEvent, path?: string) => void) {
		const client = camera[CLIENT]!
		const mount = request.mount ? this.mountManager.get(client, request.mount) : undefined
		const wheel = request.wheel ? this.wheelManager.get(client, request.wheel) : undefined
		const focuser = request.focuser ? this.focuserManager.get(client, request.focuser) : undefined
		const rotator = request.rotator ? this.rotatorManager.get(client, request.rotator) : undefined

		const handle = this.capturer.start(
			camera,
			request,
			(event, path) => {
				this.sendEvent(event, path)
				onCameraCaptureEvent?.(event, path)
			},
			() => this.cameraManager.snoop(camera, mount, focuser, wheel, rotator),
			onCameraCaptureEvent,
		)

		this.captures.set(handle.id, handle)
		if (!this.capturesByCamera.has(camera.id)) this.capturesByCamera.set(camera.id, handle)

		const releaseHandle = () => {
			if (this.captures.get(handle.id) === handle) this.captures.delete(handle.id)
			if (this.capturesByCamera.get(camera.id) === handle) this.capturesByCamera.delete(camera.id)
		}

		void handle.result.then(releaseHandle, releaseHandle)

		return handle
	}

	// Transitional feature entrypoint that maps the coordinated result to the legacy boolean.
	start(camera: Camera, req: CameraCaptureStart, onCameraCaptureEvent?: (event: CameraCaptureEvent, path?: string) => void) {
		return this.capture(camera, req, onCameraCaptureEvent).result.then((result) => result.ok)
	}

	// Cancels one operation id, or the current camera capture for feature adapters pending Phase 5.
	async stop(target: string | Camera) {
		const handle = typeof target === 'string' ? this.captures.get(target) : this.capturesByCamera.get(target.id)
		await handle?.cancel()
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
				const handle = cameraHandler.capture(cameraFromParams(req), await req.json())
				return response({ id: handle.id, started: await handle.started })
			},
		},
		'/cameras/:id/stop': { POST: async (req) => response(await cameraHandler.stop(query(req).operation || cameraFromParams(req))) },
	} as const satisfies Endpoints
}
