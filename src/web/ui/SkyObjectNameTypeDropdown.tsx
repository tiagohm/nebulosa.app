import { SKY_OBJECT_NAME_TYPES } from '@/shared/types'
import { Dropdown, type DropdownProps } from './components/Dropdown'

export interface SkyObjectNameTypeDropdownProps extends Omit<DropdownProps, 'children'> {
	readonly value: number
	readonly onValueChange: (value: number) => void
}

export function SkyObjectNameTypeDropdown({ value, onValueChange, variant = 'ghost', ...props }: SkyObjectNameTypeDropdownProps) {
	function handleAction(index: number) {
		onValueChange(index - 1)
	}

	return (
		<Dropdown label={SKY_OBJECT_NAME_TYPES[value + 1]} variant={variant} onAction={handleAction} {...props}>
			{SKY_OBJECT_NAME_TYPES}
		</Dropdown>
	)
}
