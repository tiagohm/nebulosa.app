import { Dropdown, type DropdownProps } from '@ui/components/Dropdown'
import { SKY_OBJECT_NAME_TYPES } from 'src/types/galaxy'

export interface SkyObjectNameTypeDropdownProps extends Omit<DropdownProps, 'children'> {
	readonly value: number
	readonly onValueChange: (value: number) => void
}

const ITEMS = ['ALL', ...SKY_OBJECT_NAME_TYPES.map((e) => e[0])]

export function SkyObjectNameTypeDropdown({ value, onValueChange, variant = 'ghost', ...props }: SkyObjectNameTypeDropdownProps) {
	function handleAction(index: number) {
		onValueChange(index - 1)
	}

	return (
		<Dropdown label={ITEMS[value + 1]} variant={variant} onAction={handleAction} {...props}>
			{ITEMS}
		</Dropdown>
	)
}
