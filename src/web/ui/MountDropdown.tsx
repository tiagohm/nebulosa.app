import { useMolecule } from 'bunshi/react'
import type { Mount } from 'nebulosa/src/indi.device'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface MountDropdownProps extends Omit<DeviceDropdownProps<Mount>, 'items' | 'icon' | 'children'> {
	readonly children?: DeviceDropdownProps<Mount>['children']
	readonly buttonProps?: Omit<IconButtonProps, 'icon' | 'label' | 'isDisabled' | 'color'>
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
}

export const MountDropdown = memo(({ showLabel = true, showLabelOnEmpty = true, value, onValueChange, children, buttonProps, ...props }: MountDropdownProps) => {
	const equipment = useMolecule(EquipmentMolecule)
	const mounts = useSnapshot(equipment.state.MOUNT)

	function handleValueChange(value?: Mount) {
		onValueChange?.(equipment.state.MOUNT.find((e) => e.name === value?.name))
	}

	return (
		<DeviceDropdown {...props} items={mounts} onValueChange={handleValueChange} value={value}>
			{(value, color, isDisabled) => children?.(value, color, isDisabled) ?? <IconButton color={color} icon={Icons.Telescope} isDisabled={isDisabled} label={showLabel ? (value?.name ?? (showLabelOnEmpty ? 'None' : undefined)) : undefined} {...buttonProps} />}
		</DeviceDropdown>
	)
})
