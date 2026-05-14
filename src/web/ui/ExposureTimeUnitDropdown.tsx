import type { ExposureTimeUnit } from 'src/shared/types'
import { Dropdown, DropdownItem, type DropdownProps } from './components/Dropdown'

export interface ExposureTimeUnitDropdownProps extends Omit<DropdownProps, 'label' | 'children'> {
	readonly value: ExposureTimeUnit
	readonly onValueChange: (unit: ExposureTimeUnit) => void
}

export function ExposureTimeUnitDropdown({ value, onValueChange, ...props }: ExposureTimeUnitDropdownProps) {
	return (
		<Dropdown label={value === 'MINUTE' ? 'm' : value === 'SECOND' ? 's' : value === 'MILLISECOND' ? 'ms' : 'µs'} {...props}>
			<DropdownItem label="Minutes (m)" onClick={() => onValueChange('MINUTE')} />
			<DropdownItem label="Seconds (s)" onClick={() => onValueChange('SECOND')} />
			<DropdownItem label="Milliseconds (ms)" onClick={() => onValueChange('MILLISECOND')} />
			<DropdownItem label="Microseconds (µs)" onClick={() => onValueChange('MICROSECOND')} />
		</Dropdown>
	)
}
