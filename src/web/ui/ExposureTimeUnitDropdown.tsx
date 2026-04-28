import type { ExposureTimeUnit } from 'src/shared/types'
import { Dropdown, DropdownItem, type DropdownProps } from './components/Dropdown'

export interface ExposureTimeUnitDropdownProps extends Omit<DropdownProps, 'label'> {
	readonly value: ExposureTimeUnit
	readonly onValueChange: (unit: ExposureTimeUnit) => void
}

export function ExposureTimeUnitDropdown({ value, onValueChange, ...props }: ExposureTimeUnitDropdownProps) {
	return (
		<Dropdown label={value === 'MINUTE' ? 'm' : value === 'SECOND' ? 's' : value === 'MILLISECOND' ? 'ms' : 'µs'} {...props}>
			<DropdownItem label="Minutes (m)" onPointerDown={() => onValueChange('MINUTE')} />
			<DropdownItem label="Seconds (s)" onPointerDown={() => onValueChange('SECOND')} />
			<DropdownItem label="Milliseconds (ms)" onPointerDown={() => onValueChange('MILLISECOND')} />
			<DropdownItem label="Microseconds (µs)" onPointerDown={() => onValueChange('MICROSECOND')} />
		</Dropdown>
	)
}
