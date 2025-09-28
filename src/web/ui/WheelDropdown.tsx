import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Wheel } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface WheelDropdownProps extends Omit<DeviceDropdownProps<Wheel>, 'items' | 'icon' | 'children'> {
	readonly children?: DeviceDropdownProps<Wheel>['children']
	readonly buttonProps?: Omit<IconButtonProps, 'icon' | 'label' | 'isDisabled' | 'color'>
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
}

export const WheelDropdown = memo(({ showLabel = true, showLabelOnEmpty = true, value, onValueChange, children, buttonProps, ...props }: WheelDropdownProps) => {
	const equipment = useMolecule(EquipmentMolecule)
	const wheels = useSnapshot(equipment.state.WHEEL)

	function handleValueChange(value?: Wheel) {
		onValueChange?.(equipment.state.WHEEL.find((e) => e.id === value?.id))
	}

	return (
		<DeviceDropdown {...props} items={wheels} onValueChange={handleValueChange} value={value}>
			{(value, color, isDisabled) => children?.(value, color, isDisabled) ?? <IconButton color={color} icon={Icons.Palette} isDisabled={isDisabled} label={showLabel ? (value?.name ?? (showLabelOnEmpty ? 'None' : undefined)) : undefined} {...buttonProps} />}
		</DeviceDropdown>
	)
})
