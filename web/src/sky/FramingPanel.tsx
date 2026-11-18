import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { type CatalogTelescope, catalogState } from '../equipment/catalog'
import { roleDefinition } from '../equipment/roles'
import { referencedTelescope } from '../equipment/telescopes'
import { formatPixelSize, MISSING } from '../format'
import { DEFAULT_TELESCOPE, type OpticalConfiguration, resolveFraming, type TelescopeOptics } from '../framing/geometry'
import { FieldRows, SensorInputs, TelescopeInputs } from '../framing/OpticsFields'
import { createOpticalPreset, deleteOpticalPreset, duplicateOpticalPreset, profileState, selectOpticalPreset, setEquipmentRotation, setFramingSource, setFramingVisible, setManualSensor, setGuideTelescopeOptics, setSensorSource, setTelescopeOptics, updateOpticalPreset } from '../profile/profile'
import type { SkyFramingSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { equipmentOptics, type FramingSource, framingSource, type OpticalPreset, type SensorSource, usesGuideTelescope } from './framing'
import type { RoleSensor } from './sensors'
import { useRoleSensors } from './useSkyDevices'

// Framing settings of the Sky workspace: where the field of view comes from (the active profile's Equipment Setup by
// default, or a custom optical preset of the profile), the optics and sensor, the field and image scale they give
// (read-only), its rotation, and whether it is drawn around the selected object. Presets, the telescope
// optics, and a manual sensor are planning data kept in the profile; they never change a device, and no
// equipment has to be connected. The Equipment Setup takes its sensor from the camera of a camera role
// as the server reports it, or from a sensor entered manually to simulate another camera, and its optics from the
// telescope that camera looks through: the guide telescope for the Guide Camera, the telescope otherwise; the values a
// telescope of the Equipment Catalog it refers to declares are shown and edited in the Equipment Catalog only.

export interface FramingPanelProps {
	// Framing preferences of the active profile; absent before the first change.
	readonly framing?: Readonly<SkyFramingSettings>
	// Telescope optics of the active profile's Equipment Setup, resolved through the Equipment Catalog; absent until
	// entered.
	readonly telescope?: Readonly<TelescopeOptics>
	// Guide telescope optics of the active profile's Equipment Setup, which the Guide Camera looks through, resolved
	// through the Equipment Catalog; absent until entered.
	readonly guideTelescope?: Readonly<TelescopeOptics>
	// Whether the selected object has a position the field of view can be drawn at.
	readonly hasTarget: boolean
}

// Sources in menu order, the default first.
const SOURCES: readonly FramingSource[] = ['equipment', 'custom']

// Sensor sources of the Equipment Setup in menu order.
const SENSOR_SOURCES: readonly SensorSource[] = ['MAIN_CAMERA', 'GUIDE_CAMERA', 'manual']

// Says where the sensor of a camera role comes from, for its device of a display name: its report at full frame, the
// sensor the Equipment Catalog declares for the camera it is bound to, or the report completed with declared values.
function sensorOriginText({ origin, catalogCamera }: Pick<RoleSensor, 'origin' | 'catalogCamera'>, device: string) {
	if (origin === 'catalog') return `Declared for ${catalogCamera} in the Equipment Catalog; the ${device} has not reported its sensor.`
	if (origin === 'completed') return `Reported by the ${device} device, completed with what the Equipment Catalog declares for ${catalogCamera}.`
	return `Reported by the ${device} device at full frame.`
}

// Display name of a sensor source.
function sensorSourceName(source: SensorSource) {
	return source === 'manual' ? 'Manual' : roleDefinition(source).label
}

// Framing settings form.
export function FramingPanel({ framing, telescope, guideTelescope, hasTarget }: FramingPanelProps) {
	const source = framingSource(framing)

	return (
		<>
			<CollapsibleSection id="sky.framing.source" title="Source">
				<Select options={SOURCES} value={source} onChange={(next) => setFramingSource(profileState, next)} format={(value) => (value === 'custom' ? 'Custom preset' : 'Equipment Setup')} />
			</CollapsibleSection>
			{source === 'custom' ? <CustomSource framing={framing} hasTarget={hasTarget} /> : <EquipmentSource framing={framing} telescope={telescope} guideTelescope={guideTelescope} hasTarget={hasTarget} />}
		</>
	)
}

// Custom preset source: the presets, and the optics of the selected one.
function CustomSource({ framing, hasTarget }: { readonly framing?: Readonly<SkyFramingSettings>; readonly hasTarget: boolean }) {
	const presets = framing?.presets ?? []
	const preset = presets.find((e) => e.id === framing?.activePresetId)

	return (
		<>
			<CollapsibleSection id="sky.framing.preset" title="Preset">
				{preset ? (
					<>
						<Select options={presets.map((e) => e.id)} value={preset.id} onChange={(id) => selectOpticalPreset(profileState, id)} format={(id) => presets.find((e) => e.id === id)?.name ?? id} />
						<PresetName key={preset.id} preset={preset} />
					</>
				) : (
					<Notice>No presets yet. A preset describes a telescope or lens and a camera, owned or not.</Notice>
				)}
				<div className="flex flex-wrap gap-2">
					<Button variant="secondary" onClick={() => createOpticalPreset(profileState, `Preset ${presets.length + 1}`)}>
						New
					</Button>
					{preset && (
						<>
							<Button variant="secondary" onClick={() => duplicateOpticalPreset(profileState, preset.id)}>
								Duplicate
							</Button>
							<ConfirmButton
								title="Delete preset?"
								message={
									<>
										Delete <strong className="text-ink-100">{preset.name}</strong>? Its optics and camera are removed from the profile, and this cannot be undone.
									</>
								}
								confirmLabel="Delete Preset"
								onConfirm={() => deleteOpticalPreset(profileState, preset.id)}
							>
								Delete
							</ConfirmButton>
						</>
					)}
				</div>
			</CollapsibleSection>
			{preset && <PresetOptics preset={preset} visible={framing?.visible ?? false} hasTarget={hasTarget} />}
		</>
	)
}

// Name field of a preset, saved when it loses focus or on Enter.
function PresetName({ preset }: { readonly preset: Readonly<OpticalPreset> }) {
	const [name, setName] = useState(preset.name)

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault()
				updateOpticalPreset(profileState, preset.id, { name })
			}}
		>
			<TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => updateOpticalPreset(profileState, preset.id, { name })} />
		</form>
	)
}

// Optics, sensor, computed field, and display of a preset.
function PresetOptics({ preset, visible, hasTarget }: { readonly preset: Readonly<OpticalPreset>; readonly visible: boolean; readonly hasTarget: boolean }) {
	const { optics } = preset

	// Saves a change of the optics.
	function change(next: Partial<OpticalConfiguration>) {
		updateOpticalPreset(profileState, preset.id, { optics: { ...optics, ...next } })
	}

	return (
		<>
			<OpticsInputs id="sky.framing.optics" title="Optics" optics={optics} onChange={change} />
			<CollapsibleSection id="sky.framing.camera" title="Camera">
				<SensorInputs sensor={optics.sensor} onChange={(sensor) => change({ sensor })} />
			</CollapsibleSection>
			<FramingResult optics={optics} onRotate={(rotation) => change({ rotation })} />
			<DisplaySection visible={visible} hasTarget={hasTarget} />
		</>
	)
}

// Equipment Setup source: the optics the chosen sensor looks through (the guide telescope for the Guide Camera, the
// telescope otherwise), edited in place, the sensor of a camera role or a manual one, the computed field, and its
// display.
function EquipmentSource({ framing, telescope, guideTelescope, hasTarget }: Pick<FramingPanelProps, 'framing' | 'telescope' | 'guideTelescope' | 'hasTarget'>) {
	const sensorSource = framing?.sensorSource ?? 'MAIN_CAMERA'
	const sensors = useRoleSensors()
	const { optics, missingCamera } = equipmentOptics({ telescope, guideTelescope }, sensorSource, sensors, framing?.manualSensor, framing?.equipmentRotation ?? 0)
	const guide = usesGuideTelescope(sensorSource)
	const current = (guide ? guideTelescope : telescope) ?? DEFAULT_TELESCOPE
	const setOptics = guide ? setGuideTelescopeOptics : setTelescopeOptics
	const reported = sensorSource === 'manual' ? undefined : sensors[sensorSource]
	const referenced = referencedTelescope(current, useSnapshot(catalogState).telescopes)

	return (
		<>
			<OpticsInputs id="sky.framing.telescope" title={guide ? 'Guide Telescope' : 'Telescope'} optics={optics} telescope={referenced} onChange={(next) => setOptics(profileState, { ...current, ...next })} />
			<CollapsibleSection id="sky.framing.camera" title="Camera">
				<Select options={SENSOR_SOURCES} value={sensorSource} onChange={(next) => setSensorSource(profileState, next)} format={sensorSourceName} />
				{sensorSource === 'manual' ? (
					<>
						<SensorInputs sensor={optics.sensor} onChange={(sensor) => setManualSensor(profileState, sensor)} />
						<Notice>Simulates a camera for planning; it is kept in the profile and never sent to a device.</Notice>
					</>
				) : reported ? (
					<>
						<DataRow label="Resolution">
							{reported.width} × {reported.height} px
						</DataRow>
						<DataRow label="Pixel size">{reported.pixelSize > 0 ? formatPixelSize(reported.pixelSize) : MISSING}</DataRow>
						<Notice>{sensorOriginText(reported, sensorSourceName(sensorSource))}</Notice>
					</>
				) : (
					<>
						<Notice>The {sensorSourceName(sensorSource)} has not reported its sensor: assign and connect it in the Equipment Setup, declare the sensor of the camera it is bound to in the Equipment Catalog, or enter a sensor manually.</Notice>
						<div>
							<Button variant="secondary" onClick={() => setSensorSource(profileState, 'manual')}>
								Enter Manually
							</Button>
						</div>
					</>
				)}
			</CollapsibleSection>
			<FramingResult optics={optics} missingCamera={missingCamera && `${sensorSourceName(missingCamera)} sensor`} onRotate={(rotation) => setEquipmentRotation(profileState, rotation)} />
			<DisplaySection visible={framing?.visible ?? false} hasTarget={hasTarget} />
		</>
	)
}

interface OpticsInputsProps {
	// Id of the collapsible section.
	readonly id: string
	// Title of the optics edited.
	readonly title: string
	// Values shown, in millimeters and a factor.
	readonly optics: Readonly<Pick<OpticalConfiguration, 'focalLength' | 'focalMultiplier' | 'aperture'>>
	// Telescope of the Equipment Catalog the optics refer to, whose declared values are not edited here; absent otherwise.
	readonly telescope?: Readonly<Pick<CatalogTelescope, 'name' | 'aperture' | 'focalLength'>>
	// Saves a change of one value.
	readonly onChange: (next: Partial<TelescopeOptics>) => void
}

// Focal length, reducer or Barlow, and aperture inputs, in a section of an id and the title of the optics they edit.
function OpticsInputs({ id, title, optics, telescope, onChange }: OpticsInputsProps) {
	return (
		<CollapsibleSection id={id} title={title}>
			<TelescopeInputs optics={optics} lockedFocalLength={telescope?.focalLength !== undefined} lockedAperture={telescope?.aperture !== undefined} onChange={onChange} />
			<Notice>The focal length is the native one; the reducer or Barlow factor is applied to it once (1 without).{telescope && ` The values ${telescope.name} declares come from Settings → Equipment Catalog.`}</Notice>
		</CollapsibleSection>
	)
}

// Computed field of view of optics, or what is missing to compute it, and the rotation input. A camera
// that reports no sensor is named instead of its individual sensor fields.
function FramingResult({ optics, missingCamera, onRotate }: { readonly optics: Readonly<OpticalConfiguration>; readonly missingCamera?: string; readonly onRotate: (rotation: number) => void }) {
	return (
		<CollapsibleSection id="sky.framing.framing" title="Framing">
			<FieldRows field={resolveFraming(optics)} missingCamera={missingCamera} />
			<NumberInput label="Rotation (PA of the top edge)" suffix="°" value={optics.rotation} min={0} max={359.5} step={0.5} onChange={onRotate} />
			<Notice>Position angle of the sensor&apos;s top edge, from north through east, as plate solvers report it; mirrored images are not modeled.</Notice>
		</CollapsibleSection>
	)
}

// Whether the field of view is drawn.
function DisplaySection({ visible, hasTarget }: { readonly visible: boolean; readonly hasTarget: boolean }) {
	return (
		<CollapsibleSection id="sky.framing.display" title="Display">
			<Checkbox label="Show field of view" checked={visible} onChange={(next) => setFramingVisible(profileState, next)} />
			{visible && !hasTarget && <Notice>The field of view is drawn around the selected object, once its position is known.</Notice>}
		</CollapsibleSection>
	)
}
