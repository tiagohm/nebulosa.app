import type { CameraCapabilities } from 'api'
import { useState } from 'react'
import { NumberInput } from '../ui/NumberInput'
import { RadioGroup } from '../ui/RadioGroup'

// Exposure time field of the Camera Capture panel: a whole number of the unit chosen below it (minutes,
// seconds, milliseconds, or microseconds), committed to the form in seconds. The unit opens as the largest
// in which the exposure is a whole number, and a chosen unit in which the exposure is not one gives way to
// that unit, so the field always shows the exposure that is sent. Choosing another unit keeps the duration,
// rounded to a whole number of the new unit and never below one.

// Unit of the exposure time field.
export type ExposureUnit = 'm' | 's' | 'ms' | 'μs'

// Units of the exposure time field, from the largest.
export const EXPOSURE_UNITS: readonly ExposureUnit[] = ['m', 's', 'ms', 'μs']

// Duration of each unit, in seconds.
const UNIT_SECONDS: Readonly<Record<ExposureUnit, number>> = { m: 60, s: 1, ms: 1e-3, μs: 1e-6 }

// Returns a duration in seconds as a number of a unit, without float noise, so 0.000032 s is 32 μs.
export function fromSeconds(seconds: number, unit: ExposureUnit): number {
	return Number((seconds / UNIT_SECONDS[unit]).toPrecision(12))
}

// Returns a number of a unit as a duration in seconds, without float noise.
export function toSeconds(count: number, unit: ExposureUnit): number {
	return Number((count * UNIT_SECONDS[unit]).toPrecision(12))
}

// Returns the largest unit in which a positive duration in seconds is a whole number; microseconds when
// it is none, as for a duration below one microsecond.
export function exposureUnitOf(seconds: number): ExposureUnit {
	return EXPOSURE_UNITS.find((unit) => Number.isInteger(fromSeconds(seconds, unit))) ?? 'μs'
}

// Returns a duration in seconds converted to a whole number of a unit, at least one, back in seconds.
export function convertExposure(seconds: number, unit: ExposureUnit): number {
	return toSeconds(Math.max(1, Math.round(fromSeconds(seconds, unit))), unit)
}

export interface ExposureTimeInputProps {
	// Committed exposure time, in seconds; positive.
	readonly value: number
	// Called with every exposure time entered or converted, in seconds.
	readonly onChange: (value: number) => void
	// Exposure range the camera reports, in seconds, when known.
	readonly exposure?: CameraCapabilities['exposure']
	readonly disabled?: boolean
}

// Exposure time input with its unit.
export function ExposureTimeInput({ value, onChange, exposure, disabled }: ExposureTimeInputProps) {
	const [chosen, setChosen] = useState(() => exposureUnitOf(value))
	const unit = Number.isInteger(fromSeconds(value, chosen)) ? chosen : exposureUnitOf(value)
	const min = exposure ? Math.max(1, Math.ceil(fromSeconds(exposure.min, unit))) : 1
	const max = exposure && Math.floor(fromSeconds(exposure.max, unit))

	return (
		<>
			<NumberInput label="Exposure Time" suffix={unit} value={Math.max(1, Math.round(fromSeconds(value, unit)))} min={min} max={max !== undefined && max >= min ? max : undefined} disabled={disabled} onChange={(count) => onChange(toSeconds(count, unit))} />
			<RadioGroup
				options={EXPOSURE_UNITS}
				value={unit}
				disabled={disabled}
				onChange={(next) => {
					setChosen(next)
					onChange(convertExposure(value, next))
				}}
			/>
		</>
	)
}
