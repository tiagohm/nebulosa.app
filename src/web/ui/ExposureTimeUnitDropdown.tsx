import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import type { ExposureTimeUnit } from 'src/shared/types'
import { stopPropagationDesktopOnly } from '@/shared/util'
import { Button, type ButtonProps } from './components/Button'

export interface ExposureTimeUnitDropdownProps extends Omit<ButtonProps, 'label' | 'onWheel'> {
	readonly value: ExposureTimeUnit
	readonly onValueChange: (unit: ExposureTimeUnit) => void
}

const UNITS = ['MINUTE', 'SECOND', 'MILLISECOND', 'MICROSECOND'] as const
const SYMBOLS = ['m', 's', 'ms', 'µs'] as const

export function ExposureTimeUnitDropdown({ value, onValueChange, size = 'sm', variant = 'ghost', ...props }: ExposureTimeUnitDropdownProps) {
	return (
		<Dropdown>
			<DropdownTrigger>
				<Button {...props} label={SYMBOLS[UNITS.indexOf(value)]} onPointerUp={stopPropagationDesktopOnly} size={size} variant={variant} />
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
