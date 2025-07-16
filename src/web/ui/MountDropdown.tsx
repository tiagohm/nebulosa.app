import { useMolecule } from 'bunshi/react'
import type { Mount } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Telescope } from './MaterialDesignIcon'

export function MountDropdown({ value, onValueChange }: Omit<DeviceDropdownProps<Mount>, 'items' | 'icon'>) {
	const equipment = useMolecule(EquipmentMolecule)
	const mounts = useSnapshot(equipment.state.devices.mount)

	return <DeviceDropdown icon={Telescope} items={mounts} onValueChange={onValueChange} value={value} />
}
