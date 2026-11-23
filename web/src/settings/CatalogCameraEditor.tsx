import type { CameraModel, CatalogCameraFields } from 'api'
import type { CfaPattern } from 'nebulosa/src/imaging/model/types'
import { useEffect, useMemo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { calibrationLibraryRuntime } from '../calibrationlibrary/calibrationlibrary'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DEFAULT_COLOR_CFA, modelCfa } from '../equipment/cameramodels'
import { CameraModelSearch } from '../equipment/CameraModelSearch'
import { cameraBindingsState, type CatalogCamera, catalogState, deviceFields, removeCatalogCamera, saveCatalogCamera } from '../equipment/catalog'
import { deviceState } from '../equipment/equipment'
import { formatMillimeters, formatPixelSize } from '../format'
import { CFA_PATTERNS } from '../images/display'
import { PanelSection } from '../shell/ContextualPanel'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { Select } from '../ui/Select'
import { StatusBadge } from '../ui/StatusBadge'
import { TextInput } from '../ui/TextInput'

// Editor of one camera of the Equipment Catalog: its name, model, serial number, notes, the sensor it declares, and
// whether it is archived, edited as a local draft that only Save writes. Each field names its own problem, and Save
// stays disabled, saying why, while one remains; a sensor value left blank is not declared. The Model field also searches
// the camera model catalog (AstroBin), and a model chosen there fills the sensor, which can also be copied from a
// connected camera of the active profile's connection; the sensor only warns of a binding to a device whose sensor
// differs. Beside the form, a saved camera shows the devices bound to it, what the Calibration Library records against
// it, and the physical size of the sensor it declares. A camera the Calibration Library records frames or masters
// against cannot be deleted, only archived. Nothing here commands a device.

export interface CatalogCameraEditorProps {
	// Camera edited; absent while a new one is created.
	readonly camera?: CatalogCamera
	// Fields a new camera starts from, such as those copied from a connected camera.
	readonly initial?: CatalogCameraFields
	// Reports whether the draft differs from what was saved.
	readonly onDirtyChange: (dirty: boolean) => void
	// Called with the camera once saved.
	readonly onSaved: (camera: CatalogCamera) => void
	// Called when a new camera is abandoned or a camera is deleted.
	readonly onClosed: () => void
}

// Fields of a camera being edited, as typed. A sensor value left blank is one not declared.
interface Draft {
	readonly name: string
	readonly model: string
	readonly serial: string
	readonly notes: string
	// Unbinned sensor width and height, in pixels, as typed.
	readonly width: string
	readonly height: string
	// Pixel size, in micrometers, as typed.
	readonly pixelSize: string
	// CFA pattern; MONO for a mono sensor.
	readonly cfa: CfaPattern | typeof MONO
	// Bits per sample of the ADC, as typed.
	readonly bits: string
	readonly archived: boolean
}

// Fields of a draft that can hold a problem.
type CheckedField = 'name' | 'width' | 'height' | 'pixelSize' | 'bits'

// Problem of each field of a draft, in words; absent for a field that can be saved.
type Problems = Partial<Record<CheckedField, string>>

// Fields in form order, which is the order their problems are named in.
const CHECKED_FIELDS: readonly CheckedField[] = ['name', 'width', 'height', 'pixelSize', 'bits']

// Fields of the sensor, whose problems depend on each other, so a change of one shows the problems of all.
const SENSOR_FIELDS: readonly (keyof Draft)[] = ['width', 'height', 'pixelSize', 'cfa', 'bits']

// Select value of the option that copies nothing.
const NO_DEVICE = ''

// CFA select value of a mono sensor, which has no pattern.
const MONO = ''

// CFA select options: mono, then every pattern.
const CFA_OPTIONS: readonly (CfaPattern | typeof MONO)[] = [MONO, ...CFA_PATTERNS]

// Largest ADC bit depth a sensor may declare.
const MAX_BITS = 32

// Placeholder of a sensor field left blank.
const UNDECLARED = 'Not declared'

// Returns the text of an optional number of a field: empty when absent.
function numberText(value: number | undefined) {
	return value === undefined ? '' : `${value}`
}

// Returns the number typed in a field, a comma read as the decimal dot: undefined when blank, NaN when it is not one.
function typedNumber(text: string) {
	const trimmed = text.trim().replace(',', '.')
	return trimmed === '' ? undefined : Number(trimmed)
}

// Whether a value typed is absent or a whole number above 0.
function wholePositive(value: number | undefined) {
	return value === undefined || (Number.isInteger(value) && value > 0)
}

// Returns the draft of a camera, or of a new one.
function draftOf(camera: CatalogCameraFields | undefined): Draft {
	return {
		name: camera?.name ?? '',
		model: camera?.model ?? '',
		serial: camera?.serial ?? '',
		notes: camera?.notes ?? '',
		width: numberText(camera?.sensor?.width),
		height: numberText(camera?.sensor?.height),
		pixelSize: numberText(camera?.sensor?.pixelSize),
		cfa: camera?.sensor?.cfa ?? MONO,
		bits: numberText(camera?.sensor?.bits),
		archived: camera?.archived ?? false,
	}
}

// Whether two drafts hold the same text.
function sameDraft(a: Draft, b: Draft) {
	return (Object.keys(a) as (keyof Draft)[]).every((key) => a[key] === b[key])
}

// Returns the problems of the fields of a draft, against the other cameras of the catalog (by name, without regard to
// case); empty when it can be saved. A sensor is declared by its width and height together; the rest needs both.
function problemsOf(draft: Draft, cameras: readonly Pick<CatalogCamera, 'id' | 'name'>[], id: string | undefined): Problems {
	const problems: { -readonly [K in CheckedField]?: string } = {}
	const name = draft.name.trim().toLowerCase()
	if (!name) problems.name = 'Enter a name.'
	else if (cameras.some((camera) => camera.id !== id && camera.name.toLowerCase() === name)) problems.name = 'Another camera of the catalog has this name.'

	const width = typedNumber(draft.width)
	const height = typedNumber(draft.height)
	const pixelSize = typedNumber(draft.pixelSize)
	const bits = typedNumber(draft.bits)
	if (!wholePositive(width)) problems.width = 'A whole number of pixels above 0.'
	else if (width === undefined && height !== undefined) problems.width = 'Enter the width too, or leave both blank.'
	else if (width === undefined && (pixelSize !== undefined || bits !== undefined || draft.cfa !== MONO)) problems.width = 'Enter the width and height to declare the rest of the sensor.'
	if (!wholePositive(height)) problems.height = 'A whole number of pixels above 0.'
	else if (height === undefined && width !== undefined) problems.height = 'Enter the height too, or leave both blank.'
	if (pixelSize !== undefined && !(Number.isFinite(pixelSize) && pixelSize > 0)) problems.pixelSize = 'A size in micrometers above 0.'
	if (bits !== undefined && !(Number.isInteger(bits) && bits > 0 && bits <= MAX_BITS)) problems.bits = `A whole number from 1 to ${MAX_BITS}.`
	return problems
}

// Returns the camera a draft without problems describes.
function fieldsOf(draft: Draft): CatalogCameraFields {
	const width = typedNumber(draft.width)
	const height = typedNumber(draft.height)
	const pixelSize = typedNumber(draft.pixelSize)
	const bits = typedNumber(draft.bits)
	const sensor = width !== undefined && height !== undefined ? { width, height, ...(pixelSize !== undefined && { pixelSize }), ...(draft.cfa !== MONO && { cfa: draft.cfa }), ...(bits !== undefined && { bits }) } : undefined
	return { name: draft.name, model: draft.model, serial: draft.serial, notes: draft.notes, ...(sensor && { sensor }), archived: draft.archived }
}

// Says how many devices are bound to a camera and how many frames and masters the Calibration Library records against
// it, in one line; shared by the list of the catalog and the header of the editor.
export function cameraUsageText(bound: number, frames: number, masters: number) {
	return `${bound === 1 ? '1 device' : `${bound} devices`} bound · ${frames} frames · ${masters} masters`
}

// Returns the confirmation of the deletion of a camera a number of devices are bound to.
function deleteMessage(bound: number) {
	const who = bound === 0 ? 'No device is bound to it.' : bound === 1 ? 'The device bound to it will be bound to no camera.' : `The ${bound} devices bound to it will be bound to no camera.`
	return `${who} This cannot be undone.`
}

// Editor of a camera of the Equipment Catalog.
export function CatalogCameraEditor({ camera, initial, onDirtyChange, onSaved, onClosed }: CatalogCameraEditorProps) {
	const { devices } = useSnapshot(deviceState)
	const control = useSnapshot(controlRuntime)
	const { cameras } = useSnapshot(catalogState)
	const { summary } = useSnapshot(calibrationLibraryRuntime)
	const { bindings } = useSnapshot(cameraBindingsState)
	const [base, setBase] = useState(() => draftOf(camera ?? initial))
	const [draft, setDraft] = useState(base)
	// Whether the camera was just saved, until the next edit.
	const [justSaved, setJustSaved] = useState(false)
	// Whether a model of the AstroBin catalog filled the sensor of this draft, whose CFA pattern then needs a check.
	const [picked, setPicked] = useState(false)
	const dirty = !sameDraft(draft, base)
	const saved = useMemo(() => draftOf(camera), [camera])

	// Follows a camera saved elsewhere while the draft is unchanged, or already has its values.
	if (camera && !sameDraft(saved, base) && (!dirty || sameDraft(draft, saved))) {
		setBase(saved)
		setDraft(saved)
	}

	useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
	// An editor that goes away, such as one whose record another tab deleted, leaves no unsaved changes behind.
	useEffect(() => () => onDirtyChange(false), [onDirtyChange])

	const connected = devices.filter((device) => device.type === 'camera' && device.connected)
	const usage = camera && summary?.cameras.find((entry) => entry.cameraId === camera.id)
	const boundDevices = camera ? Object.values(bindings).filter((binding) => binding.cameraId === camera.id) : []
	const used = (usage?.frames ?? 0) > 0 || (usage?.masters ?? 0) > 0
	const problems = problemsOf(draft, cameras, camera?.id)
	const firstProblem = CHECKED_FIELDS.map((field) => problems[field]).find((problem) => problem !== undefined)
	const sensorChanged = SENSOR_FIELDS.some((field) => draft[field] !== base[field])
	// Problem shown under a field: only once it, or for the sensor any of its fields, differs from the saved text, so an
	// empty new form is not all errors.
	const shown = (field: CheckedField) => ((field === 'name' ? draft.name !== base.name : sensorChanged) ? problems[field] : undefined)
	const saveBlocked = firstProblem ?? (camera && !dirty ? 'No changes to save' : undefined)
	const deleteBlocked = used ? 'Calibration frames or masters are recorded against this camera; archive it instead' : undefined
	// Whether the device of a binding is connected now.
	const isConnected = (deviceId: string) => devices.some((device) => device.id === deviceId && device.connected)

	function edit(patch: Partial<Draft>) {
		setDraft({ ...draft, ...patch })
		setJustSaved(false)
	}

	function copyFrom(id: string) {
		const device = connected.find((entry) => entry.id === id)
		if (!device) return
		const { model, sensor } = deviceFields(device, watchedDeviceState(control, 'camera', device)?.sensor)
		edit({ model: model ?? draft.model, ...(sensor && { width: numberText(sensor.width), height: numberText(sensor.height), pixelSize: numberText(sensor.pixelSize) }) })
	}

	// Fills the model and the sensor from a model of the camera model catalog, and the name of a camera that has none.
	function fillFrom(model: CameraModel) {
		edit({
			name: draft.name.trim() ? draft.name : model.model,
			model: model.model,
			width: numberText(model.width),
			height: numberText(model.height),
			pixelSize: numberText(model.pixelSize),
			bits: numberText(model.bits),
			cfa: modelCfa(model, draft.cfa === MONO ? undefined : draft.cfa) ?? MONO,
		})
		setPicked(true)
	}

	function save() {
		if (saveBlocked) return
		const result = saveCatalogCamera(catalogState, fieldsOf(draft), camera?.id)
		if (!result.ok) return
		const next = draftOf(result.camera)
		setBase(next)
		setDraft(next)
		setPicked(false)
		setJustSaved(true)
		onSaved(result.camera)
	}

	function cancel() {
		setDraft(base)
		setPicked(false)
		if (!camera) onClosed()
	}

	function remove() {
		if (!camera) return
		removeCatalogCamera(catalogState, camera.id)
		onClosed()
	}

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<header className="z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-100 bg-base-100 px-4 py-3 sm:sticky sm:top-0">
				<div className="flex min-w-0 flex-1 basis-60 flex-col">
					<h2 className="m-0 truncate leading-6 font-medium text-ink-100" title={camera?.name}>
						{camera ? camera.name : 'New Camera'}
					</h2>
					{camera && <Notice className="tabular-nums">{cameraUsageText(boundDevices.length, usage?.frames ?? 0, usage?.masters ?? 0)}</Notice>}
				</div>
				{camera?.archived && <StatusBadge tone="muted" label="Archived" title="No longer offered for new bindings and imports" />}
			</header>
			<div className="grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
				<form
					className="flex min-w-0 flex-col lg:col-start-1 lg:row-start-1"
					onSubmit={(e) => {
						e.preventDefault()
						save()
					}}
				>
					<PanelSection title="Identity">
						<div className="flex flex-col gap-1">
							<TextInput label="Name" value={draft.name} placeholder="ASI2600MM #1" onChange={(e) => edit({ name: e.target.value })} />
							{shown('name') && <Notice error>{shown('name')}</Notice>}
						</div>
						<CameraModelSearch label="Model" placeholder="Search AstroBin…" value={draft.model} onValueChange={(model) => edit({ model })} onPick={fillFrom} />
						<TextInput label="Serial Number" value={draft.serial} onChange={(e) => edit({ serial: e.target.value })} />
						<TextInput label="Notes" value={draft.notes} onChange={(e) => edit({ notes: e.target.value })} />
						<Notice>Only the name tells cameras apart; the model, serial number, and notes are never compared.</Notice>
					</PanelSection>
					<PanelSection title="Sensor">
						<Select
							label="Fill From"
							options={[NO_DEVICE, ...connected.map((device) => device.id)]}
							value={NO_DEVICE}
							format={(id) => (id === NO_DEVICE ? (connected.length > 0 ? 'A connected camera…' : 'No camera is connected') : (connected.find((device) => device.id === id)?.name ?? id))}
							disabled={connected.length === 0}
							title={connected.length === 0 ? 'No camera of the connection is connected' : undefined}
							onChange={copyFrom}
						/>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="flex flex-col gap-1">
								<TextInput label="Width" suffix="px" inputMode="numeric" placeholder={UNDECLARED} value={draft.width} onChange={(e) => edit({ width: e.target.value })} />
								{shown('width') && <Notice error>{shown('width')}</Notice>}
							</div>
							<div className="flex flex-col gap-1">
								<TextInput label="Height" suffix="px" inputMode="numeric" placeholder={UNDECLARED} value={draft.height} onChange={(e) => edit({ height: e.target.value })} />
								{shown('height') && <Notice error>{shown('height')}</Notice>}
							</div>
							<div className="flex flex-col gap-1">
								<TextInput label="Pixel Size" suffix="µm" inputMode="decimal" placeholder={UNDECLARED} value={draft.pixelSize} onChange={(e) => edit({ pixelSize: e.target.value })} />
								{shown('pixelSize') && <Notice error>{shown('pixelSize')}</Notice>}
							</div>
							<div className="flex flex-col gap-1">
								<TextInput label="Bit Depth" suffix="bits" inputMode="numeric" placeholder={UNDECLARED} value={draft.bits} onChange={(e) => edit({ bits: e.target.value })} />
								{shown('bits') && <Notice error>{shown('bits')}</Notice>}
							</div>
						</div>
						<div className="flex flex-col gap-1">
							<Select label="CFA Pattern" options={CFA_OPTIONS} value={draft.cfa} format={(cfa) => (cfa === MONO ? 'Mono' : cfa)} onChange={(cfa) => edit({ cfa })} />
							{picked && <Notice warning>AstroBin gives no CFA pattern: a color sensor keeps the one chosen, or {DEFAULT_COLOR_CFA} when it was mono. Check it.</Notice>}
						</div>
						<Notice>Unbinned. Leave a value blank when it is not declared; a bound device that reports another sensor is only warned about.</Notice>
					</PanelSection>
					<PanelSection title="Status">
						<Checkbox label="Archived" checked={draft.archived} onChange={(archived) => edit({ archived })} />
						<Notice>No longer offered for new bindings and imports; the frames, masters, and devices bound to it keep it.</Notice>
					</PanelSection>
					<div className="px-4 py-3">
						<Actions>
							<Button type="submit" disabled={saveBlocked !== undefined} title={saveBlocked}>
								{camera ? 'Save' : 'Add Camera'}
							</Button>
							<Button variant="secondary" disabled={camera !== undefined && !dirty} title={camera !== undefined && !dirty ? 'No changes to cancel' : undefined} onClick={cancel}>
								Cancel
							</Button>
							{justSaved && <Notice>Saved.</Notice>}
						</Actions>
					</div>
				</form>
				{camera && (
					<div className="min-w-0 border-t border-line-100 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-t-0 lg:border-l">
						<PanelSection title="Bound Devices">
							{boundDevices.length === 0 ? (
								<Notice>No device is bound to this camera. Bind one to a camera role in the Equipment Setup.</Notice>
							) : (
								<DataList>
									{boundDevices.map((binding) => (
										<DataRow key={binding.hardwareId} label={binding.deviceName} tone={isConnected(binding.deviceId) ? 'success' : undefined}>
											{isConnected(binding.deviceId) ? 'Connected' : 'Not connected'}
										</DataRow>
									))}
								</DataList>
							)}
						</PanelSection>
						<PanelSection title="Calibration Library">
							<DataList>
								<DataRow label="Frames">{usage?.frames ?? 0}</DataRow>
								<DataRow label="Masters">{usage?.masters ?? 0}</DataRow>
							</DataList>
						</PanelSection>
						<PanelSection title="Declared Sensor">
							<SensorReadout sensor={camera.sensor} />
						</PanelSection>
					</div>
				)}
				{camera && (
					<div className="min-w-0 border-t border-line-100 lg:col-start-1 lg:row-start-2">
						<PanelSection title="Delete">
							<Notice>{used ? 'Calibration frames or masters are recorded against this camera, so it cannot be deleted; archive it instead.' : 'The devices bound to this camera will be bound to none, and the frames captured with it will name no camera.'}</Notice>
							<Actions>
								<ConfirmButton destructive disabled={deleteBlocked !== undefined} tooltip={deleteBlocked} title={`Delete ${camera.name}?`} message={deleteMessage(boundDevices.length)} confirmLabel="Delete Camera" onConfirm={remove}>
									Delete Camera
								</ConfirmButton>
							</Actions>
						</PanelSection>
					</div>
				)}
			</div>
		</div>
	)
}

// Readout of the sensor a saved camera declares: its resolution, and its physical size and diagonal, in millimeters,
// when it declares a pixel size, its color, and its bit depth; or that it declares none.
function SensorReadout({ sensor }: { readonly sensor: CatalogCamera['sensor'] }) {
	if (!sensor) return <Notice>No sensor is declared. A declared sensor completes the field of view where the bound device reports none.</Notice>

	const { width, height, pixelSize, cfa, bits } = sensor
	// Width and height of the sensor, in millimeters, from its pixels and their size in micrometers.
	const physical = pixelSize === undefined ? undefined : { width: (width * pixelSize) / 1000, height: (height * pixelSize) / 1000 }

	return (
		<DataList>
			<DataRow label="Resolution">
				{width} × {height} px · {((width * height) / 1e6).toFixed(1)} MP
			</DataRow>
			{pixelSize !== undefined && <DataRow label="Pixel Size">{formatPixelSize(pixelSize)}</DataRow>}
			{physical && (
				<DataRow label="Size">
					{formatMillimeters(physical.width)} × {formatMillimeters(physical.height)}
				</DataRow>
			)}
			{physical && <DataRow label="Diagonal">{formatMillimeters(Math.hypot(physical.width, physical.height))}</DataRow>}
			<DataRow label="Color">{cfa ? `Color, ${cfa}` : 'Mono'}</DataRow>
			{bits !== undefined && <DataRow label="Bit Depth">{bits} bits</DataRow>}
		</DataList>
	)
}
