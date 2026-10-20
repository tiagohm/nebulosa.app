import type { ManagedDeviceType } from 'api'
import type { ComponentType } from 'react'
import { useSnapshot } from 'valtio'
import { deviceState, switchDevice } from '../equipment/equipment'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { controlRuntime, deviceStateOf } from './control'
import { CameraControls } from './controls/CameraControls'
import { CoverControls } from './controls/CoverControls'
import { DewHeaterControls } from './controls/DewHeaterControls'
import { DomeControls } from './controls/DomeControls'
import { FilterWheelControls } from './controls/FilterWheelControls'
import { FlatPanelControls } from './controls/FlatPanelControls'
import { FocuserControls } from './controls/FocuserControls'
import { GuideOutputControls } from './controls/GuideOutputControls'
import { MountControls } from './controls/MountControls'
import { RotatorControls } from './controls/RotatorControls'
import { DeviceDiagnostics } from './DeviceDiagnostics'
import { DEVICE_TYPE_LABELS, type DeviceGroup, groupTypes } from './groups'
import { OperationStatus } from './OperationStatus'
import { type InterfaceProps, Notice } from './parts'

// Detail of one physical device: its name, interfaces, and connection, with an explicit connect or
// disconnect command, the controls of each interface it offers, its activity, and its diagnostics.
// Controls are shown only for a connected device whose state the server reported, and only for what it
// reports it can do.

// Controls of each interface type.
const CONTROLS: Readonly<Record<ManagedDeviceType, ComponentType<InterfaceProps>>> = {
	camera: CameraControls,
	mount: MountControls,
	guideOutput: GuideOutputControls,
	focuser: FocuserControls,
	wheel: FilterWheelControls,
	rotator: RotatorControls,
	cover: CoverControls,
	flatPanel: FlatPanelControls,
	dewHeater: DewHeaterControls,
	dome: DomeControls,
}

export interface DeviceDetailProps {
	// Device shown.
	readonly group: DeviceGroup
}

// Controls of one interface, or a note while its state is not known yet.
function InterfaceSection({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const Controls = CONTROLS[device.type]
	const label = DEVICE_TYPE_LABELS[device.type]

	if (!deviceStateOf(control.states, device.type, device.id)) {
		return (
			<PanelSection title={label}>
				<Notice>Waiting for the state of the {label.toLowerCase()}…</Notice>
			</PanelSection>
		)
	}

	return <Controls device={device} />
}

// Detail of a device.
export function DeviceDetail({ group }: DeviceDetailProps) {
	const runtime = useSnapshot(deviceState)
	const { primary } = group
	const pending = runtime.pending[primary.id]
	const error = runtime.errors[primary.id]

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-100 px-4 py-3">
				<Icon name={primary.type} className="text-ink-300" />
				<div className="flex min-w-0 flex-1 flex-col">
					<h2 className="m-0 truncate text-[15px] leading-[22px] font-medium text-ink-100">{group.name}</h2>
					<p className="m-0 text-xs text-ink-300">
						{groupTypes(group)} · {pending ? (pending === 'connect' ? 'Connecting' : 'Disconnecting') : primary.connected ? 'Connected' : 'Disconnected'}
					</p>
				</div>
				<Button variant="secondary" disabled={!!pending} onClick={() => void switchDevice(deviceState, primary.id, !primary.connected)}>
					{primary.connected ? 'Disconnect' : 'Connect'}
				</Button>
			</header>
			{error && (
				<div className="border-b border-line-100 px-4 py-2">
					<Notice error>{error}</Notice>
				</div>
			)}
			{primary.connected ? (
				group.devices.map((device) => <InterfaceSection key={device.id} device={device} />)
			) : (
				<div className="border-b border-line-100 px-4 py-3">
					<Notice>Connect the device to control it. Showing a device never connects it.</Notice>
				</div>
			)}
			<OperationStatus group={group} />
			<DeviceDiagnostics group={group} />
		</div>
	)
}
