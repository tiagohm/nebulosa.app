import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Camera } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import { DeviceDropdown, type DeviceDropdownProps } from '@/ui/DeviceDropdown'
import { Icons } from './Icon'

export const CameraDropdown = memo(({ value, onValueChange }: Omit<DeviceDropdownProps<Camera>, 'items' | 'icon'>) => {
	const equipment = useMolecule(EquipmentMolecule)
	const cameras = useSnapshot(equipment.state.camera)

	return <DeviceDropdown icon={Icons.Camera} items={cameras} onValueChange={onValueChange} value={value} />
})
