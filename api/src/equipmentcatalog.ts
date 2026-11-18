import type { AppDatabase } from './database'
import { errorResponse } from './http'
import type { OperationDevice } from './operations'

// Bindings of the Equipment Catalog: which camera of the catalog (Workspace keeps the cameras) each camera device is.
// A binding belongs to the physical device, keyed by its hardware id (the MD5 of the id of its client, which the endpoint
// gives, and of its driver name), not to a profile, because the wizards, the captures, and the calibrators run on the
// server and only ever know the device; it is edited in the Equipment Setup and holds for every profile. The operations
// name a device by connection and device id (OperationDevice); the device id of a camera, the MD5 of the same client id
// and name with its type, determines its hardware id, so the device id finds the binding, even while its connection is
// closed. Every frame resolves its camera once, when it is taken, so binding a device again never changes what was
// already recorded. The bindings are kept in the operational database and in memory, so resolving the camera of a frame
// is a lookup. A camera of the catalog is bound to one device at most, as one camera cannot be two devices: binding it to
// a device unbinds the device it was bound to (an endpoint that changed, or another device of the connection). The last
// write wins.

// Error codes of the binding routes.
export type EquipmentCatalogErrorCode = 'notFound'

// Binding of a camera device to a camera of the Equipment Catalog.
export interface CameraBinding {
	// Id of the physical device, which keys the binding.
	readonly hardwareId: string
	// Id of the open connection that provided the device when it was bound (the MD5 of its endpoint).
	readonly connectionId: string
	// Exact id of its camera interface, which determines hardwareId.
	readonly deviceId: string
	// Name its driver reported when it was bound, which suggests a camera again when its endpoint changes.
	readonly deviceName: string
	// Camera of the catalog the device is.
	readonly cameraId: string
	// When it was bound, Unix milliseconds (UTC).
	readonly boundAt: number
}

// Snapshot of the bindings: GET /api/equipment-catalog/bindings.
export interface CameraBindingsSnapshot {
	// Every binding, ordered by hardware id.
	readonly bindings: readonly CameraBinding[]
}

// Body of PUT /api/equipment-catalog/bindings: binds a camera device to a camera of the catalog, or unbinds it.
export interface CameraBindingRequest {
	// Id of the open connection that provides the device.
	readonly connectionId: string
	// Exact id of the device.
	readonly deviceId: string
	// Camera of the catalog the device is; null unbinds it.
	readonly cameraId: string | null
}

// Event of the bindings: a device was bound, bound again, or unbound (binding absent).
export interface CameraBindingEvent {
	readonly type: 'catalogCamera:bindingChanged'
	// Hardware id of the device whose binding changed.
	readonly hardwareId: string
	// Its binding now; absent when it has none.
	readonly binding?: CameraBinding
}

// What a binding needs of a camera device: the identity of its hardware and the name its driver reports.
export interface BoundDevice {
	readonly hardwareId: string
	readonly name: string
}

// Resolves the camera of the Equipment Catalog a device is bound to, for the services that record or calibrate frames.
export interface CameraBindings {
	// Returns the id of the camera of the catalog a device is bound to, or undefined when it is bound to none.
	readonly cameraOf: (device: OperationDevice) => string | undefined
}

// Resolver of a device bound to no camera, for tests and services composed without a catalog.
export const NO_CAMERA_BINDINGS: CameraBindings = { cameraOf: () => undefined }

// Row of equipment_camera_bindings.
interface BindingRow {
	readonly hardware_id: string
	readonly connection_id: string
	readonly device_id: string
	readonly device_name: string
	readonly camera_id: string
	readonly bound_at: number
}

// Returns the binding of a row.
function rowBinding(row: BindingRow): CameraBinding {
	return { hardwareId: row.hardware_id, connectionId: row.connection_id, deviceId: row.device_id, deviceName: row.device_name, cameraId: row.camera_id, boundAt: row.bound_at }
}

// Outcome of a change of a binding: done, or refused because the camera device or the camera of the catalog is unknown.
export type CameraBindingOutcome = { readonly status: 'saved'; readonly binding?: CameraBinding } | { readonly status: 'notFound'; readonly what: 'device' | 'camera' }

// Bindings of the camera devices to the cameras of the Equipment Catalog.
export class EquipmentCatalog implements CameraBindings {
	// Every binding, by hardware id, read on first use.
	#bindings?: Map<string, CameraBinding>

	// Creates the bindings of database. device resolves a camera device of an open connection, or undefined when it is
	// not one; listener receives every committed change.
	constructor(
		readonly database: AppDatabase,
		readonly device: (device: OperationDevice) => BoundDevice | undefined,
		readonly listener: (event: CameraBindingEvent) => void = () => undefined,
	) {}

	// Returns the bindings, reading them from the database on first use.
	#load() {
		this.#bindings ??= new Map(
			this.database.db
				.query<BindingRow, []>('SELECT hardware_id, connection_id, device_id, device_name, camera_id, bound_at FROM equipment_camera_bindings')
				.all()
				.map((row) => [row.hardware_id, rowBinding(row)]),
		)
		return this.#bindings
	}

	// Returns every binding, ordered by hardware id.
	snapshot(): CameraBindingsSnapshot {
		return { bindings: [...this.#load().values()].sort((a, b) => a.hardwareId.localeCompare(b.hardwareId)) }
	}

	// Returns the binding of a camera device, found by its device id, which determines its hardware id; or undefined.
	binding({ deviceId }: OperationDevice): CameraBinding | undefined {
		for (const binding of this.#load().values()) if (binding.deviceId === deviceId) return binding
		return undefined
	}

	// Returns the camera of the catalog a device is bound to, or undefined.
	cameraOf(device: OperationDevice): string | undefined {
		return this.binding(device)?.cameraId
	}

	// Binds a camera device of an open connection to a camera of the catalog, replacing the binding of its hardware and
	// unbinding the device the camera was bound to, or unbinds it when cameraId is null. Publishes each device whose
	// binding changed. notFound when the device is not a camera of an open connection, or the camera is not in the catalog.
	bind({ connectionId, deviceId, cameraId }: CameraBindingRequest, now: number = Date.now()): CameraBindingOutcome {
		const bindings = this.#load()

		if (cameraId === null) {
			const bound = this.binding({ connectionId, deviceId })
			if (!bound) return { status: 'saved' }
			this.database.db.query('DELETE FROM equipment_camera_bindings WHERE hardware_id = ?').run(bound.hardwareId)
			bindings.delete(bound.hardwareId)
			this.listener({ type: 'catalogCamera:bindingChanged', hardwareId: bound.hardwareId })
			return { status: 'saved' }
		}

		const device = this.device({ connectionId, deviceId })
		if (!device) return { status: 'notFound', what: 'device' }
		if (!this.database.db.query('SELECT 1 FROM equipment_cameras WHERE camera_id = ?').get(cameraId)) return { status: 'notFound', what: 'camera' }

		const { hardwareId } = device
		const binding: CameraBinding = { hardwareId, connectionId, deviceId, deviceName: device.name, cameraId, boundAt: now }
		const previous = [...bindings.values()].filter((entry) => entry.hardwareId !== hardwareId && entry.cameraId === cameraId)
		this.database.write(() => {
			this.database.db.query('DELETE FROM equipment_camera_bindings WHERE camera_id = ? AND hardware_id <> ?').run(cameraId, hardwareId)
			this.database.db
				.query(
					'INSERT INTO equipment_camera_bindings (hardware_id, connection_id, device_id, device_name, camera_id, bound_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (hardware_id) DO UPDATE SET connection_id = excluded.connection_id, device_id = excluded.device_id, device_name = excluded.device_name, camera_id = excluded.camera_id, bound_at = excluded.bound_at',
				)
				.run(hardwareId, connectionId, deviceId, device.name, cameraId, now)
		})

		for (const entry of previous) {
			bindings.delete(entry.hardwareId)
			this.listener({ type: 'catalogCamera:bindingChanged', hardwareId: entry.hardwareId })
		}

		bindings.set(hardwareId, binding)
		this.listener({ type: 'catalogCamera:bindingChanged', hardwareId, binding })
		return { status: 'saved', binding }
	}

	// Forgets the bindings of a camera of the catalog that was deleted, whose rows the database already removed with it,
	// and publishes each device as unbound.
	cameraRemoved(cameraId: string) {
		const bindings = this.#load()

		for (const [hardwareId, binding] of bindings) {
			if (binding.cameraId !== cameraId) continue
			bindings.delete(hardwareId)
			this.listener({ type: 'catalogCamera:bindingChanged', hardwareId })
		}
	}
}

// Creates the routes of the bindings under /api/equipment-catalog.
export function createEquipmentCatalogRoutes(catalog: EquipmentCatalog) {
	return {
		'/api/equipment-catalog/bindings': {
			// Every binding (CameraBindingsSnapshot).
			GET: () => Response.json(catalog.snapshot()),
			// Binds or unbinds a camera device (CameraBindingRequest); 200 with { binding } (absent once unbound), 404 when the
			// device is not a camera of an open connection or the camera is not in the catalog.
			PUT: async (req) => {
				const outcome = catalog.bind((await req.json()) as CameraBindingRequest)
				if (outcome.status === 'notFound') return errorResponse(outcome.what === 'device' ? 'Camera not found on an open connection' : 'Camera of the catalog not found', 404, 'notFound')
				return Response.json({ binding: outcome.binding })
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
