import type { DeviceTypeMap } from '@shared/types'
import { equipmentStore } from '@stores/equipment.store'
import { useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'

export function useDevice<S extends { mount: VoidFunction; unmount: VoidFunction }, T extends keyof DeviceTypeMap>(type: T, id: string, storeFactory: (device: DeviceTypeMap[T]) => S) {
	const storeRef = useRef<S | undefined>(undefined)

	useEffect(() => storeRef.current?.mount(), [])

	const { length } = useSnapshot(equipmentStore.state[type]) // used only to rerender
	const device = length > 0 && (equipmentStore.state[type].find((e) => e.id === id) as DeviceTypeMap[T] | undefined)

	if (!device) {
		storeRef.current?.unmount()
		storeRef.current = undefined
		return null
	}

	const store = storeRef.current ?? storeFactory(device)
	storeRef.current = store

	return { device, store } as const
}
