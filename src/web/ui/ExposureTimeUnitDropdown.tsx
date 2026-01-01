import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import type { ExposureTimeUnit } from 'src/shared/types'
import { TextButton, type TextButtonProps } from './TextButton'

export interface ExposureTimeUnitDropdownProps extends Omit<TextButtonProps, 'label' | 'onWheel'> {
	readonly value: ExposureTimeUnit
	readonly onValueChange: (unit: ExposureTimeUnit) => void
}

const UNITS = ['MINUTE', 'SECOND', 'MILLISECOND', 'MICROSECOND'] as const
const SYMBOLS = ['m', 's', 'ms', 'µs'] as const

export function ExposureTimeUnitDropdown({ value, onValueChange, size = 'sm', variant = 'light', ...props }: ExposureTimeUnitDropdownProps) {
	return (
		<Dropdown showArrow>
			<DropdownTrigger>
				<TextButton {...props} label={SYMBOLS[UNITS.indexOf(value)]} size={size} variant={variant} />
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
