import type { DeviceSummary } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { bindCamera, boundCameraId, cameraBindingsState, cameraBoundElsewhere, catalogCameraName, catalogState, createCatalogCamera, deviceFields, sensorMismatch, suggestedCameraId } from './catalog'
import { deviceState } from './equipment'

// Line of a camera role of the Equipment Setup that binds its device to a camera of the Equipment Catalog: the camera
// frames of the device are recorded against, which the Dark Library Wizard and the Flat Wizard need to start and the
// calibrators to choose masters. The binding belongs to the physical device, so it holds for every profile. A device whose
// endpoint changed (a new host or port) is unbound, and the camera bound to a device of the same driver name is suggested.
// A camera of the catalog is bound to one device at most: like a device that already fills another role, a camera another
// device of the connection is bound to cannot be chosen, and binding one a device of an old endpoint holds moves it. New
// Camera creates a camera of the catalog from the device, which Settings → Equipment Catalog renames; the edit button
// beside the select closes the Equipment Setup and shows the bound camera there. Binding never commands the device. While
// the device is not on an open connection (its server is not connected, or it is missing from it), the line shows the
// camera the device id the setup keeps is bound to with the select disabled, since only a device of an open connection
// can be bound.

// Select value of the option that unbinds the device.
const UNBOUND = ''

// Select value of the option that creates a camera of the catalog from the device and binds it.
const NEW_CAMERA = '\u0000new'

export interface CatalogBindingProps {
	// Id of the camera device the role is assigned to.
	readonly deviceId: string
	// Camera device of the role while it is present on an open connection; absent shows the binding read-only.
	readonly device?: DeviceSummary
}

// Returns a name for a new camera of the catalog from a device name, numbered when the catalog already has it.
function newCameraName(name: string, taken: readonly string[]) {
	const names = new Set(taken.map((entry) => entry.toLowerCase()))
	if (!names.has(name.toLowerCase())) return name
	for (let number = 2; ; number++) if (!names.has(`${name} #${number}`.toLowerCase())) return `${name} #${number}`
}

// Camera of the catalog a camera device is bound to, with a select that binds it to another one or to none.
export function CatalogBinding({ deviceId, device }: CatalogBindingProps) {
	const { cameras } = useSnapshot(catalogState)
	const bindings = useSnapshot(cameraBindingsState)
	const control = useSnapshot(controlRuntime)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string>()
	const bound = boundCameraId(bindings, deviceId)
	const camera = cameras.find((entry) => entry.id === bound)
	// New Camera needs the device on an open connection.
	const options = [UNBOUND, ...cameras.filter((entry) => !entry.archived || entry.id === bound).map((entry) => entry.id), ...(device ? [NEW_CAMERA] : [])]
	const named = device && bound === undefined ? suggestedCameraId(bindings, cameras, device.name) : undefined
	const suggestion = device && named !== undefined && !cameraBoundElsewhere(bindings, device, named) ? named : undefined
	const sensor = device && watchedDeviceState(control, 'camera', device)?.sensor
	const mismatch = sensorMismatch(camera, sensor)

	async function bind(cameraId: string | undefined) {
		if (!device) return
		setBusy(true)
		setError(await bindCamera(cameraBindingsState, device, cameraId))
		setBusy(false)
	}

	// Creates a camera of the catalog named after the device, with the model and sensor it reports, and binds the device to it.
	async function bindNew() {
		if (!device) return
		setBusy(true)
		const created = await createCatalogCamera({
			name: newCameraName(
				device.name,
				catalogState.cameras.map((entry) => entry.name),
			),
			...deviceFields(device, sensor),
			archived: false,
		})
		setBusy(false)
		if ('error' in created) setError(created.error)
		else await bind(created.camera.id)
	}

	function change(value: string) {
		if (value === NEW_CAMERA) void bindNew()
		else void bind(value === UNBOUND ? undefined : value)
	}

	// Closes the Equipment Setup and shows the bound camera in Settings → Equipment Catalog.
	function editCamera() {
		if (!camera) return
		deviceState.open = false
		navigate(routeState, { workspace: 'settings', section: 'equipment-catalog', catalog: 'cameras', item: camera.id })
	}

	function format(value: string) {
		if (value === UNBOUND) return 'Not bound'
		if (value === NEW_CAMERA) return 'New Camera…'
		return catalogCameraName(cameras, value)
	}

	// Reason an option cannot be chosen: another device of the connection is bound to the camera.
	function disabledReason(value: string) {
		if (!device || value === UNBOUND || value === NEW_CAMERA || value === bound) return undefined
		const other = cameraBoundElsewhere(bindings, device, value)
		return other && `Bound to ${other.deviceName}`
	}

	const hint =
		error ??
		mismatch ??
		(!device
			? 'Only a device of a connected server can be bound. The binding belongs to the device and holds for every profile.'
			: bound === undefined
				? 'Bind it to calibrate: the wizards and the Calibration Library record frames against a camera of the catalog. The binding holds for every profile.'
				: 'The binding belongs to this device and holds for every profile.')

	return (
		<div className="col-start-2 -col-end-1 flex flex-col gap-1">
			<div className="flex flex-wrap items-end gap-2">
				<Select label="Catalog Camera" className="min-w-48 flex-1" options={options} value={bound ?? UNBOUND} format={format} onChange={change} disabledReason={disabledReason} disabled={busy || !device} />
				<IconButton icon="edit" label={camera ? `Edit ${camera.name} in the Equipment Catalog` : 'Bind a camera of the catalog to edit it'} disabled={!camera} onClick={editCamera} />
				{suggestion && (
					<Button variant="secondary" disabled={busy} onClick={() => void bind(suggestion)}>
						Use {catalogCameraName(cameras, suggestion)}
					</Button>
				)}
			</div>
			<p className={`m-0 text-xs leading-4 ${error ? 'text-danger' : mismatch ? 'text-warning' : 'text-ink-300'}`}>{hint}</p>
		</div>
	)
}
