import type { CatalogCameraFields } from 'api'
import { useEffect, useMemo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { calibrationLibraryRuntime } from '../calibrationlibrary/calibrationlibrary'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { cameraBindingsState, type CatalogCamera, catalogState, deviceFields, removeCatalogCamera, saveCatalogCamera } from '../equipment/catalog'
import { deviceState } from '../equipment/equipment'
import { PanelSection } from '../shell/ContextualPanel'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
import { Notice } from '../ui/Notice'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'

// Editor of one camera of the Equipment Catalog: its name, model, serial number, notes, the sensor it declares, and
// whether it is archived, edited as a local draft that only Save writes. The sensor can be copied from a connected camera
// of the active profile's connection, and only warns of a binding to a device whose sensor differs. A camera the
// Calibration Library records frames or masters against cannot be deleted, only archived. Nothing here commands a
// device.

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

// Text of the fields of a camera being edited.
interface Draft {
	readonly name: string
	readonly model: string
	readonly serial: string
	readonly notes: string
	readonly width: string
	readonly height: string
	readonly pixelSize: string
	readonly cfa: string
	readonly bits: string
	readonly archived: boolean
}

// Select value of the option that copies nothing.
const NO_DEVICE = ''

// Returns the draft of a camera, or of a new one.
function draftOf(camera: CatalogCameraFields | undefined): Draft {
	const text = (value: number | string | undefined) => (value === undefined ? '' : `${value}`)
	return {
		name: camera?.name ?? '',
		model: camera?.model ?? '',
		serial: camera?.serial ?? '',
		notes: camera?.notes ?? '',
		width: text(camera?.sensor?.width),
		height: text(camera?.sensor?.height),
		pixelSize: text(camera?.sensor?.pixelSize),
		cfa: camera?.sensor?.cfa ?? '',
		bits: text(camera?.sensor?.bits),
		archived: camera?.archived ?? false,
	}
}

// Whether two drafts hold the same text.
function sameDraft(a: Draft, b: Draft) {
	return (Object.keys(a) as (keyof Draft)[]).every((key) => a[key] === b[key])
}

// Returns the camera a draft describes. A sensor is declared once its width or height is typed; a number that cannot be
// read stays NaN, which the save refuses.
function fieldsOf(draft: Draft): CatalogCameraFields {
	const number = (text: string) => (text.trim() === '' ? undefined : +text)
	const declared = draft.width.trim() !== '' || draft.height.trim() !== ''
	const pixelSize = number(draft.pixelSize)
	const bits = number(draft.bits)
	const sensor = declared ? { width: +draft.width, height: +draft.height, ...(pixelSize !== undefined && { pixelSize }), ...(draft.cfa.trim() && { cfa: draft.cfa }), ...(bits !== undefined && { bits }) } : undefined
	return { name: draft.name, model: draft.model, serial: draft.serial, notes: draft.notes, ...(sensor && { sensor }), archived: draft.archived }
}

// Editor of a camera of the Equipment Catalog.
export function CatalogCameraEditor({ camera, initial, onDirtyChange, onSaved, onClosed }: CatalogCameraEditorProps) {
	const { devices } = useSnapshot(deviceState)
	const control = useSnapshot(controlRuntime)
	const { summary } = useSnapshot(calibrationLibraryRuntime)
	const { bindings } = useSnapshot(cameraBindingsState)
	const [base, setBase] = useState(() => draftOf(camera ?? initial))
	const [draft, setDraft] = useState(base)
	const [error, setError] = useState<string>()
	const dirty = !sameDraft(draft, base)
	const saved = useMemo(() => draftOf(camera), [camera])

	// Follows a camera saved elsewhere while the draft is unchanged, or already has its values.
	if (camera && !sameDraft(saved, base) && (!dirty || sameDraft(draft, saved))) {
		setBase(saved)
		setDraft(saved)
	}

	useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

	const connected = devices.filter((device) => device.type === 'camera' && device.connected)
	const usage = camera && summary?.cameras.find((entry) => entry.cameraId === camera.id)
	const bound = camera ? Object.values(bindings).filter((binding) => binding.cameraId === camera.id).length : 0
	const used = (usage?.frames ?? 0) > 0 || (usage?.masters ?? 0) > 0

	function edit(patch: Partial<Draft>) {
		setDraft({ ...draft, ...patch })
		setError(undefined)
	}

	function copyFrom(id: string) {
		const device = connected.find((entry) => entry.id === id)
		if (!device) return
		const fields = deviceFields(device, watchedDeviceState(control, 'camera', device)?.sensor)
		const copied = draftOf({ ...fieldsOf(draft), ...fields })
		edit({ model: copied.model, width: copied.width, height: copied.height, pixelSize: copied.pixelSize })
	}

	function save() {
		const result = saveCatalogCamera(catalogState, fieldsOf(draft), camera?.id)

		if (!result.ok) {
			setError(result.reason === 'name' ? 'Enter a name.' : result.reason === 'nameTaken' ? 'Another camera of the catalog has this name.' : 'Enter a whole positive width and height in pixels, a positive pixel size, and between 1 and 32 bits, or leave the sensor empty.')
			return
		}

		const next = draftOf(result.camera)
		setBase(next)
		setDraft(next)
		onSaved(result.camera)
	}

	function cancel() {
		setDraft(base)
		setError(undefined)
		if (!camera) onClosed()
	}

	function remove() {
		if (!camera) return
		removeCatalogCamera(catalogState, camera.id)
		onClosed()
	}

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-100 px-4 py-3">
				<div className="flex min-w-0 flex-1 basis-60 flex-col">
					<h2 className="m-0 truncate text-md leading-6 font-medium text-ink-100">{camera ? camera.name : 'New Camera'}</h2>
					{camera && (
						<Notice>
							{bound === 0 ? 'No device is bound to this camera.' : bound === 1 ? 'One device is bound to this camera.' : `${bound} devices are bound to this camera.`}{' '}
							{usage ? `The Calibration Library records ${usage.frames} frames and ${usage.masters} masters against it.` : 'The Calibration Library records nothing against it.'}
						</Notice>
					)}
				</div>
			</header>
			<div className="flex min-w-0 flex-col lg:w-112">
				<PanelSection title="Camera">
					<form
						className="flex flex-col gap-3"
						onSubmit={(e) => {
							e.preventDefault()
							save()
						}}
					>
						<TextInput label="Name" value={draft.name} placeholder="ASI2600MM #1" onChange={(e) => edit({ name: e.target.value })} />
						<TextInput label="Model" value={draft.model} placeholder="ZWO ASI2600MM Pro" onChange={(e) => edit({ model: e.target.value })} />
						<TextInput label="Serial Number" spellCheck={false} autoComplete="off" value={draft.serial} onChange={(e) => edit({ serial: e.target.value })} />
						<TextInput label="Notes" value={draft.notes} onChange={(e) => edit({ notes: e.target.value })} />
						<Notice>The name tells cameras apart in every list; the model, serial number, and notes are for people only and never compared.</Notice>
						{connected.length > 0 && <Select label="Fill From" options={[NO_DEVICE, ...connected.map((device) => device.id)]} value={NO_DEVICE} format={(id) => (id === NO_DEVICE ? 'A connected camera…' : (connected.find((device) => device.id === id)?.name ?? id))} onChange={copyFrom} />}
						<div className="grid grid-cols-2 gap-3">
							<TextInput label="Sensor Width" suffix="px" inputMode="numeric" value={draft.width} onChange={(e) => edit({ width: e.target.value })} />
							<TextInput label="Sensor Height" suffix="px" inputMode="numeric" value={draft.height} onChange={(e) => edit({ height: e.target.value })} />
							<TextInput label="Pixel Size" suffix="µm" inputMode="decimal" value={draft.pixelSize} onChange={(e) => edit({ pixelSize: e.target.value })} />
							<TextInput label="Bits" inputMode="numeric" value={draft.bits} onChange={(e) => edit({ bits: e.target.value })} />
						</div>
						<TextInput label="CFA Pattern" spellCheck={false} autoComplete="off" value={draft.cfa} placeholder="Empty for a mono sensor" onChange={(e) => edit({ cfa: e.target.value })} />
						<Notice>The unbinned sensor, optional. It only warns when a device bound to this camera reports another one.</Notice>
						<Checkbox label="Archived" checked={draft.archived} onChange={(archived) => edit({ archived })} />
						<Notice>An archived camera is no longer offered for new bindings and imports; the frames, masters, and devices bound to it keep it.</Notice>
						{error && <Notice error>{error}</Notice>}
						<Actions>
							<Button type="submit" disabled={camera !== undefined && !dirty}>
								{camera ? 'Save' : 'Add Camera'}
							</Button>
							<Button variant="secondary" disabled={camera !== undefined && !dirty} onClick={cancel}>
								Cancel
							</Button>
						</Actions>
					</form>
				</PanelSection>
				{camera && (
					<PanelSection title="Delete">
						<Notice>{used ? 'Calibration frames or masters are recorded against this camera, so it cannot be deleted; archive it instead.' : 'The devices bound to this camera will be bound to none, and the frames captured with it will name no camera.'}</Notice>
						<Actions>
							<ConfirmButton disabled={used} title={`Delete ${camera.name}?`} message="Its bindings are removed. This cannot be undone." confirmLabel="Delete Camera" onConfirm={remove}>
								Delete Camera
							</ConfirmButton>
						</Actions>
					</PanelSection>
				)}
			</div>
		</div>
	)
}
