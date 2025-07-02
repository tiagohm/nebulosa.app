import { Button, type ButtonProps, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import type { ExposureTimeUnit } from 'src/shared/types'
import { exposureTimeUnitCode } from 'src/shared/util'

export interface ExposureTimeUnitDropdownProps extends Omit<ButtonProps, 'isIconOnly'> {
	readonly value: ExposureTimeUnit
	readonly onValueChange: (unit: ExposureTimeUnit) => void
}

export function ExposureTimeUnitDropdown({ value, onValueChange, size = 'sm', variant = 'light', ...props }: ExposureTimeUnitDropdownProps) {
	return (
		<Dropdown showArrow>
			<DropdownTrigger>
				<Button {...props} isIconOnly size={size} variant={variant}>
					{exposureTimeUnitCode(value)}
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
