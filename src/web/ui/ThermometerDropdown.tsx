import { useMolecule } from 'bunshi/react'
import type { Thermometer } from 'nebulosa/src/indi.device'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

export interface ThermometerDropdownProps extends Omit<DeviceDropdownProps<Thermometer>, 'items' | 'icon' | 'children'> {
	readonly children?: DeviceDropdownProps<Thermometer>['children']
}

export const ThermometerDropdown = memo(({ value, onValueChange, children, ...props }: ThermometerDropdownProps) => {
	const equipment = useMolecule(EquipmentMolecule)
	const thermometers = useSnapshot(equipment.state.THERMOMETER)

	function handleValueChange(value?: Thermometer) {
		onValueChange?.(equipment.state.THERMOMETER.find((e) => e.name === value?.name))
	}

	return (
		<DeviceDropdown {...props} items={thermometers} onValueChange={handleValueChange} value={value}>
			{(value, color, isDisabled) => children?.(value, color, isDisabled) ?? <IconButton className='rounded-full' color={color} icon={Icons.Thermometer} isDisabled={isDisabled} size='sm' />}
		</DeviceDropdown>
	)
})
