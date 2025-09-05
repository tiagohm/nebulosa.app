import { Button } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Mount } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'

export interface MountDropdownProps extends Omit<DeviceDropdownProps<Mount>, 'items' | 'icon' | 'children'> {
	readonly children?: DeviceDropdownProps<Mount>['children']
}

export const MountDropdown = memo(({ value, onValueChange, children, ...props }: MountDropdownProps) => {
	const equipment = useMolecule(EquipmentMolecule)
	const mounts = useSnapshot(equipment.state.mount)

	return (
		<DeviceDropdown {...props} items={mounts} onValueChange={onValueChange} value={value}>
			{(value, color, isDisabled) =>
				children?.(value, color, isDisabled) ?? (
					<Button className='rounded-full' color={color} isDisabled={isDisabled} isIconOnly size='sm' variant='light'>
						<Icons.Telescope />
					</Button>
				)
			}
		</DeviceDropdown>
	)
})
