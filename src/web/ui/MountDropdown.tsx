import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Mount } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'

export const MountDropdown = memo(({ value, onValueChange }: Omit<DeviceDropdownProps<Mount>, 'items' | 'icon'>) => {
	const equipment = useMolecule(EquipmentMolecule)
	const mounts = useSnapshot(equipment.state.devices.mount)

	return <DeviceDropdown icon={Icons.Telescope} items={mounts} onValueChange={onValueChange} value={value} />
})
