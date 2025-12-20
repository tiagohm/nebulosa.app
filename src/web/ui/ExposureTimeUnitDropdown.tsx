import { Button, type ButtonProps, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import type { ExposureTimeUnit } from 'src/shared/types'

export interface ExposureTimeUnitDropdownProps extends Omit<ButtonProps, 'isIconOnly'> {
	readonly value: ExposureTimeUnit
	readonly onValueChange: (unit: ExposureTimeUnit) => void
}

const UNITS = {
	MINUTE: 'm',
	SECOND: 's',
	MILLISECOND: 'ms',
	MICROSECOND: 'µs',
} as const

export function ExposureTimeUnitDropdown({ value, onValueChange, size = 'sm', variant = 'light', ...props }: ExposureTimeUnitDropdownProps) {
	return (
		<Dropdown showArrow>
			<DropdownTrigger>
				<Button {...props} isIconOnly size={size} variant={variant}>
					{UNITS[value]}
				</Button>
			</DropdownTrigger>
			<DropdownMenu onAction={(key) => onValueChange(key as never)}>
				<DropdownItem key='MINUTE'>Minutes (m)</DropdownItem>
				<DropdownItem key='SECOND'>Seconds (s)</DropdownItem>
				<DropdownItem key='MILLISECOND'>Milliseconds (ms)</DropdownItem>
				<DropdownItem key='MICROSECOND'>Microseconds (µs)</DropdownItem>
			</DropdownMenu>
		</Dropdown>
	)
}
