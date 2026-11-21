import type { DeviceSummary } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { useActiveServerId } from '../equipment/useEquipment'
import { deviceBusy, OPERATION_LABELS, operationsState, runningOn } from '../operations'
import { controlRuntime, watchControl } from './control'

// React binding of the control runtime: keeps it mirroring the active profile's server connection, for the
// Equipment Control page and the status bar alike, and tells the controls of a device when its commands wait and why.

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

// Returns why the commands of a device wait, as the tooltip of a disabled command: the command this tab has in flight,
// or the oldest running operation holding the device; undefined when they do not wait.
export function useBusyReason(device: Pick<DeviceSummary, 'connectionId' | 'id'>): string | undefined {
	const control = useSnapshot(controlRuntime)
	const operations = useSnapshot(operationsState)
	const pending = control.pending[device.id]
	if (pending !== undefined) return `Waiting for the answer to ${pending}`
	const running = runningOn(operations, device.connectionId, device.id)[0]
	return running && `${OPERATION_LABELS[running.kind][1]} is using this device`
}

// Returns the first reason a command is unavailable among checks in order of precedence, each a reason or false when
// it does not apply; undefined when the command is available.
export function firstReason(...checks: readonly (string | false | undefined)[]): string | undefined {
	return checks.find((check): check is string => typeof check === 'string' && check !== '')
}
