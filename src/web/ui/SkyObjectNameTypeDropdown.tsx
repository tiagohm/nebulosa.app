import { SKY_OBJECT_NAME_TYPES } from '@/shared/types'
import { Dropdown, DropdownItem, type DropdownProps } from './components/Dropdown'

export interface SkyObjectNameTypeDropdownProps extends Omit<DropdownProps, 'children'> {
	readonly value: number
	readonly onValueChange: (value: number) => void
}

function SkyObjectNameItem(name: string, index: number, onPointerDown: React.PointerEventHandler<HTMLElement>) {
	return (
		<DropdownItem data-index={index} onPointerDown={onPointerDown}>
			{name}
		</DropdownItem>
	)
}

export function SkyObjectNameTypeDropdown({ value, onValueChange, variant = 'ghost', ...props }: SkyObjectNameTypeDropdownProps) {
	function handleOnPointer(event: React.PointerEvent<HTMLElement>) {
		event.stopPropagation()
		const index = +event.currentTarget.dataset.index!
		onValueChange(index - 1)
	}

	return (
		<Dropdown label={SKY_OBJECT_NAME_TYPES[value + 1]} variant={variant} {...props}>
			{SKY_OBJECT_NAME_TYPES.map((name, index) => SkyObjectNameItem(name, index, handleOnPointer))}
		</Dropdown>
	)
}
