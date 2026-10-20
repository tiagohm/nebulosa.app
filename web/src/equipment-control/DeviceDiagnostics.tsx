import type { DeviceSummary } from 'api'
import { useSnapshot } from 'valtio'
import { deviceState } from '../equipment/equipment'
import { operationsState, runningOn } from '../operations'
import { controlRuntime, deviceStateOf } from './control'
import { DEVICE_TYPE_LABELS, type DeviceGroup } from './groups'
import { Readout } from './parts'

// Read-only diagnostics of a physical device, collapsed by default: the identity of every interface, its
// driver, the capabilities it declares, the last errors, the operations holding it, and the raw state the
// server reports. Nothing here can change a device; it exists to compare what different drivers report.

export interface DeviceDiagnosticsProps {
	// Device whose diagnostics are shown.
	readonly group: DeviceGroup
}

// Returns the capability flags of a state (fields named can… or has…), in their order.
function capabilitiesOf(state: object): readonly (readonly [string, boolean])[] {
	return Object.entries(state).flatMap(([key, value]) => ((key.startsWith('can') || key.startsWith('has')) && typeof value === 'boolean' ? [[key, value] as const] : []))
}

// Diagnostics of one interface.
function InterfaceDiagnostics({ device }: { readonly device: DeviceSummary }) {
	const control = useSnapshot(controlRuntime)
	const runtime = useSnapshot(deviceState)
	const operations = useSnapshot(operationsState)
	const state = deviceStateOf(control.states, device.type, device.id)
	const capabilities = state ? capabilitiesOf(state) : []
	const running = runningOn(operations, device.connectionId, device.id)

	return (
		<div className="flex flex-col gap-1 border-t border-line-100 pt-2 first:border-t-0 first:pt-0">
			<p className="m-0 text-xs font-medium text-ink-100">{DEVICE_TYPE_LABELS[device.type]}</p>
			<Readout label="Device id">{device.id}</Readout>
			<Readout label="Hardware id">{device.hardwareId}</Readout>
			<Readout label="Connection id">{device.connectionId}</Readout>
			<Readout label="Interfaces">{device.interfaces.join(', ')}</Readout>
			<Readout label="Driver">{device.driver.executable || '—'}</Readout>
			<Readout label="Driver version">{device.driver.version || '—'}</Readout>
			<Readout label="Capabilities">{capabilities.length > 0 ? capabilities.map(([key, value]) => `${key}: ${value ? 'yes' : 'no'}`).join(', ') : state ? 'none declared' : 'not reported yet'}</Readout>
			<Readout label="Operations">{running.length > 0 ? running.map((operation) => `${operation.kind} (${operation.operationId})`).join(', ') : 'none'}</Readout>
			<Readout label="Last error">{control.errors[device.id] ?? runtime.errors[device.id] ?? 'none'}</Readout>
			{state && <pre className="m-0 max-h-60 overflow-auto rounded-sm bg-base-200 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-ink-200">{JSON.stringify(state, undefined, 2)}</pre>}
		</div>
	)
}

// Collapsible diagnostics of a device.
export function DeviceDiagnostics({ group }: DeviceDiagnosticsProps) {
	return (
		<details className="border-b border-line-100 px-4 py-3 text-[13px] leading-5 text-ink-200">
			<summary className="cursor-pointer text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase select-none">Diagnostics</summary>
			<div className="mt-2 flex flex-col gap-2">
				{group.devices.map((device) => (
					<InterfaceDiagnostics key={device.id} device={device} />
				))}
			</div>
		</details>
	)
}
