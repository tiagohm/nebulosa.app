import { toDeg } from 'nebulosa/src/math/units/angle'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { roleDefinition } from '../equipment/roles'
import { createOpticalPreset, deleteOpticalPreset, duplicateOpticalPreset, profileState, selectOpticalPreset, setEquipmentRotation, setFramingSource, setFramingVisible, setManualSensor, setSensorSource, setTelescopeOptics, type SkyFramingSettings, updateOpticalPreset } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { formatAngularSize } from './format'
import { DEFAULT_TELESCOPE, equipmentOptics, isFraming, type OpticalConfiguration, type OpticalPreset, resolveFraming, type SensorGeometry, type SensorSource, type TelescopeOptics } from './framing'
import { liveSensors, sensorRuntime } from './sensors'

// Framing settings of the Sky workspace: where the field of view comes from (a custom optical preset of
// the active profile, or its Equipment Setup), the optics and sensor, the field and image scale they give
// (read-only), its rotation, and whether it is drawn around the selected object. Presets, the telescope
// optics, and a manual sensor are planning data kept in the profile; they never change a device, and no
// equipment has to be connected. The Equipment Setup takes its sensor from the camera of a camera role
// as the server reports it, or from a sensor entered manually to simulate another camera.

export interface FramingPanelProps {
	// Framing preferences of the active profile; absent before the first change.
	readonly framing?: Readonly<SkyFramingSettings>
	// Telescope optics of the active profile's Equipment Setup; absent until entered.
	readonly telescope?: Readonly<TelescopeOptics>
	// Whether the selected object has a position the field of view can be drawn at.
	readonly hasTarget: boolean
}

// Where the optics of the field of view come from.
type FramingSource = 'custom' | 'equipment'

// Sources in menu order.
const SOURCES: readonly FramingSource[] = ['custom', 'equipment']

// Sensor sources of the Equipment Setup in menu order.
const SENSOR_SOURCES: readonly SensorSource[] = ['MAIN_CAMERA', 'GUIDE_CAMERA', 'manual']

// How the sensor size is entered.
type SensorKind = SensorGeometry['kind']

// Sensor kinds in menu order.
const SENSOR_KINDS: readonly SensorKind[] = ['pixels', 'physical']

// Pixel size in micrometers given to a sensor entered by its size when it is switched to pixels: a common
// CMOS pixel, adjusted afterwards by the user.
const CONVERTED_PIXEL_SIZE = 3.76

// Label and value of one computed datum.
function Datum({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-ink-300">{label}</span>
			<span className="min-w-0 text-right font-mono text-[13px] text-ink-100">{children}</span>
		</div>
	)
}

// Muted explanation under a section.
function Note({ children, danger }: { readonly children: ReactNode; readonly danger?: boolean }) {
	return <p className={danger ? 'm-0 text-xs leading-4 text-danger' : 'm-0 text-xs leading-4 text-ink-300'}>{children}</p>
}

// Converts a sensor to the other way of entering it, keeping its physical size; pixels of an unknown
// size get the default pixel size.
function convertSensor(sensor: SensorGeometry, kind: SensorKind): SensorGeometry {
	if (sensor.kind === kind) return sensor
	if (sensor.kind === 'pixels') return { kind: 'physical', width: (sensor.width * sensor.pixelSize) / 1000, height: (sensor.height * sensor.pixelSize) / 1000 }
	return { kind: 'pixels', width: Math.round((sensor.width * 1000) / CONVERTED_PIXEL_SIZE), height: Math.round((sensor.height * 1000) / CONVERTED_PIXEL_SIZE), pixelSize: CONVERTED_PIXEL_SIZE }
}

// Display name of a sensor source.
function sensorSourceName(source: SensorSource) {
	return source === 'manual' ? 'Manual' : roleDefinition(source).label
}

// Framing settings form.
export function FramingPanel({ framing, telescope, hasTarget }: FramingPanelProps) {
	const source = framing?.source ?? 'custom'

	return (
		<>
			<PanelSection title="Source">
				<Select options={SOURCES} value={source} onChange={(next) => setFramingSource(profileState, next)} format={(value) => (value === 'custom' ? 'Custom preset' : 'Equipment Setup')} />
			</PanelSection>
			{source === 'custom' ? <CustomSource framing={framing} hasTarget={hasTarget} /> : <EquipmentSource framing={framing} telescope={telescope} hasTarget={hasTarget} />}
		</>
	)
}

// Custom preset source: the presets, and the optics of the selected one.
function CustomSource({ framing, hasTarget }: { readonly framing?: Readonly<SkyFramingSettings>; readonly hasTarget: boolean }) {
	const presets = framing?.presets ?? []
	const preset = presets.find((e) => e.id === framing?.activePresetId)

	return (
		<>
			<PanelSection title="Preset">
				{preset ? (
					<>
						<Select options={presets.map((e) => e.id)} value={preset.id} onChange={(id) => selectOpticalPreset(profileState, id)} format={(id) => presets.find((e) => e.id === id)?.name ?? id} />
						<PresetName key={preset.id} preset={preset} />
					</>
				) : (
					<p className="m-0 text-ink-300">No presets yet. A preset describes a telescope or lens and a camera, owned or not.</p>
				)}
				<div className="flex flex-wrap gap-2">
					<Button variant="secondary" size="sm" onClick={() => createOpticalPreset(profileState, `Preset ${presets.length + 1}`)}>
						New
					</Button>
					{preset && (
						<>
							<Button variant="secondary" size="sm" onClick={() => duplicateOpticalPreset(profileState, preset.id)}>
								Duplicate
							</Button>
							<Button variant="ghost" size="sm" onClick={() => deleteOpticalPreset(profileState, preset.id)}>
								Delete
							</Button>
						</>
					)}
				</div>
			</PanelSection>
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
			<OpticsInputs optics={optics} onChange={change} />
			<PanelSection title="Camera">
				<SensorInputs sensor={optics.sensor} onChange={(sensor) => change({ sensor })} />
			</PanelSection>
			<FramingResult optics={optics} onRotate={(rotation) => change({ rotation })} />
			<DisplaySection visible={visible} hasTarget={hasTarget} />
		</>
	)
}

// Equipment Setup source: the profile's telescope optics, the sensor of a camera role or a manual one,
// the computed field, and its display.
function EquipmentSource({ framing, telescope, hasTarget }: { readonly framing?: Readonly<SkyFramingSettings>; readonly telescope?: Readonly<TelescopeOptics>; readonly hasTarget: boolean }) {
	const sensors = useSnapshot(sensorRuntime)
	const sensorSource = framing?.sensorSource ?? 'MAIN_CAMERA'
	const live = liveSensors(sensors)
	const { optics, missingCamera } = equipmentOptics(telescope, sensorSource, live, framing?.manualSensor, framing?.equipmentRotation ?? 0)
	const current = telescope ?? DEFAULT_TELESCOPE
	const reported = sensorSource === 'manual' ? undefined : live[sensorSource]

	return (
		<>
			<OpticsInputs optics={optics} onChange={(next) => setTelescopeOptics(profileState, { ...current, ...next })} />
			<PanelSection title="Camera">
				<Select options={SENSOR_SOURCES} value={sensorSource} onChange={(next) => setSensorSource(profileState, next)} format={sensorSourceName} />
				{sensorSource === 'manual' ? (
					<>
						<SensorInputs sensor={optics.sensor} onChange={(sensor) => setManualSensor(profileState, sensor)} />
						<Note>Simulates a camera for planning; it is kept in the profile and never sent to a device.</Note>
					</>
				) : reported ? (
					<>
						<Datum label="Resolution">
							{reported.width} × {reported.height} px
						</Datum>
						<Datum label="Pixel size">{reported.pixelSize.toFixed(2)} µm</Datum>
						<Note>Reported by the {sensorSourceName(sensorSource)} device at full frame.</Note>
					</>
				) : (
					<>
						<Note>The {sensorSourceName(sensorSource)} has not reported its sensor: assign and connect it in the Equipment Setup, or enter a sensor manually.</Note>
						<div>
							<Button variant="secondary" size="sm" onClick={() => setSensorSource(profileState, 'manual')}>
								Enter Manually
							</Button>
						</div>
					</>
				)}
			</PanelSection>
			<FramingResult optics={optics} missingCamera={missingCamera && `${sensorSourceName(missingCamera)} sensor`} onRotate={(rotation) => setEquipmentRotation(profileState, rotation)} />
			<DisplaySection visible={framing?.visible ?? false} hasTarget={hasTarget} />
		</>
	)
}

// Focal length, reducer or Barlow, and aperture inputs.
function OpticsInputs({ optics, onChange }: { readonly optics: Readonly<Pick<OpticalConfiguration, 'focalLength' | 'focalMultiplier' | 'aperture'>>; readonly onChange: (next: Partial<TelescopeOptics>) => void }) {
	return (
		<PanelSection title="Optics">
			<NumberInput label="Focal length" suffix="mm" value={optics.focalLength} min={0} step={1} onChange={(focalLength) => onChange({ focalLength })} />
			<NumberInput label="Reducer / Barlow" suffix="×" value={optics.focalMultiplier} min={0.1} max={10} step={0.01} onChange={(focalMultiplier) => onChange({ focalMultiplier })} />
			<NumberInput label="Aperture" suffix="mm" value={optics.aperture} min={0} step={1} onChange={(aperture) => onChange({ aperture })} />
			<Note>The focal length is the native one; the reducer or Barlow factor is applied to it once (1 without).</Note>
		</PanelSection>
	)
}

// Sensor size inputs, by resolution and pixel size or by physical size.
function SensorInputs({ sensor, onChange }: { readonly sensor: Readonly<SensorGeometry>; readonly onChange: (sensor: SensorGeometry) => void }) {
	return (
		<>
			<Select options={SENSOR_KINDS} value={sensor.kind} onChange={(kind) => onChange(convertSensor(sensor, kind))} format={(kind) => (kind === 'pixels' ? 'Resolution and pixel size' : 'Sensor size')} />
			{sensor.kind === 'pixels' ? (
				<>
					<NumberInput label="Width" suffix="px" value={sensor.width} min={0} step={1} onChange={(width) => onChange({ ...sensor, width })} />
					<NumberInput label="Height" suffix="px" value={sensor.height} min={0} step={1} onChange={(height) => onChange({ ...sensor, height })} />
					<NumberInput label="Pixel size" suffix="µm" value={sensor.pixelSize} min={0} step={0.01} onChange={(pixelSize) => onChange({ ...sensor, pixelSize })} />
				</>
			) : (
				<>
					<NumberInput label="Sensor width" suffix="mm" value={sensor.width} min={0} step={0.01} onChange={(width) => onChange({ ...sensor, width })} />
					<NumberInput label="Sensor height" suffix="mm" value={sensor.height} min={0} step={0.01} onChange={(height) => onChange({ ...sensor, height })} />
				</>
			)}
		</>
	)
}

// Computed field of view of optics, or what is missing to compute it, and the rotation input. A camera
// that reports no sensor is named instead of its individual sensor fields.
function FramingResult({ optics, missingCamera, onRotate }: { readonly optics: Readonly<OpticalConfiguration>; readonly missingCamera?: string; readonly onRotate: (rotation: number) => void }) {
	const framing = resolveFraming(optics)
	const sensorFields = new Set(['Width in pixels', 'Height in pixels', 'Pixel size'])
	const missing = isFraming(framing) ? [] : missingCamera ? [...framing.missing.filter((e) => !sensorFields.has(e)), missingCamera] : framing.missing

	return (
		<PanelSection title="Framing">
			{isFraming(framing) ? (
				<>
					<Datum label="Field">
						{formatAngularSize(framing.width)} × {formatAngularSize(framing.height)}
					</Datum>
					<Datum label="Field (degrees)">
						{toDeg(framing.width).toFixed(3)}° × {toDeg(framing.height).toFixed(3)}°
					</Datum>
					{framing.scale !== undefined && <Datum label="Image scale">{framing.scale.toFixed(2)}″/px</Datum>}
					<Datum label="Effective focal length">{framing.effectiveFocalLength.toFixed(0)} mm</Datum>
					<Datum label="Sensor">
						{framing.sensorWidth.toFixed(2)} × {framing.sensorHeight.toFixed(2)} mm
					</Datum>
					{framing.focalRatio !== undefined && <Datum label="Focal ratio">f/{framing.focalRatio.toFixed(1)}</Datum>}
				</>
			) : (
				<Note danger>To compute the field, enter: {missing.join(', ')}.</Note>
			)}
			<NumberInput label="Rotation (PA of the top edge)" suffix="°" value={optics.rotation} min={0} max={359.5} step={0.5} onChange={onRotate} />
			<Note>Position angle of the sensor&apos;s top edge, from north through east, as plate solvers report it; mirrored images are not modeled.</Note>
		</PanelSection>
	)
}

// Whether the field of view is drawn.
function DisplaySection({ visible, hasTarget }: { readonly visible: boolean; readonly hasTarget: boolean }) {
	return (
		<PanelSection title="Display">
			<Checkbox label="Show field of view" checked={visible} onChange={(next) => setFramingVisible(profileState, next)} />
			{visible && !hasTarget && <Note>The field of view is drawn around the selected object, once its position is known.</Note>}
		</PanelSection>
	)
}
