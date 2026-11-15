import type { DeviceSummary } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { useActiveServerId } from '../equipment/useEquipment'
import { deviceBusy, operationsState } from '../operations'
import { controlRuntime, watchControl } from './control'

// React binding of the control runtime: keeps it mirroring the active profile's server connection, for the
// Equipment Control page and the status bar alike, and tells the controls of a device when its commands wait.

// Watches the active profile's server connection while mounted, switching whenever the profile, its
// selected connection, or the server state changes. Leaving a connection sends nothing to its devices.
export function useWatchControl() {
	const serverId = useActiveServerId()

	useEffect(() => {
		watchControl(controlRuntime, serverId)
	}, [serverId])
}

// Returns whether the commands of a device wait: this tab has one in flight, or a running operation holds the device,
// whichever tab or service started it (a filter change, a slew, a capture, guiding), which the server would refuse as
// busy. The stops never wait, so their buttons do not use it.
export function useDeviceBusy(device: Pick<DeviceSummary, 'connectionId' | 'id'>): boolean {
	const control = useSnapshot(controlRuntime)
	const operations = useSnapshot(operationsState)
	return control.pending[device.id] !== undefined || deviceBusy(operations, device.connectionId, device.id)
}
