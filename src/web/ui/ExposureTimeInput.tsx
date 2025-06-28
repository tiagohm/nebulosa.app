import { NumberInput, type NumberInputProps } from '@heroui/react'
import { useMemo } from 'react'
import type { ExposureTimeUnit } from 'src/api/types'
import { ExposureTimeUnitDropdown } from './ExposureTimeUnitDropdown'

export interface ExposureTimeInputProps extends Omit<NumberInputProps, 'size' | 'minValue' | 'maxValue' | 'endContent'> {
	readonly className: NumberInputProps['className']
	readonly unit: ExposureTimeUnit
	readonly onUnitChange: (unit: ExposureTimeUnit) => void
	readonly minimumInMicrosseconds: number
	readonly maximumInMicrosseconds: number
}

export function ExposureTimeInput({ className, value, onValueChange, unit, onUnitChange, minimumInMicrosseconds, maximumInMicrosseconds, ...props }: ExposureTimeInputProps) {
	const minValue = useMemo(() => 0, [minimumInMicrosseconds, unit])
	const maxValue = useMemo(() => 0, [maximumInMicrosseconds, unit])

	return (
		<div className={`flex flex-row gap-1 items-center ${className}`}>
			<NumberInput {...props} endContent={<ExposureTimeUnitDropdown color='secondary' onValueChange={onUnitChange} value={unit} />} label='Exposure Time' maxValue={maxValue} minValue={minValue} onValueChange={onValueChange} size='sm' value={value} />
		</div>
	)
}
