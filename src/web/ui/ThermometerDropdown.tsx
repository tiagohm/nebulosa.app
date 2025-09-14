import { Button } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Thermometer } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'

export interface ThermometerDropdownProps extends Omit<DeviceDropdownProps<Thermometer>, 'items' | 'icon' | 'children'> {
	readonly children?: DeviceDropdownProps<Thermometer>['children']
}

export const ThermometerDropdown = memo(({ value, onValueChange, children, ...props }: ThermometerDropdownProps) => {
	const equipment = useMolecule(EquipmentMolecule)
	const thermometers = useSnapshot(equipment.state.thermometer)

	function handleValueChange(value?: Thermometer) {
		onValueChange?.(equipment.state.thermometer.find((e) => e.id === value?.id))
	}

	return (
		<DeviceDropdown {...props} items={thermometers} onValueChange={handleValueChange} value={value}>
			{(value, color, isDisabled) =>
				children?.(value, color, isDisabled) ?? (
					<Button className='rounded-full' color={color} isDisabled={isDisabled} isIconOnly size='sm' variant='light'>
						<Icons.Thermometer />
					</Button>
				)
			}
		</DeviceDropdown>
	)
})
