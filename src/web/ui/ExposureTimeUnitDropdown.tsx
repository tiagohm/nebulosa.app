import type { ExposureTimeUnit } from 'src/shared/types'
import { Dropdown, DropdownItem, type DropdownProps } from './components/Dropdown'

const EXPOSURE_TIME_UNITS = ['MINUTE', 'SECOND', 'MILLISECOND', 'MICROSECOND'] as const

export interface ExposureTimeUnitDropdownProps extends Omit<DropdownProps, 'label' | 'children'> {
	readonly value: ExposureTimeUnit
	readonly onValueChange: (unit: ExposureTimeUnit) => void
}

export function ExposureTimeUnitDropdown({ value, onValueChange, disabled, readOnly, ...props }: ExposureTimeUnitDropdownProps) {
	function handleWheel(event: React.WheelEvent) {
		if (event.defaultPrevented || disabled || readOnly) return

		const delta = event.deltaY || event.deltaX
		const direction = Math.sign(delta)

		if (direction !== 1 && direction !== -1) return

		event.preventDefault()

		const index = EXPOSURE_TIME_UNITS.indexOf(value)
		const nextIndex = direction === 1 ? (index + 1) % 4 : (index + 3) % 4

		onValueChange(EXPOSURE_TIME_UNITS[nextIndex])
	}

	return (
		<Dropdown onWheel={handleWheel} label={value === 'MINUTE' ? 'm' : value === 'SECOND' ? 's' : value === 'MILLISECOND' ? 'ms' : 'µs'} disabled={disabled} readOnly={readOnly} {...props}>
			<DropdownItem label="Minutes (m)" onClick={() => onValueChange('MINUTE')} />
			<DropdownItem label="Seconds (s)" onClick={() => onValueChange('SECOND')} />
			<DropdownItem label="Milliseconds (ms)" onClick={() => onValueChange('MILLISECOND')} />
			<DropdownItem label="Microseconds (µs)" onClick={() => onValueChange('MICROSECOND')} />
		</Dropdown>
	)
}
