import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Focuser } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface FocuserDropdownProps extends Omit<DeviceDropdownProps<Focuser>, 'items' | 'icon' | 'children'> {
	readonly children?: DeviceDropdownProps<Focuser>['children']
	readonly buttonProps?: Omit<IconButtonProps, 'icon' | 'label' | 'isDisabled' | 'color'>
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
}

export const FocuserDropdown = memo(({ showLabel = true, showLabelOnEmpty = true, value, onValueChange, children, buttonProps, ...props }: FocuserDropdownProps) => {
	const equipment = useMolecule(EquipmentMolecule)
	const focusers = useSnapshot(equipment.state.FOCUSER)

	function handleValueChange(value?: Focuser) {
		onValueChange?.(equipment.state.FOCUSER.find((e) => e.id === value?.id))
	}

	return (
		<DeviceDropdown {...props} items={focusers} onValueChange={handleValueChange} value={value}>
			{(value, color, isDisabled) => children?.(value, color, isDisabled) ?? <IconButton color={color} icon={Icons.Focuser} isDisabled={isDisabled} label={showLabel ? (value?.name ?? (showLabelOnEmpty ? 'None' : undefined)) : undefined} {...buttonProps} />}
		</DeviceDropdown>
	)
})
