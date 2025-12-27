import { useMolecule } from 'bunshi/react'
import type { Rotator } from 'nebulosa/src/indi.device'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface RotatorDropdownProps extends Omit<DeviceDropdownProps<Rotator>, 'items' | 'icon' | 'children'> {
	readonly children?: DeviceDropdownProps<Rotator>['children']
	readonly buttonProps?: Omit<IconButtonProps, 'icon' | 'label' | 'isDisabled' | 'color'>
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
}

export const RotatorDropdown = memo(({ showLabel = true, showLabelOnEmpty = true, value, onValueChange, children, buttonProps, ...props }: RotatorDropdownProps) => {
	const equipment = useMolecule(EquipmentMolecule)
	const focusers = useSnapshot(equipment.state.ROTATOR)

	function handleValueChange(value?: Rotator) {
		onValueChange?.(equipment.state.ROTATOR.find((e) => e.name === value?.name))
	}

	return (
		<DeviceDropdown {...props} items={focusers} onValueChange={handleValueChange} value={value}>
			{(value, color, isDisabled) => children?.(value, color, isDisabled) ?? <IconButton color={color} icon={Icons.RotateRight} isDisabled={isDisabled} label={showLabel ? (value?.name ?? (showLabelOnEmpty ? 'None' : undefined)) : undefined} {...buttonProps} />}
		</DeviceDropdown>
	)
})
