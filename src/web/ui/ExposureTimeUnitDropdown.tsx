import { Button, type ButtonProps, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import { useMemo } from 'react'
import type { ExposureTimeUnit } from 'src/api/types'

export interface ExposureTimeUnitDropdownProps extends Omit<ButtonProps, 'isIconOnly'> {
	readonly value: ExposureTimeUnit
	readonly onValueChange: (unit: ExposureTimeUnit) => void
}

export function ExposureTimeUnitDropdown({ value, onValueChange, size = 'sm', variant = 'light', ...props }: ExposureTimeUnitDropdownProps) {
	const unit = useMemo(() => {
		switch (value) {
			case 'MINUTES':
				return 'm'
			case 'SECONDS':
				return 's'
			case 'MILLISECONDS':
				return 'ms'
			case 'MICROSECONDS':
				return 'µs'
		}
	}, [value])

	return (
		<Dropdown showArrow>
			<DropdownTrigger>
				<Button {...props} isIconOnly size={size} variant={variant}>
					{unit}
				</Button>
			</DropdownTrigger>
			<DropdownMenu onAction={(key) => onValueChange(key as never)}>
				<DropdownItem key='MINUTES'>Minutes (m)</DropdownItem>
				<DropdownItem key='SECONDS'>Seconds (s)</DropdownItem>
				<DropdownItem key='MILLISECONDS'>Milliseconds (ms)</DropdownItem>
				<DropdownItem key='MICROSECONDS'>Microseconds (µs)</DropdownItem>
			</DropdownMenu>
		</Dropdown>
	)
}
