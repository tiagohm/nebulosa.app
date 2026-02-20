import { NumberInput, type NumberInputProps } from '@heroui/react'
import { useMemo } from 'react'
import type { ExposureTimeUnit } from 'src/shared/types'
import { exposureTimeIn } from 'src/shared/util'
import { DECIMAL_NUMBER_FORMAT } from '@/shared/constants'
import { tw } from '../shared/util'
import { ExposureTimeUnitDropdown } from './ExposureTimeUnitDropdown'

export interface ExposureTimeInputProps extends Omit<NumberInputProps, 'size' | 'minValue' | 'maxValue' | 'endContent' | 'value' | 'onValueChange'> {
	readonly className: NumberInputProps['className']
	readonly value: number
	readonly unit: ExposureTimeUnit
	readonly minValue: number
	readonly minValueUnit: ExposureTimeUnit
	readonly maxValue: number
	readonly maxValueUnit: ExposureTimeUnit
	readonly onValueChange: (value: number) => void
	readonly onUnitChange: (unit: ExposureTimeUnit) => void
}

export function ExposureTimeInput({ className, value, onValueChange, unit, onUnitChange, minValue, minValueUnit, maxValue, maxValueUnit, ...props }: ExposureTimeInputProps) {
	const min = useMemo(() => Math.max(1, exposureTimeIn(minValue, minValueUnit, unit)), [minValue, minValueUnit, unit])
	const max = useMemo(() => Math.max(1, exposureTimeIn(maxValue, maxValueUnit, unit)), [maxValue, maxValueUnit, unit])

	function handleUnitChange(newUnit: ExposureTimeUnit) {
		onUnitChange(newUnit)
		onValueChange(Math.max(1, exposureTimeIn(value, unit, newUnit)))
	}

	function handleValueChange(value?: number) {
		onValueChange(Math.max(min, Math.min(value || min, max)))
	}

	if (value === undefined || value === null) {
		handleValueChange(0)
	}

	return (
		<div className={tw('flex flex-row gap-1 items-center', className)}>
			<NumberInput formatOptions={DECIMAL_NUMBER_FORMAT} {...props} endContent={<ExposureTimeUnitDropdown color='secondary' onValueChange={handleUnitChange} value={unit} />} label='Exposure Time' maxValue={max} minValue={min} onValueChange={handleValueChange} size='sm' value={value} />
		</div>
	)
}
