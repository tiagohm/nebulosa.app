import type { FramingCamera, FramingDocument, FramingOpticsSource, FramingSetupOptics, FramingTelescope } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { CameraModelSearch } from '../../equipment/CameraModelSearch'
import { catalogState } from '../../equipment/catalog'
import { EquipmentSetupButton } from '../../equipment/EquipmentSetupButton'
import { CAMERA_ROLES, type CameraRole, roleDefinition } from '../../equipment/roles'
import { TelescopeModelSearch } from '../../equipment/TelescopeModelSearch'
import { formatPixelSize, MISSING } from '../../format'
import { copyName, deleteFraming, discardFramingDraft, duplicateFraming, editFraming, framingSaveStatus, framingsState, overwriteFraming } from '../../framing/framings'
import { FieldRows, SensorInputs, TelescopeInputs } from '../../framing/OpticsFields'
import { EQUIPMENT_FRAMING_ID, type ResolvedFraming } from '../../framing/resolve'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import type { RoleSensor } from '../../sky/sensors'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { StatusBadge, type StatusTone } from '../../ui/StatusBadge'
import { TextInput } from '../../ui/TextInput'
import { showFraming } from './framing'

// Editor of a framing, the contextual panel of the Framing tool: its name, where its telescope and camera come from (the
// Equipment Setup of the active profile, an item of the Equipment Catalog, a model of the AstroBin equipment database, or
// typed by hand), their values, the field of view they give, and the rotation of the sensor. Every edit becomes a draft
// written a moment later (framings.ts); changing a source keeps the values shown as the copy the framing falls back to.
// The Equipment Setup's pseudo-framing is shown, never edited.

// Sources of a telescope or camera in menu order.
const SOURCES: readonly FramingOpticsSource[] = ['setup', 'catalog', 'model', 'manual']

// Optics of the Equipment Setup in menu order.
const SETUP_OPTICS: readonly FramingSetupOptics[] = ['telescope', 'guideTelescope']

// Display name of a source.
function sourceName(source: FramingOpticsSource) {
	return source === 'setup' ? 'Equipment Setup' : source === 'catalog' ? 'Equipment Catalog' : source === 'model' ? 'AstroBin model' : 'Entered by hand'
}

// Label and tone of each save status.
const SAVE_STATUS: Readonly<Record<ReturnType<typeof framingSaveStatus>, { readonly label: string; readonly tone: StatusTone }>> = {
	saved: { label: 'Saved', tone: 'success' },
	saving: { label: 'Saving', tone: 'neutral' },
	conflict: { label: 'Conflict', tone: 'warning' },
	failed: { label: 'Not saved', tone: 'danger' },
}

// Says where the sensor of a camera role comes from: its report at full frame, the sensor the Equipment Catalog declares
// for the camera it is bound to, or the report completed with declared values.
function sensorOriginText({ origin, catalogCamera }: Pick<RoleSensor, 'origin' | 'catalogCamera'>, device: string) {
	if (origin === 'catalog') return `Declared for ${catalogCamera} in the Equipment Catalog; the ${device} has not reported its sensor.`
	if (origin === 'completed') return `Reported by the ${device} device, completed with what the Equipment Catalog declares for ${catalogCamera}.`
	return `Reported by the ${device} device at full frame.`
}

// Props of the editor.
export interface FramingEditorProps {
	// Framing edited, resolved for the tab.
	readonly framing: ResolvedFraming
	// Whether the inputs are locked, while a survey cutout downloads.
	readonly locked: boolean
}

// Editor of a framing.
export function FramingEditor({ framing, locked }: FramingEditorProps) {
	const state = useSnapshot(framingsState)

	if (framing.id === EQUIPMENT_FRAMING_ID) return <EquipmentFraming framing={framing} />

	const document = state.drafts[framing.id]?.document ?? state.framings[framing.id]
	if (!document) return null

	// Writes a change of the document.
	function change(next: (document: FramingDocument) => FramingDocument) {
		editFraming(framingsState, framing.id, next)
	}

	return (
		<>
			<NameSection id={framing.id} name={document.name} locked={locked} />
			<TelescopeSection telescope={document.optics.telescope} resolved={framing} locked={locked} onChange={(telescope) => change((d) => ({ ...d, optics: { ...d.optics, telescope } }))} />
			<CameraSection camera={document.optics.camera} resolved={framing} locked={locked} onChange={(camera) => change((d) => ({ ...d, optics: { ...d.optics, camera } }))} />
			<FieldSection framing={framing} locked={locked} onRotate={(rotation) => change((d) => ({ ...d, rotation }))} />
		</>
	)
}

// Pseudo-framing of the Equipment Setup, shown with its field and never edited.
function EquipmentFraming({ framing }: { readonly framing: ResolvedFraming }) {
	return (
		<>
			<CollapsibleSection id="framing.equipment" title="Equipment Setup">
				<Notice>Follows the Main Camera and the Telescope of the active profile&apos;s Equipment Setup, without rotation; it is what every tool uses until another framing is chosen. Change them in the Equipment Setup, or create a framing to plan with other optics.</Notice>
				<DataRow label="Telescope">{framing.telescope.label}</DataRow>
				<DataRow label="Camera">{framing.camera.label}</DataRow>
				<EquipmentSetupButton />
			</CollapsibleSection>
			<CollapsibleSection id="framing.field" title="Field">
				<FieldRows field={framing.field} missingCamera={framing.camera.missingCamera && `${roleDefinition(framing.camera.missingCamera).label} sensor`} />
			</CollapsibleSection>
		</>
	)
}

// Name, save status, conflict, duplicate, and delete of a framing.
function NameSection({ id, name, locked }: { readonly id: string; readonly name: string; readonly locked: boolean }) {
	const state = useSnapshot(framingsState)
	const [text, setText] = useState(name)
	const [error, setError] = useState<string>()
	const status = SAVE_STATUS[framingSaveStatus(state, id)]
	const conflict = id in state.conflicts

	// Follows a name changed elsewhere, such as by another tab.
	useEffect(() => setText(name), [name])

	// Writes the name typed, unless it is blank or unchanged.
	function commit() {
		const trimmed = text.trim()
		if (!trimmed) setText(name)
		else if (trimmed !== name) editFraming(framingsState, id, (document) => ({ ...document, name: trimmed }))
	}

	async function duplicate() {
		setError(undefined)

		try {
			showFraming(await duplicateFraming(framingsState, id, copyName(framingsState, name)))
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		}
	}

	async function remove() {
		setError(undefined)

		try {
			await deleteFraming(framingsState, id)
			if (!framingsState.framings[id]) showFraming(EQUIPMENT_FRAMING_ID)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		}
	}

	return (
		<CollapsibleSection id="framing.name" title="Framing" summary={name}>
			<form
				onSubmit={(event) => {
					event.preventDefault()
					commit()
				}}
			>
				<TextInput label="Name" value={text} disabled={locked} onChange={(event) => setText(event.target.value)} onBlur={commit} />
			</form>
			<div>
				<StatusBadge tone={status.tone} label={status.label} title={state.errors[id]} />
			</div>
			{state.errors[id] && <Notice error>{state.errors[id]}</Notice>}
			{conflict && (
				<>
					<Notice>Another tab changed this framing{state.conflicts[id] ? '' : ' and deleted it'} while it was being edited here.</Notice>
					<Actions>
						<Button variant="secondary" onClick={() => discardFramingDraft(framingsState, id)}>
							Keep Theirs
						</Button>
						<Button variant="secondary" onClick={() => void overwriteFraming(framingsState, id)}>
							Save Mine
						</Button>
					</Actions>
				</>
			)}
			{error && <Notice error>{error}</Notice>}
			<Actions>
				<Button variant="secondary" disabled={locked} onClick={() => void duplicate()}>
					Duplicate
				</Button>
				<ConfirmButton
					disabled={locked}
					destructive
					title="Delete framing?"
					message={
						<>
							Delete <strong className="text-ink-100">{name}</strong>? Every profile and tool that chose it falls back to the Equipment Setup, and this cannot be undone.
						</>
					}
					confirmLabel="Delete Framing"
					onConfirm={() => void remove()}
				>
					Delete
				</ConfirmButton>
			</Actions>
		</CollapsibleSection>
	)
}

// Props of the telescope section.
interface TelescopeSectionProps {
	// Telescope of the framing, as saved.
	readonly telescope: FramingTelescope
	// Framing resolved for the tab, with the values shown.
	readonly resolved: ResolvedFraming
	// Whether the inputs are locked.
	readonly locked: boolean
	// Writes a change of the telescope.
	readonly onChange: (telescope: FramingTelescope) => void
}

// Source and values of the telescope of a framing.
function TelescopeSection({ telescope, resolved, locked, onChange }: TelescopeSectionProps) {
	const { telescopes } = useSnapshot(catalogState)
	const offered = telescopes.filter((e) => !e.archived || e.id === telescope.telescopeId)
	const item = telescope.source === 'catalog' ? telescopes.find((e) => e.id === telescope.telescopeId) : undefined
	const { focalLength, aperture, focalMultiplier } = resolved.optics
	// Values shown, kept as the copy when the source changes.
	const shown: FramingTelescope = { ...telescope, focalLength, aperture, focalMultiplier }

	// Changes the source, keeping the values shown.
	function changeSource(source: FramingOpticsSource) {
		const { telescopeId: _, setupOptics: __, model: ___, ...values } = shown
		if (source === 'setup') onChange({ ...values, source, setupOptics: 'telescope' })
		else if (source === 'catalog') onChange({ ...values, source, ...(offered[0] && { telescopeId: offered[0].id }) })
		else onChange({ ...values, source, ...(source === 'model' && telescope.model && { model: telescope.model }) })
	}

	return (
		<CollapsibleSection id="framing.telescope" title="Telescope" summary={resolved.telescope.label}>
			<Select label="Source" options={SOURCES} value={telescope.source} disabled={locked} onChange={changeSource} format={sourceName} />
			{telescope.source === 'setup' && <Select label="Optics" options={SETUP_OPTICS} value={telescope.setupOptics ?? 'telescope'} disabled={locked} onChange={(setupOptics) => onChange({ ...telescope, setupOptics })} format={(value) => (value === 'guideTelescope' ? 'Guide Telescope' : 'Telescope')} />}
			{telescope.source === 'catalog' &&
				(offered.length > 0 ? (
					<Select
						label="Telescope"
						options={offered.map((e) => e.id)}
						value={telescope.telescopeId ?? offered[0].id}
						disabled={locked}
						onChange={(telescopeId) => {
							const next = telescopes.find((e) => e.id === telescopeId)
							onChange({ ...telescope, telescopeId, focalLength: next?.focalLength ?? telescope.focalLength, aperture: next?.aperture ?? telescope.aperture })
						}}
						format={(id) => telescopes.find((e) => e.id === id)?.name ?? 'Deleted telescope'}
					/>
				) : (
					<Notice>The Equipment Catalog has no telescope yet; add one in Settings → Equipment Catalog.</Notice>
				))}
			{telescope.source === 'model' && (
				<TelescopeModelSearch label="Model" value={telescope.model ?? ''} onValueChange={(model) => onChange({ ...telescope, model })} onPick={(model) => onChange({ ...telescope, model: model.model, focalLength: model.focalLength ?? telescope.focalLength, aperture: model.aperture ?? telescope.aperture })} />
			)}
			<TelescopeInputs
				optics={resolved.optics}
				disabled={locked}
				lockedFocalLength={telescope.source === 'setup' || item?.focalLength !== undefined}
				lockedAperture={telescope.source === 'setup' || item?.aperture !== undefined}
				lockedMultiplier={telescope.source === 'setup'}
				onChange={(next) => onChange({ ...telescope, ...next })}
			/>
			<Notice>
				The focal length is the native one; the reducer or Barlow factor is applied to it once (1 without).
				{telescope.source === 'setup' && ' The Equipment Setup gives every value, its reducer or Barlow included.'}
				{item && ' The values the telescope declares come from Settings → Equipment Catalog.'}
				{resolved.telescope.deleted && ' The telescope was deleted from the Equipment Catalog; its last values are kept.'}
			</Notice>
		</CollapsibleSection>
	)
}

// Props of the camera section.
interface CameraSectionProps {
	// Camera of the framing, as saved.
	readonly camera: FramingCamera
	// Framing resolved for the tab, with the sensor shown.
	readonly resolved: ResolvedFraming
	// Whether the inputs are locked.
	readonly locked: boolean
	// Writes a change of the camera.
	readonly onChange: (camera: FramingCamera) => void
}

// Source and sensor of the camera of a framing.
function CameraSection({ camera, resolved, locked, onChange }: CameraSectionProps) {
	const { cameras } = useSnapshot(catalogState)
	const offered = cameras.filter((e) => !e.archived || e.id === camera.cameraId)
	const sensor = resolved.optics.sensor
	const { roleSensor, missingCamera } = resolved.camera
	// The sensor shown, kept as the copy when the source changes; a camera that has none keeps the copy it had.
	const shown = missingCamera ? camera.sensor : sensor

	// Changes the source, keeping the sensor shown.
	function changeSource(source: FramingOpticsSource) {
		if (source === 'setup') onChange({ source, role: 'MAIN_CAMERA', sensor: shown })
		else if (source === 'catalog') onChange({ source, sensor: shown, ...(offered[0] && { cameraId: offered[0].id }) })
		else onChange({ source, sensor: shown, ...(source === 'model' && camera.model && { model: camera.model }) })
	}

	return (
		<CollapsibleSection id="framing.camera" title="Camera" summary={resolved.camera.label}>
			<Select label="Source" options={SOURCES} value={camera.source} disabled={locked} onChange={changeSource} format={sourceName} />
			{camera.source === 'setup' && (
				<>
					<Select label="Camera" options={CAMERA_ROLES} value={camera.role ?? 'MAIN_CAMERA'} disabled={locked} onChange={(role: CameraRole) => onChange({ ...camera, role })} format={(role) => roleDefinition(role).label} />
					{roleSensor ? (
						<>
							<DataRow label="Resolution">
								{roleSensor.width} × {roleSensor.height} px
							</DataRow>
							<DataRow label="Pixel size">{roleSensor.pixelSize > 0 ? formatPixelSize(roleSensor.pixelSize) : MISSING}</DataRow>
							<Notice>{sensorOriginText(roleSensor, resolved.camera.label)}</Notice>
						</>
					) : (
						<>
							<Notice>The {resolved.camera.label} has not reported its sensor: assign and connect it in the Equipment Setup, or declare the sensor of the camera it is bound to in the Equipment Catalog.</Notice>
							<EquipmentSetupButton />
						</>
					)}
				</>
			)}
			{camera.source === 'catalog' && (
				<>
					{offered.length > 0 ? (
						<Select
							label="Camera"
							options={offered.map((e) => e.id)}
							value={camera.cameraId ?? offered[0].id}
							disabled={locked}
							onChange={(cameraId) => {
								const declared = cameras.find((e) => e.id === cameraId)?.sensor
								const pixelSize = declared?.pixelSize ?? (camera.sensor.kind === 'pixels' ? camera.sensor.pixelSize : 0)
								onChange({ ...camera, cameraId, sensor: declared ? { kind: 'pixels', width: declared.width, height: declared.height, pixelSize } : camera.sensor })
							}}
							format={(id) => cameras.find((e) => e.id === id)?.name ?? 'Deleted camera'}
						/>
					) : (
						<Notice>The Equipment Catalog has no camera yet; add one in Settings → Equipment Catalog.</Notice>
					)}
					<SensorRows sensor={sensor} />
					<Notice>{resolved.camera.deleted ? 'The camera was deleted from the Equipment Catalog; its last sensor is kept.' : 'The sensor the camera declares comes from Settings → Equipment Catalog.'}</Notice>
				</>
			)}
			{camera.source === 'model' && (
				<>
					<CameraModelSearch
						label="Model"
						value={camera.model ?? ''}
						onValueChange={(model) => onChange({ ...camera, model })}
						onPick={(model) => onChange({ ...camera, model: model.model, sensor: { kind: 'pixels', width: model.width, height: model.height, pixelSize: model.pixelSize ?? (camera.sensor.kind === 'pixels' ? camera.sensor.pixelSize : 0) } })}
					/>
					<SensorInputs sensor={camera.sensor} disabled={locked} onChange={(next) => onChange({ ...camera, sensor: next })} />
				</>
			)}
			{camera.source === 'manual' && <SensorInputs sensor={camera.sensor} disabled={locked} onChange={(next) => onChange({ ...camera, sensor: next })} />}
		</CollapsibleSection>
	)
}

// Read-only rows of a sensor.
function SensorRows({ sensor }: { readonly sensor: FramingCamera['sensor'] }) {
	if (sensor.kind === 'physical') {
		return (
			<DataRow label="Sensor">
				{sensor.width} × {sensor.height} mm
			</DataRow>
		)
	}

	return (
		<>
			<DataRow label="Resolution">{sensor.width > 0 && sensor.height > 0 ? `${sensor.width} × ${sensor.height} px` : MISSING}</DataRow>
			<DataRow label="Pixel size">{sensor.pixelSize > 0 ? formatPixelSize(sensor.pixelSize) : MISSING}</DataRow>
		</>
	)
}

// Field of view of a framing and the rotation of its sensor.
function FieldSection({ framing, locked, onRotate }: { readonly framing: ResolvedFraming; readonly locked: boolean; readonly onRotate: (rotation: number) => void }) {
	return (
		<CollapsibleSection id="framing.field" title="Field">
			<FieldRows field={framing.field} missingCamera={framing.camera.missingCamera && `${roleDefinition(framing.camera.missingCamera).label} sensor`} />
			<NumberInput label="Rotation (PA of the top edge)" suffix="°" value={framing.optics.rotation} min={0} max={359.5} step={0.5} disabled={locked} onChange={(rotation) => onRotate(((rotation % 360) + 360) % 360)} />
			<Notice>Position angle of the sensor&apos;s top edge, from north through east, as plate solvers report it; mirrored images are not modeled.</Notice>
		</CollapsibleSection>
	)
}
