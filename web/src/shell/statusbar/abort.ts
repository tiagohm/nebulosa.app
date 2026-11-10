import { type AutoFocusRuntime, stopAutoFocus } from '../../camera/autofocus'
import { abortCapture, type CaptureRuntime, cameraKey, stopCapture } from '../../camera/capture'
import { type DarkLibraryWizardRuntime, stopDarkLibraryWizard } from '../../camera/darklibrarywizard'
import { abortDarv, type DarvRuntime } from '../../camera/darv'
import { type FlatWizardRuntime, stopFlatWizard } from '../../camera/flatwizard'
import { type GuidingRuntime, stopGuidingSession } from '../../camera/guiding'
import { type IPolarRuntime, stopIPolar } from '../../camera/ipolar'
import { stopTargetCentering, type TargetCenteringRuntime } from '../../camera/targetcentering'
import { stopTppa, type TppaRuntime } from '../../camera/tppa'
import type { ConnectionState } from '../../connection/connection'
import { type ControlRuntime, stopCommand, watchedDeviceState } from '../../equipment-control/control'
import { type DeviceState, roleDevice } from '../../equipment/equipment'
import { activeServerIdOf } from '../../equipment/useEquipment'
import { type ApiFetch, browserFetch } from '../../http'
import { type MountPointingRuntime, stopMountPointing } from '../../mountpointing/mountpointing'
import type { NotificationsState } from '../../notifications/notifications'
import type { OperationsState } from '../../operations'
import { activeProfile, activeSetup, type ProfileState } from '../../profile/profile'
import { type Interruption, MOUNT_MOTION_ID, mountAbortTarget, operationInterruption, scopedRunningOperations } from './selectors'

// Aborts of the status bar: one for each running operation of the active profile's server connection, through the
// distinct command that interrupts it, and one for a motion of the profile's mount that no operation holds. A button is
// rendered from snapshots, which may be a render behind a profile, connection, or role switch, so the click decides
// again from the live stores and sends the command only for what is still running there. An Abort touches that one
// operation, and it never shows it as stopped: its state and operation events remain the evidence.

// Live stores the Abort decides from.
export interface MountAbortStores {
	// Saved connections and the connections the server holds open.
	readonly connections: Pick<ConnectionState, 'connections' | 'servers'>
	// Profiles and the active one.
	readonly profiles: Pick<ProfileState, 'profiles' | 'activeId'>
	// Devices of the watched connection.
	readonly devices: Pick<DeviceState, 'watched' | 'devices'>
	// Control states of the watched connection, which also records a failed stop.
	readonly control: ControlRuntime
	// Operations of the server.
	readonly operations: Pick<OperationsState, 'operations'>
	// State of the event socket.
	readonly notifications: Pick<NotificationsState, 'server'>
}

// Stops the motion of the active profile's mount when it can still be aborted. Does nothing, and resolves false,
// when the profile has no mount, it belongs to another connection than the one mirrored, it is not moving, cannot
// abort, or the event socket is not online. Resolves true when the server confirmed the stop; a refused stop is
// recorded in the control store's errors of the mount.
export async function abortProfileMount(stores: MountAbortStores, request: ApiFetch = browserFetch): Promise<boolean> {
	const { connections, profiles, devices, control, operations, notifications } = stores
	if (profiles.profiles.length === 0) return false

	const serverId = activeServerIdOf(connections, profiles)
	const mount = serverId !== undefined && devices.watched === serverId ? roleDevice(activeSetup(activeProfile(profiles)), 'MOUNT', devices) : undefined
	const state = watchedDeviceState(control, 'mount', mount)
	const target = mountAbortTarget({ link: notifications.server, serverId, watched: control.watched, mount, state, operations: scopedRunningOperations(operations.operations, serverId) })

	return target ? await stopCommand(control, { type: 'mount', deviceId: target.deviceId, action: 'stop' }, request) : false
}

// Live stores an Abort of an operation decides from.
export interface OperationAbortStores extends MountAbortStores {
	// Capture sessions of the cameras.
	readonly captures: CaptureRuntime
	// Sessions of the tools, by camera.
	readonly guiding: GuidingRuntime
	readonly autoFocus: AutoFocusRuntime
	readonly tppa: TppaRuntime
	readonly ipolar: IPolarRuntime
	readonly darv: DarvRuntime
	readonly flatWizard: FlatWizardRuntime
	readonly darkLibraryWizard: DarkLibraryWizardRuntime
	readonly targetCentering: TargetCenteringRuntime
	readonly mountPointing: MountPointingRuntime
}

// Sends an interruption and returns why it was refused, undefined when it was not. Each command records its failure in
// the store of its tool.
async function interrupt(interruption: Interruption, stores: OperationAbortStores, request: ApiFetch): Promise<string | undefined> {
	if (interruption.type === 'device') {
		const { device, deviceId } = interruption
		await stopCommand(stores.control, { type: device, deviceId, action: 'stop' }, request)
		return stores.control.errors[deviceId]
	}

	if (interruption.type === 'capture') {
		const { connectionId, deviceId } = interruption.camera
		await (interruption.abort ? abortCapture : stopCapture)(stores.captures, connectionId, deviceId, interruption.sessionId, request)
		return stores.captures.errors[cameraKey(connectionId, deviceId)]
	}

	const { tool, session } = interruption
	const key = cameraKey(session.camera.connectionId, session.camera.deviceId)

	switch (tool) {
		case 'guiding':
			await stopGuidingSession(stores.guiding, session, request)
			return stores.guiding.errors[key]
		case 'autoFocus':
			await stopAutoFocus(stores.autoFocus, session, request)
			return stores.autoFocus.errors[key]
		case 'tppa':
			await stopTppa(stores.tppa, session, request)
			return stores.tppa.errors[key]
		case 'ipolar':
			await stopIPolar(stores.ipolar, session, request)
			return stores.ipolar.errors[key]
		case 'darv':
			await abortDarv(stores.darv, session, request)
			return stores.darv.errors[key]
		case 'flatWizard':
			await stopFlatWizard(stores.flatWizard, session, request)
			return stores.flatWizard.errors[key]
		case 'darkLibraryWizard':
			await stopDarkLibraryWizard(stores.darkLibraryWizard, session, request)
			return stores.darkLibraryWizard.errors[key]
		case 'targetCentering':
			await stopTargetCentering(stores.targetCentering, session, request)
			return stores.targetCentering.errors[key]
		case 'mountPointing':
			await stopMountPointing(stores.mountPointing, session, request)
			return stores.mountPointing.errors[key]
	}
}

// Interrupts one operation of the status bar by its id, MOUNT_MOTION_ID being the motion no operation holds. Does
// nothing, and resolves false, when the operation is no longer running on the active server connection or can no longer
// be interrupted. Resolves true when the server accepted the command; a refused one is recorded in the control store's
// errors of the device, so it shows as a device failure of the bar.
export async function abortOperation(id: string, stores: OperationAbortStores, request: ApiFetch = browserFetch): Promise<boolean> {
	if (id === MOUNT_MOTION_ID) return await abortProfileMount(stores, request)
	if (stores.profiles.profiles.length === 0) return false

	const operation = scopedRunningOperations(stores.operations.operations, activeServerIdOf(stores.connections, stores.profiles)).find((candidate) => candidate.operationId === id)
	const interruption = operation && operationInterruption(operation, { ...stores, link: stores.notifications.server })
	if (!interruption) return false

	const error = await interrupt(interruption, stores, request)
	if (!error) return true

	if (interruption.type !== 'device') stores.control.errors[interruption.type === 'capture' ? interruption.camera.deviceId : interruption.session.camera.deviceId] = error
	return false
}
