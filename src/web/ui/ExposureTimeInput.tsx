import type { ExposureTimeUnit } from 'src/shared/types'
import { exposureTimeIn } from 'src/shared/util'
import { tw } from '@/shared/util'
import { NumberInput, type NumberInputProps } from './components/NumberInput'
import { ExposureTimeUnitDropdown } from './ExposureTimeUnitDropdown'

export interface ExposureTimeInputProps extends Omit<NumberInputProps, 'size' | 'minValue' | 'maxValue' | 'endContent' | 'value' | 'onValueChange'> {
	readonly value: number
	readonly unit: ExposureTimeUnit
	readonly minValue: number
	readonly minValueUnit: ExposureTimeUnit
	readonly maxValue: number
	readonly maxValueUnit: ExposureTimeUnit
	readonly onValueChange: (value: number) => void
	readonly onUnitChange: (unit: ExposureTimeUnit) => void
}

function finiteExposureTime(value: number, fallback: number) {
	return Number.isFinite(value) ? value : fallback
}

function convertedExposureTime(value: number, from: ExposureTimeUnit, to: ExposureTimeUnit, fallback: number) {
	return finiteExposureTime(exposureTimeIn(value, from, to), fallback)
}

function exposureTimeBounds(minValue: number, minValueUnit: ExposureTimeUnit, maxValue: number, maxValueUnit: ExposureTimeUnit, unit: ExposureTimeUnit) {
	const convertedMin = convertedExposureTime(minValue, minValueUnit, unit, 1)
	const min = Math.max(convertedMin <= 0 ? 0 : 1, convertedMin)
	const convertedMax = convertedExposureTime(maxValue, maxValueUnit, unit, min)
	const max = Math.max(min, convertedMax)

	return { min, max } as const
}

function clampExposureTime(value: number | undefined, min: number, max: number) {
	return Math.max(min, Math.min(finiteExposureTime(value ?? min, min), max))
}

export function ExposureTimeInput({ className, value, onValueChange, unit, onUnitChange, minValue, minValueUnit, maxValue, maxValueUnit, disabled, readOnly, ...props }: ExposureTimeInputProps) {
	const { min, max } = exposureTimeBounds(minValue, minValueUnit, maxValue, maxValueUnit, unit)
	const clampedValue = clampExposureTime(value, min, max)

	function handleUnitChange(newUnit: ExposureTimeUnit) {
		const nextBounds = exposureTimeBounds(minValue, minValueUnit, maxValue, maxValueUnit, newUnit)

		onUnitChange(newUnit)
		onValueChange(clampExposureTime(convertedExposureTime(value, unit, newUnit, nextBounds.min), nextBounds.min, nextBounds.max))
	}

	function handleValueChange(value?: number) {
		onValueChange(clampExposureTime(value, min, max))
	}

	const EndContent = <ExposureTimeUnitDropdown color="secondary" onValueChange={handleUnitChange} size="sm" value={unit} disabled={disabled} readOnly={readOnly} />

	return (
		<div className={tw('flex flex-row items-center gap-1', className)}>
			<NumberInput endContent={EndContent} label="Exposure Time" maxValue={max} minValue={min} onValueChange={handleValueChange} value={clampedValue} disabled={disabled} readOnly={readOnly} {...props} />
		</div>
	)
}
