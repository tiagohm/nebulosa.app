import { useMolecule } from 'bunshi/react'
import type { Camera } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { CameraIris } from './MaterialDesignIcon'

export function CameraDropdown({ value, onValueChange }: Omit<DeviceDropdownProps<Camera>, 'items' | 'icon'>) {
	const equipment = useMolecule(EquipmentMolecule)
	const cameras = useSnapshot(equipment.state.devices.camera)

	return <DeviceDropdown icon={CameraIris} items={cameras} onValueChange={onValueChange} value={value} />
}
