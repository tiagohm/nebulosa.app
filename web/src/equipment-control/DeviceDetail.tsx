import type { DeviceSummary, ManagedDeviceType } from 'api'
import type { ComponentType } from 'react'
import { useSnapshot } from 'valtio'
import { deviceState, switchDevice } from '../equipment/equipment'
import { PanelSection } from '../shell/ContextualPanel'
import { type EquipmentView, navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { SegmentedControl } from '../ui/SegmentedControl'
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
import { DEVICE_TYPE_LABELS, type DeviceGroup, groupConnected, groupTypes } from './groups'
import { IndiPropertiesPanel } from './indi/IndiPropertiesPanel'
import { OperationStatus } from './OperationStatus'
import { type InterfaceProps, Notice } from './parts'

// Detail of one physical device: its name, interfaces, and connection, with an explicit connect or
// disconnect command, then one of its views: the controls of each interface it offers, or the INDI properties
// its connection reports for it (the only view of a device no interface manages), chosen with a selector that
// is part of the URL; then its activity and its diagnostics. Controls are shown only for a connected
// device whose state the server reported, and only for what it reports it can do. Switching views never
// connects, disconnects, or stops anything.

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
	// View the route asks for; the device's controls when absent or when the device has no INDI properties.
	readonly view?: EquipmentView
}

// View shown in the detail of a device.
type DetailView = 'controls' | 'indi'

// Text of each view in the view selector.
const VIEW_LABELS: Readonly<Record<DetailView, string>> = { controls: 'Controls', indi: 'INDI Properties' }

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

// Controls of every interface of a managed device, once it is connected.
function DeviceControls({ group, primary }: { readonly group: DeviceGroup; readonly primary: DeviceSummary }) {
	if (!primary.connected) {
		return (
			<div className="border-b border-line-100 px-4 py-3">
				<Notice>Connect the device to control it. Showing a device never connects it.</Notice>
			</div>
		)
	}

	return group.devices.map((device) => <InterfaceSection key={device.id} device={device} />)
}

// Returns the connection of a device as text.
function connectionText(connected: boolean | undefined, pending?: 'connect' | 'disconnect') {
	if (pending) return pending === 'connect' ? 'Connecting' : 'Disconnecting'
	return connected === undefined ? 'Connection not reported' : connected ? 'Connected' : 'Disconnected'
}

// Detail of a device.
export function DeviceDetail({ group, view }: DeviceDetailProps) {
	const runtime = useSnapshot(deviceState)
	const { primary, indi } = group
	const pending = primary && runtime.pending[primary.id]
	const error = primary && runtime.errors[primary.id]
	const views: readonly DetailView[] = [...(primary ? ['controls' as const] : []), ...(indi ? ['indi' as const] : [])]
	const shown: DetailView = (view === 'indi' && indi) || !primary ? 'indi' : 'controls'

	function show(next: DetailView) {
		navigate(routeState, { workspace: 'equipment', device: group.id, view: next === 'indi' ? 'indi' : undefined })
	}

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-100 px-4 py-3">
				<Icon name={primary?.type ?? 'server'} className="text-ink-300" />
				<div className="flex min-w-0 flex-1 flex-col">
					<h2 className="m-0 truncate text-[15px] leading-[22px] font-medium text-ink-100">{group.name}</h2>
					<p className="m-0 text-xs text-ink-300">
						{groupTypes(group)} · {connectionText(groupConnected(group), pending)}
					</p>
				</div>
				{primary && (
					<Button variant="secondary" disabled={!!pending} onClick={() => void switchDevice(deviceState, primary.id, !primary.connected)}>
						{primary.connected ? 'Disconnect' : 'Connect'}
					</Button>
				)}
				{views.length > 1 && <SegmentedControl className="w-full" options={views} value={shown} format={(option) => VIEW_LABELS[option]} onChange={show} />}
			</header>
			{error && (
				<div className="border-b border-line-100 px-4 py-2">
					<Notice error>{error}</Notice>
				</div>
			)}
			{shown === 'indi' && indi ? <IndiPropertiesPanel connectionId={indi.connectionId} hardwareId={group.hardwareId} /> : primary && <DeviceControls group={group} primary={primary} />}
			<OperationStatus group={group} />
			{primary && <DeviceDiagnostics group={group} />}
		</div>
	)
}
