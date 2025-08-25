import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Thermometer } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'

export const ThermometerDropdown = memo(({ value, onValueChange }: Omit<DeviceDropdownProps<Thermometer>, 'items' | 'icon'>) => {
	const equipment = useMolecule(EquipmentMolecule)
	const thermometers = useSnapshot(equipment.state.thermometer)

	return <DeviceDropdown icon={Icons.Thermometer} items={thermometers} onValueChange={onValueChange} value={value} />
})
