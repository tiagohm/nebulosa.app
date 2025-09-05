import { Button } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Camera } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'

export interface CameraDropdownProps extends Omit<DeviceDropdownProps<Camera>, 'items' | 'icon' | 'children'> {
	readonly children?: DeviceDropdownProps<Camera>['children']
}

export const CameraDropdown = memo(({ value, onValueChange, children, ...props }: CameraDropdownProps) => {
	const equipment = useMolecule(EquipmentMolecule)
	const cameras = useSnapshot(equipment.state.camera)

	return (
		<DeviceDropdown {...props} items={cameras} onValueChange={onValueChange} value={value}>
			{(value, color, isDisabled) =>
				children?.(value, color, isDisabled) ?? (
					<Button className='rounded-full' color={color} isDisabled={isDisabled} isIconOnly size='sm' variant='light'>
						<Icons.Camera />
					</Button>
				)
			}
		</DeviceDropdown>
	)
})
