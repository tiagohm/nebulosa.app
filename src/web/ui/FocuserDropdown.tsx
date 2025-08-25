import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Focuser } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'

export const FocuserDropdown = memo(({ value, onValueChange }: Omit<DeviceDropdownProps<Focuser>, 'items' | 'icon'>) => {
	const equipment = useMolecule(EquipmentMolecule)
	const focusers = useSnapshot(equipment.state.focuser)

	return <DeviceDropdown icon={Icons.Focuser} items={focusers} onValueChange={onValueChange} value={value} />
})
