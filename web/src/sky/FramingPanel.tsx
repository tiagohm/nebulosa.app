import { toDeg } from 'nebulosa/src/math/units/angle'
import { type ReactNode, useState } from 'react'
import { createOpticalPreset, deleteOpticalPreset, duplicateOpticalPreset, profileState, selectOpticalPreset, setFramingVisible, type SkyFramingSettings, updateOpticalPreset } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { TextInput } from '../ui/TextInput'
import { formatAngularSize } from './format'
import { isFraming, type OpticalConfiguration, type OpticalPreset, resolveFraming, type SensorGeometry } from './framing'

// Framing settings of the Sky workspace: the custom optical presets of the active profile, their
// optics and sensor, the field of view and image scale they give (read-only), its rotation, and whether
// it is drawn around the selected object. Presets are planning data only; they never change the
// equipment setup or any device, and no equipment has to be connected.

export interface FramingPanelProps {
	// Framing preferences of the active profile; absent before the first preset.
	readonly framing?: Readonly<SkyFramingSettings>
	// Whether the selected object has a position the field of view can be drawn at.
	readonly hasTarget: boolean
}

// Where the optics of the field of view come from.
type FramingSource = 'custom' | 'equipment'

// Sources in menu order.
const SOURCES: readonly FramingSource[] = ['custom', 'equipment']

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

// Converts a sensor to the other way of entering it, keeping its physical size; pixels of an unknown
// size get the default pixel size.
function convertSensor(sensor: SensorGeometry, kind: SensorKind): SensorGeometry {
	if (sensor.kind === kind) return sensor
	if (sensor.kind === 'pixels') return { kind: 'physical', width: (sensor.width * sensor.pixelSize) / 1000, height: (sensor.height * sensor.pixelSize) / 1000 }
	return { kind: 'pixels', width: Math.round((sensor.width * 1000) / CONVERTED_PIXEL_SIZE), height: Math.round((sensor.height * 1000) / CONVERTED_PIXEL_SIZE), pixelSize: CONVERTED_PIXEL_SIZE }
}

// Framing settings form.
export function FramingPanel({ framing, hasTarget }: FramingPanelProps) {
	const presets = framing?.presets ?? []
	const preset = presets.find((e) => e.id === framing?.activePresetId)

	return (
		<>
			<PanelSection title="Source">
				<Select options={SOURCES} value="custom" onChange={() => undefined} format={(source) => (source === 'custom' ? 'Custom preset' : 'Equipment Setup')} disabledReason={(source) => (source === 'equipment' ? 'The Equipment Setup does not hold optical data yet' : undefined)} />
			</PanelSection>
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
	const { sensor } = optics
	const framing = resolveFraming(optics)

	// Saves a change of the optics.
	function change(next: Partial<OpticalConfiguration>) {
		updateOpticalPreset(profileState, preset.id, { optics: { ...optics, ...next } })
	}

	return (
		<>
			<PanelSection title="Optics">
				<NumberInput label="Focal length (mm)" value={optics.focalLength} min={0} step={1} onChange={(focalLength) => change({ focalLength })} />
				<NumberInput label="Reducer / Barlow (×)" value={optics.focalMultiplier} min={0.1} max={10} step={0.01} onChange={(focalMultiplier) => change({ focalMultiplier })} />
				<NumberInput label="Aperture (mm)" value={optics.aperture} min={0} step={1} onChange={(aperture) => change({ aperture })} />
				<p className="m-0 text-xs leading-4 text-ink-300">The focal length is the native one; the reducer or Barlow factor is applied to it once (1 without).</p>
			</PanelSection>
			<PanelSection title="Camera">
				<Select options={SENSOR_KINDS} value={sensor.kind} onChange={(kind) => change({ sensor: convertSensor(sensor, kind) })} format={(kind) => (kind === 'pixels' ? 'Resolution and pixel size' : 'Sensor size')} />
				{sensor.kind === 'pixels' ? (
					<>
						<NumberInput label="Width (px)" value={sensor.width} min={0} step={1} onChange={(width) => change({ sensor: { ...sensor, width } })} />
						<NumberInput label="Height (px)" value={sensor.height} min={0} step={1} onChange={(height) => change({ sensor: { ...sensor, height } })} />
						<NumberInput label="Pixel size (µm)" value={sensor.pixelSize} min={0} step={0.01} onChange={(pixelSize) => change({ sensor: { ...sensor, pixelSize } })} />
					</>
				) : (
					<>
						<NumberInput label="Sensor width (mm)" value={sensor.width} min={0} step={0.01} onChange={(width) => change({ sensor: { ...sensor, width } })} />
						<NumberInput label="Sensor height (mm)" value={sensor.height} min={0} step={0.01} onChange={(height) => change({ sensor: { ...sensor, height } })} />
					</>
				)}
			</PanelSection>
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
					<p className="m-0 text-xs leading-4 text-danger">To compute the field, enter: {framing.missing.join(', ')}.</p>
				)}
				<NumberInput label="Rotation (°, PA of the top edge)" value={optics.rotation} min={0} max={359.5} step={0.5} onChange={(rotation) => change({ rotation })} />
				<p className="m-0 text-xs leading-4 text-ink-300">Position angle of the sensor&apos;s top edge, from north through east, as plate solvers report it; mirrored images are not modeled.</p>
			</PanelSection>
			<PanelSection title="Display">
				<Checkbox label="Show field of view" checked={visible} onChange={(next) => setFramingVisible(profileState, next)} />
				{visible && !hasTarget && <p className="m-0 text-xs leading-4 text-ink-300">The field of view is drawn around the selected object, once its position is known.</p>}
			</PanelSection>
		</>
	)
}
