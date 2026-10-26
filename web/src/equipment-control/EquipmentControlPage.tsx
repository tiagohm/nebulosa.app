import { useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { connectionState } from '../connection/connection'
import { useSelectedConnection } from '../connection/useSelectedConnection'
import { useWatchedDevices } from '../equipment/useEquipment'
import { navigate, routeState } from '../shell/route'
import { useMediaQuery, WIDE_SCREEN } from '../shell/useMediaQuery'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { ConnectionHeader } from './ConnectionHeader'
import { controlRuntime } from './control'
import { DeviceDetail } from './DeviceDetail'
import { DeviceSelect, DeviceSidebar } from './DeviceSidebar'
import { type DeviceGroup, findGroup, groupDevices } from './groups'
import { useWatchedIndiDevices } from './indi/useIndi'
import { Notice } from './parts'

// Equipment Control page (Management → Equipment Control): manual control of every device the active
// profile's connection discovered, whether or not the equipment setup assigns it a role, and every device its
// INDI server reports, even one Nebulosa does not manage, which shows its INDI properties only. The device shown
// is part of the URL, so a reload shows it again; a device of another connection is never shown in its
// place. Opening, leaving, or switching devices on this page never connects, disconnects, or stops
// anything, and every command goes through the server.

// Opens the connections modal.
function openConnections() {
	connectionState.open = true
}

// Button opening the connections modal.
const CONNECTIONS_ACTION = (
	<Button variant="secondary" onClick={openConnections}>
		Open Connections
	</Button>
)

// Equipment Control page.
export function EquipmentControlPage() {
	const { route } = useSnapshot(routeState)
	const { connections } = useSnapshot(connectionState)
	const { connection, status } = useSelectedConnection()
	const runtime = useWatchedDevices()
	const indiDevices = useWatchedIndiDevices()
	const control = useSnapshot(controlRuntime)
	const wide = useMediaQuery(WIDE_SCREEN)
	const groups = useMemo(() => groupDevices(runtime.devices, indiDevices), [runtime.devices, indiDevices])
	const deviceId = route.workspace === 'equipment' ? route.device : undefined
	const view = route.workspace === 'equipment' ? route.view : undefined
	const selected = findGroup(groups, deviceId)

	function select(group: DeviceGroup) {
		// A device no interface manages only has its INDI properties.
		navigate(routeState, { workspace: 'equipment', device: group.id, view: group.primary ? undefined : 'indi' })
	}

	function body() {
		if (connections.length === 0) return <EmptyState title="No connections" description="Add the server of your equipment in Management → Connections." action={CONNECTIONS_ACTION} />
		if (!connection) return <EmptyState title="No connection selected" description="Choose the connection of this profile in Management → Connections." action={CONNECTIONS_ACTION} />
		if (status === 'connecting') return <EmptyState title={`Connecting to ${connection.name}…`} />
		if (status === 'disconnected') return <EmptyState title={`${connection.name} is not connected`} description="Connect it in Management → Connections. This page never opens or closes a connection." action={CONNECTIONS_ACTION} />
		if (groups.length === 0) return <EmptyState title={runtime.loading ? 'Loading devices…' : 'No devices discovered'} description={runtime.loading ? undefined : `${connection.name} has not reported any device yet.`} />

		const detail = selected ? (
			<DeviceDetail key={selected.hardwareId} group={selected} view={view} />
		) : (
			<EmptyState title={deviceId ? 'Device not found' : 'No device selected'} description={deviceId ? `${connection.name} has no such device. It may have been removed.` : 'Select a device to see its state and controls.'} />
		)

		return wide ? (
			<div className="flex min-h-0 flex-1">
				<DeviceSidebar groups={groups} runtime={runtime} selected={selected} onSelect={select} />
				{detail}
			</div>
		) : (
			<div className="flex min-h-0 flex-1 flex-col">
				<DeviceSelect groups={groups} runtime={runtime} selected={selected} onSelect={select} />
				{detail}
			</div>
		)
	}

	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<ConnectionHeader />
			{control.loadError && status === 'connected' && (
				<div className="flex-none border-b border-line-100 px-4 py-2">
					<Notice error>The device states could not be loaded: {control.loadError}</Notice>
				</div>
			)}
			<div className="relative flex min-h-0 flex-1 flex-col">{body()}</div>
		</section>
	)
}
