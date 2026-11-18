import { arcsec } from 'nebulosa/src/math/units/angle'
import { formatDegrees, formatFixed, formatFocalRatio, formatMillimeters } from '../format'
import { formatPixelScale } from '../platesolving/coordinates'
import { formatApparentSize } from '../sky/format'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { isFraming, type MissingFraming, type OpticalConfiguration, type Framing as FieldOfView, type SensorGeometry } from './geometry'

// Fields of the optics of a framing: the focal length, reducer or Barlow, and aperture of a telescope, the size of a
// sensor by its pixels or by its physical size, and the field of view they give, written as data sheets read.

// How the sensor size is entered.
type SensorKind = SensorGeometry['kind']

// Sensor kinds in menu order.
const SENSOR_KINDS: readonly SensorKind[] = ['pixels', 'physical']

// Pixel size in micrometers given to a sensor entered by its size when it is switched to pixels: a common CMOS pixel,
// adjusted afterwards by the operator.
const CONVERTED_PIXEL_SIZE = 3.76

// Converts a sensor to the other way of entering it, keeping its physical size; pixels of an unknown size get the
// default pixel size.
export function convertSensor(sensor: SensorGeometry, kind: SensorKind): SensorGeometry {
	if (sensor.kind === kind) return sensor
	if (sensor.kind === 'pixels') return { kind: 'physical', width: (sensor.width * sensor.pixelSize) / 1000, height: (sensor.height * sensor.pixelSize) / 1000 }
	return { kind: 'pixels', width: Math.round((sensor.width * 1000) / CONVERTED_PIXEL_SIZE), height: Math.round((sensor.height * 1000) / CONVERTED_PIXEL_SIZE), pixelSize: CONVERTED_PIXEL_SIZE }
}

// Props of the telescope inputs.
export interface TelescopeInputsProps {
	// Values shown, in millimeters and a factor.
	readonly optics: Readonly<Pick<OpticalConfiguration, 'focalLength' | 'focalMultiplier' | 'aperture'>>
	// Whether the focal length comes from elsewhere and is not edited here.
	readonly lockedFocalLength?: boolean
	// Whether the aperture comes from elsewhere and is not edited here.
	readonly lockedAperture?: boolean
	// Whether the reducer or Barlow comes from elsewhere and is not edited here.
	readonly lockedMultiplier?: boolean
	// Whether every input is disabled.
	readonly disabled?: boolean
	// Saves a change of one value.
	readonly onChange: (next: Partial<Pick<OpticalConfiguration, 'focalLength' | 'focalMultiplier' | 'aperture'>>) => void
}

// Focal length, reducer or Barlow, and aperture inputs.
export function TelescopeInputs({ optics, lockedFocalLength = false, lockedAperture = false, lockedMultiplier = false, disabled = false, onChange }: TelescopeInputsProps) {
	return (
		<>
			<NumberInput label="Focal length" suffix="mm" value={optics.focalLength} min={0} step={1} disabled={disabled || lockedFocalLength} onChange={(focalLength) => onChange({ focalLength })} />
			<NumberInput label="Reducer / Barlow" suffix="×" value={optics.focalMultiplier} min={0.1} max={10} step={0.01} disabled={disabled || lockedMultiplier} onChange={(focalMultiplier) => onChange({ focalMultiplier })} />
			<NumberInput label="Aperture" suffix="mm" value={optics.aperture} min={0} step={1} disabled={disabled || lockedAperture} onChange={(aperture) => onChange({ aperture })} />
		</>
	)
}

// Props of the sensor inputs.
export interface SensorInputsProps {
	// Sensor shown.
	readonly sensor: Readonly<SensorGeometry>
	// Whether every input is disabled.
	readonly disabled?: boolean
	// Saves a change of the sensor.
	readonly onChange: (sensor: SensorGeometry) => void
}

// Sensor size inputs, by resolution and pixel size or by physical size.
export function SensorInputs({ sensor, disabled = false, onChange }: SensorInputsProps) {
	return (
		<>
			<Select label="Sensor given by" options={SENSOR_KINDS} value={sensor.kind} disabled={disabled} onChange={(kind) => onChange(convertSensor(sensor, kind))} format={(kind) => (kind === 'pixels' ? 'Resolution and pixel size' : 'Sensor size')} />
			{sensor.kind === 'pixels' ? (
				<>
					<NumberInput label="Width" suffix="px" value={sensor.width} min={0} step={1} disabled={disabled} onChange={(width) => onChange({ ...sensor, width })} />
					<NumberInput label="Height" suffix="px" value={sensor.height} min={0} step={1} disabled={disabled} onChange={(height) => onChange({ ...sensor, height })} />
					<NumberInput label="Pixel size" suffix="µm" value={sensor.pixelSize} min={0} step={0.01} disabled={disabled} onChange={(pixelSize) => onChange({ ...sensor, pixelSize })} />
				</>
			) : (
				<>
					<NumberInput label="Sensor width" suffix="mm" value={sensor.width} min={0} step={0.01} disabled={disabled} onChange={(width) => onChange({ ...sensor, width })} />
					<NumberInput label="Sensor height" suffix="mm" value={sensor.height} min={0} step={0.01} disabled={disabled} onChange={(height) => onChange({ ...sensor, height })} />
				</>
			)}
		</>
	)
}

// Sensor values a camera without a sensor stands for, named once as that camera instead.
const SENSOR_FIELDS = new Set(['Width in pixels', 'Height in pixels', 'Pixel size'])

// Returns what a field of view lacks, with a camera that has no sensor (missingCamera) named instead of its individual
// sensor values: "Focal length, Main Camera sensor".
export function missingText(field: MissingFraming, missingCamera?: string) {
	return (missingCamera ? [...field.missing.filter((e) => !SENSOR_FIELDS.has(e)), missingCamera] : field.missing).join(', ')
}

// Returns the angular width and height of a field in one unit chosen by its larger side: degrees from 1°, else arcminutes
// or arcseconds (formatApparentSize), such as "5.38° × 3.60°" or "48.21′ × 32.14′".
export function formatFieldSize(width: number, height: number) {
	if (Math.max(width, height) >= Math.PI / 180) return `${formatDegrees(width, 2)} × ${formatDegrees(height, 2)}`
	return `${formatApparentSize(width)} × ${formatApparentSize(height)}`
}

// Rows of a computed field of view, or what is missing to compute it; a camera that has no sensor is named (missingCamera)
// instead of its individual sensor fields.
export function FieldRows({ field, missingCamera }: { readonly field: FieldOfView | MissingFraming; readonly missingCamera?: string }) {
	if (!isFraming(field)) return <Notice>The field needs: {missingText(field, missingCamera)}.</Notice>

	return (
		<>
			<DataRow label="Field">{formatFieldSize(field.width, field.height)}</DataRow>
			{field.scale !== undefined && <DataRow label="Image scale">{formatPixelScale(arcsec(field.scale))}</DataRow>}
			<DataRow label="Effective focal length">{formatMillimeters(field.effectiveFocalLength)}</DataRow>
			<DataRow label="Sensor">
				{formatFixed(field.sensorWidth, 2)} × {formatFixed(field.sensorHeight, 2)} mm
			</DataRow>
			{field.focalRatio !== undefined && <DataRow label="Focal ratio">{formatFocalRatio(field.focalRatio)}</DataRow>}
		</>
	)
}

// Returns the one-line summary of a field of view: its size and its image scale, or what it needs (missingCamera names a
// camera that has no sensor).
export function fieldSummary(field: FieldOfView | MissingFraming, missingCamera?: string) {
	if (!isFraming(field)) return `Needs: ${missingText(field, missingCamera)}`
	const size = formatFieldSize(field.width, field.height)
	return field.scale === undefined ? size : `${size} · ${formatPixelScale(arcsec(field.scale))}`
}
