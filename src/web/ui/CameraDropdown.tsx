import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Camera } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface CameraDropdownProps extends Omit<DeviceDropdownProps<Camera>, 'items' | 'icon' | 'children'> {
	readonly children?: DeviceDropdownProps<Camera>['children']
	readonly buttonProps?: Omit<IconButtonProps, 'icon' | 'label' | 'isDisabled' | 'color'>
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
}

export const CameraDropdown = memo(({ showLabel = true, showLabelOnEmpty = true, value, onValueChange, children, buttonProps, ...props }: CameraDropdownProps) => {
	const equipment = useMolecule(EquipmentMolecule)
	const cameras = useSnapshot(equipment.state.camera)

	function handleValueChange(value?: Camera) {
		onValueChange?.(equipment.state.camera.find((e) => e.id === value?.id))
	}

	return (
		<DeviceDropdown {...props} items={cameras} onValueChange={handleValueChange} value={value}>
			{(value, color, isDisabled) => children?.(value, color, isDisabled) ?? <IconButton color={color} icon={Icons.Camera} isDisabled={isDisabled} label={showLabel ? (value?.name ?? (showLabelOnEmpty ? 'None' : undefined)) : undefined} {...buttonProps} />}
		</DeviceDropdown>
	)
})
