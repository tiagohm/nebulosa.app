import { Button } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Focuser } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'

export interface FocuserDropdownProps extends Omit<DeviceDropdownProps<Focuser>, 'items' | 'icon' | 'children'> {
	readonly children?: DeviceDropdownProps<Focuser>['children']
}

export const FocuserDropdown = memo(({ value, onValueChange, children, ...props }: FocuserDropdownProps) => {
	const equipment = useMolecule(EquipmentMolecule)
	const focusers = useSnapshot(equipment.state.focuser)

	function handleValueChange(value?: Focuser) {
		onValueChange?.(equipment.state.focuser.find((e) => e.id === value?.id))
	}

	return (
		<DeviceDropdown {...props} items={focusers} onValueChange={handleValueChange} value={value}>
			{(value, color, isDisabled) =>
				children?.(value, color, isDisabled) ?? (
					<Button className='rounded-full' color={color} isDisabled={isDisabled} isIconOnly size='sm' variant='light'>
						<Icons.Focuser />
					</Button>
				)
			}
		</DeviceDropdown>
	)
})
