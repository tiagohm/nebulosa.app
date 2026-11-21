import type { DeviceSummary, ManagedDeviceType } from 'api'
import type { ComponentType } from 'react'
import { useSnapshot } from 'valtio'
import { deviceState, switchDevice } from '../equipment/equipment'
import { OPERATION_LABELS, operationsState, runningOn } from '../operations'
import { PanelSection } from '../shell/ContextualPanel'
import { type EquipmentView, navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { ConfirmButton } from '../ui/ConfirmButton'
import { Icon } from '../ui/Icon'
import { Notice } from '../ui/Notice'
import { SegmentedControl } from '../ui/SegmentedControl'
import { controlRuntime, deviceStateOf, stopCommand } from './control'
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
import { focuserBacklashKey, focuserBacklashRuntime } from './focuserBacklash'
import { DEVICE_TYPE_LABELS, type DeviceGroup, groupConnected, groupTypes } from './groups'
import { disconnectWarningOf, readoutOf, stopsOf } from './header'
import { IndiMessagesPanel } from './indi/IndiMessagesPanel'
import { IndiPropertiesPanel } from './indi/IndiPropertiesPanel'
import { OperationStatus } from './OperationStatus'
import type { InterfaceProps } from './parts'

// Detail of one physical device. Its header stays at the top while the page scrolls: its name, interfaces, and
// connection with an explicit connect or disconnect command (a disconnect asks first while the device is in use), the
// live reading of its main interface with the stop of every motion it reports, its activity, and the selector of its
// views. Then one of its views: the controls of each interface it offers, the INDI properties its connection reports
// for it (the first view of a device no interface manages), or, on an INDI server, the messages its driver sent,
// chosen with a selector that is part of the URL; then its diagnostics. Controls are shown only for a connected device
// whose state the server reported, and only for what it reports it can do. Switching views never connects,
// disconnects, or stops anything.

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
	// View the route asks for; the device's first view when absent or when the device has no such view.
	readonly view?: EquipmentView
	// Whether the connection of the device is an INDI server, whose drivers send messages.
	readonly messages: boolean
}

// View shown in the detail of a device.
type DetailView = 'controls' | EquipmentView

// Text of each view in the view selector.
const VIEW_LABELS: Readonly<Record<DetailView, string>> = { controls: 'Controls', indi: 'INDI Properties', messages: 'Messages' }

// Why a device lacks a view the route asks for.
const MISSING_VIEW: Readonly<Record<EquipmentView, string>> = {
	indi: 'This device reports no INDI properties. Showing its first view.',
	messages: 'Driver messages exist only for the devices of an INDI server. Showing its first view.',
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

// Controls of every interface of a managed device, once it is connected.
function DeviceControls({ group, primary }: { readonly group: DeviceGroup; readonly primary: DeviceSummary }) {
	if (!primary.connected) {
		return (
			<div className="border-b border-line-100 px-4 py-3">
				<Notice>{group.name} is disconnected. Connect it to read its state and control it.</Notice>
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

// Connect or disconnect command of a device. Connecting is the one primary action of a disconnected device; a
// disconnect asks first while the device is in use, naming what it would interrupt.
function ConnectionButton({ group, primary }: { readonly group: DeviceGroup; readonly primary: DeviceSummary }) {
	const runtime = useSnapshot(deviceState)
	const control = useSnapshot(controlRuntime)
	const operations = useSnapshot(operationsState)
	const pending = runtime.pending[primary.id]
	const tooltip = pending && `Waiting for the answer to ${pending === 'connect' ? 'Connect' : 'Disconnect'}`
	const disconnect = () => void switchDevice(deviceState, primary.id, false)

	if (!primary.connected) {
		return (
			<Button disabled={!!pending} title={tooltip} onClick={() => void switchDevice(deviceState, primary.id, true)}>
				Connect
			</Button>
		)
	}

	const running = group.devices.flatMap((device) => runningOn(operations, device.connectionId, device.id))[0]
	const warning = disconnectWarningOf(group, control.states, running && OPERATION_LABELS[running.kind][1])

	return warning ? (
		<ConfirmButton title={`Disconnect ${group.name}?`} message={warning} confirmLabel="Disconnect" disabled={!!pending} tooltip={tooltip} onConfirm={disconnect}>
			Disconnect
		</ConfirmButton>
	) : (
		<Button variant="secondary" disabled={!!pending} title={tooltip} onClick={disconnect}>
			Disconnect
		</Button>
	)
}

// Live reading of the main interface of a connected device, and the stop of every motion its interfaces report. The
// row keeps its height whether or not a stop is shown, so the controls below never shift when a motion starts.
function DeviceReadout({ group, primary }: { readonly group: DeviceGroup; readonly primary: DeviceSummary }) {
	const control = useSnapshot(controlRuntime)
	const backlash = useSnapshot(focuserBacklashRuntime)
	const offset = primary.type === 'focuser' ? (backlash.states[focuserBacklashKey(primary.connectionId, primary.id)]?.offset ?? 0) : 0
	const readout = readoutOf(primary, control.states, offset)
	const stops = stopsOf(group, control.states)

	if (!readout && stops.length === 0) return null

	return (
		<div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2">
			{readout && (
				<div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
					<span className="text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{readout.value}</span>
					{readout.caption && <span className="text-sm leading-5 text-ink-300 tabular-nums">{readout.caption}</span>}
				</div>
			)}
			{stops.length > 0 && (
				<div className="ml-auto flex flex-wrap gap-2">
					{stops.map((stop) => (
						<Button key={stop.deviceId} title={`Stop the motion of the ${stop.label.toLowerCase()} now`} onClick={() => void stopCommand(controlRuntime, { type: stop.type, deviceId: stop.deviceId, action: 'stop' })}>
							{stops.length === 1 ? 'Abort' : `Abort ${stop.label}`}
						</Button>
					))}
				</div>
			)}
		</div>
	)
}

// Detail of a device.
export function DeviceDetail({ group, view, messages }: DeviceDetailProps) {
	const runtime = useSnapshot(deviceState)
	const { primary, indi } = group
	const pending = primary && runtime.pending[primary.id]
	const views: readonly DetailView[] = [...(primary ? ['controls' as const] : []), ...(indi ? ['indi' as const] : []), ...(indi && messages ? ['messages' as const] : [])]
	// The view the route asks for when the device has it, otherwise its first one.
	const shown: DetailView = view !== undefined && views.includes(view) ? view : (views[0] ?? 'controls')
	const missing = view !== undefined && !views.includes(view) ? MISSING_VIEW[view] : undefined

	function show(next: DetailView) {
		navigate(routeState, { workspace: 'equipment', device: group.id, view: next === 'controls' ? undefined : next })
	}

	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<header className="sticky top-0 z-10 flex flex-col gap-3 border-b border-line-100 bg-base-100 px-4 py-3">
				<div className="flex items-center gap-3">
					<Icon name={primary?.type ?? 'server'} className="flex-none text-ink-300" />
					<div className="flex min-w-0 flex-1 flex-col">
						<h2 className="m-0 truncate leading-6 font-medium text-ink-100">{group.name}</h2>
						<p className="m-0 truncate text-sm leading-5 text-ink-300">
							{groupTypes(group)} · {connectionText(groupConnected(group), pending)}
						</p>
					</div>
					{primary && <ConnectionButton group={group} primary={primary} />}
				</div>
				{primary?.connected && <DeviceReadout group={group} primary={primary} />}
				<OperationStatus group={group} />
				{views.length > 1 && <SegmentedControl className="w-full" options={views} value={shown} format={(option) => VIEW_LABELS[option]} onChange={show} />}
			</header>
			{missing && (
				<div className="border-b border-line-100 px-4 py-2">
					<Notice>{missing}</Notice>
				</div>
			)}
			{shown === 'messages' && indi ? (
				<IndiMessagesPanel connectionId={indi.connectionId} hardwareId={group.hardwareId} name={group.name} />
			) : shown === 'indi' && indi ? (
				<IndiPropertiesPanel connectionId={indi.connectionId} hardwareId={group.hardwareId} />
			) : (
				primary && <DeviceControls group={group} primary={primary} />
			)}
			{primary && <DeviceDiagnostics group={group} />}
		</div>
	)
}
