import type { DeviceSummary, MountRemoteProtocol, MountRemoteServer } from 'api'
import { cn } from 'cn'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { deviceState, type RoleStatus } from '../../equipment/equipment'
import { useRoleDevice } from '../../equipment/useEquipment'
import { activeProfile, mountRemoteBinding, profileCamera, profileState, setMountRemoteBinding } from '../../profile/profile'
import { type CameraIdentity, MOUNT_REMOTE_PROTOCOLS } from '../../profile/schema'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { NumberInput } from '../../ui/NumberInput'
import { TextInput } from '../../ui/TextInput'
import { clientKey, disconnectRemoteClient, formatEndpoint, isLoopback, MOUNT_REMOTE_PROTOCOL_LABELS, mountRemoteControlState, remoteKey, startRemoteServer, stopRemoteServer } from './listeners'

// Mount Remote Control tool: exposes the MOUNT of the active profile's Equipment Setup to planetarium programs over the
// LX200 and Stellarium telescope protocols, one independent listener per protocol, and lists the clients connected to
// each, which can be disconnected one by one. The mount is never chosen here: a missing or unavailable one is
// reported and Start is disabled, never replaced by another mount. The listeners are the server's, so changing
// profile, setup, or workspace, or closing the tab, leaves them running for the mount they were started for; a
// stopped listener shows the host and port entered last for that mount (remembered by the profile when started), a
// running one the binding it actually has.

// Why a listener cannot be started, for each state of the MOUNT role that is not connected.
const BLOCKERS: Readonly<Record<Exclude<RoleStatus, 'connected'>, string>> = {
	notSelected: 'No mount is assigned in Equipment Setup.',
	unavailable: 'The assigned mount is not available on the selected connection.',
	disconnected: 'The assigned mount is disconnected.',
	connecting: 'The assigned mount is connecting.',
	disconnecting: 'The assigned mount is disconnecting.',
	error: 'The assigned mount failed to connect.',
}

// What each protocol is for.
const DESCRIPTIONS: Readonly<Record<MountRemoteProtocol, string>> = {
	lx200: 'For programs that drive a Meade LX200 over TCP, such as SkySafari or Stellarium in LX200 mode.',
	stellarium: "For Stellarium's Telescope Control plugin, connected as an external software or remote computer telescope.",
}

// Mount Remote Control tool.
export function MountRemoteControl() {
	const mount = useRoleDevice('MOUNT')
	const profile = activeProfile(useSnapshot(profileState))
	const device = mount.device
	const blocker = mount.status === 'connected' ? undefined : BLOCKERS[mount.status]
	const identity = profileCamera(profile, device?.id)

	return (
		<WorkspaceLayout workspace="tools" title="Mount Remote Control">
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] leading-5">
						<span className="text-ink-300">Mount</span>
						<span className="min-w-0 truncate text-ink-100">
							<DeviceLink device={device} fallback={mount.status === 'notSelected' ? 'None selected' : 'Unavailable'} />
						</span>
						{blocker && <span className="text-ink-300">{blocker}</span>}
						{mount.status === 'notSelected' && (
							<Button variant="secondary" onClick={() => (deviceState.open = true)}>
								Equipment Setup
							</Button>
						)}
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						{MOUNT_REMOTE_PROTOCOLS.map((protocol) => (
							<ProtocolPanel key={`${profile.id}:${device?.connectionId}:${device?.id}:${protocol}`} protocol={protocol} device={device} identity={identity} blocker={blocker} />
						))}
					</div>
					<p className="m-0 text-xs leading-4 text-ink-300">
						Clients are not authenticated: anyone who can reach a listener can move the mount. A goto from a client runs as a mount operation and goes on if the client disconnects; its manual motion stops when it disconnects. An LX200 client may set the mount's site (latitude and longitude, such as a
						phone's GPS position); time and slew rate commands are refused or ignored.
					</p>
				</div>
			</div>
		</WorkspaceLayout>
	)
}

interface ProtocolPanelProps {
	// Protocol of the listener.
	readonly protocol: MountRemoteProtocol
	// Mount the listener exposes; absent when the role has none on the watched connection.
	readonly device?: DeviceSummary
	// Saved connection and mount the entered binding is remembered for; absent when the profile cannot keep one.
	readonly identity?: CameraIdentity
	// Why a listener cannot be started now, if it cannot.
	readonly blocker?: string
}

// Listener of one protocol for the mount: its binding, Start or Stop, and its connected clients.
function ProtocolPanel({ protocol, device, identity, blocker }: ProtocolPanelProps) {
	const state = useSnapshot(mountRemoteControlState)
	const profile = activeProfile(useSnapshot(profileState))
	const saved = mountRemoteBinding(profile.settings, identity, protocol)
	const [host, setHost] = useState(saved.host)
	const [port, setPort] = useState(saved.port)
	const key = device ? remoteKey(device.connectionId, device.id, protocol) : undefined
	const server = key ? state.servers[key] : undefined
	const pending = key ? state.pending[key] : undefined
	const error = key ? state.errors[key] : undefined
	const label = MOUNT_REMOTE_PROTOCOL_LABELS[protocol]
	const shownHost = server?.host ?? host

	function start() {
		if (!device) return
		const binding = { host: host.trim(), port }
		setMountRemoteBinding(profileState, identity, protocol, binding)
		void startRemoteServer(mountRemoteControlState, device.connectionId, device.id, protocol, binding)
	}

	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<div className="flex items-center justify-between gap-3">
				<h2 className="m-0 text-sm font-semibold text-ink-100">{label}</h2>
				<span className={cn('text-xs font-medium', server ? 'text-success' : 'text-ink-300')}>{server ? 'Running' : 'Stopped'}</span>
			</div>
			<p className="m-0 text-xs leading-4 text-ink-300">{DESCRIPTIONS[protocol]}</p>
			<div className="grid grid-cols-[minmax(0,1fr)_10rem] gap-3">
				<TextInput label="Host" value={shownHost} disabled={!!server || !!pending} onChange={(event) => setHost(event.target.value)} spellCheck={false} />
				<NumberInput label="Port" value={server?.port ?? port} min={1} max={65535} disabled={!!server || !!pending} onChange={setPort} />
			</div>
			{!isLoopback(shownHost) && <p className="m-0 text-xs leading-4 text-accent">Reachable from the network without authentication. Use 127.0.0.1 to accept only this computer.</p>}
			{error && <p className="m-0 text-xs leading-4 text-danger">{error}</p>}
			<div className="flex">
				{server ? (
					<Button variant="secondary" disabled={!!pending} onClick={() => void stopRemoteServer(mountRemoteControlState, server.connectionId, server.deviceId, protocol)}>
						{pending === 'stop' ? 'Stopping…' : 'Stop'}
					</Button>
				) : (
					<Button disabled={!device || !!blocker || !!pending || !host.trim()} onClick={start}>
						{pending === 'start' ? 'Starting…' : 'Start'}
					</Button>
				)}
			</div>
			<ClientList server={server} />
		</section>
	)
}

// Clients connected to a listener, each with its address and a Disconnect button.
function ClientList({ server }: { readonly server?: MountRemoteServer }) {
	const state = useSnapshot(mountRemoteControlState)
	const clients = server?.clients ?? []

	return (
		<div className="flex flex-col gap-2 border-t border-line-100 pt-3">
			<h3 className="m-0 text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase">Clients ({clients.length})</h3>
			{server && clients.length > 0 ? (
				<ul className="m-0 flex list-none flex-col gap-1 p-0">
					{clients.map((client) => {
						const disconnecting = state.disconnecting[clientKey(remoteKey(server.connectionId, server.deviceId, server.protocol), client.id)]

						return (
							<li key={client.id} className="flex items-center justify-between gap-3 text-[13px] leading-5">
								<span className="min-w-0 truncate font-mono text-ink-100">{formatEndpoint(client.ip, client.port)}</span>
								<Button variant="secondary" disabled={disconnecting} onClick={() => void disconnectRemoteClient(mountRemoteControlState, server, client.id)}>
									{disconnecting ? 'Disconnecting…' : 'Disconnect'}
								</Button>
							</li>
						)
					})}
				</ul>
			) : (
				<p className="m-0 text-xs leading-4 text-ink-300">No clients connected</p>
			)}
		</div>
	)
}
