import type { DeviceSummary, MountRemoteProtocol, MountRemoteServer } from 'api'
import { cn } from 'cn'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { MOUNT_ROLE_BLOCKERS } from '../../equipment/equipment'
import { EquipmentSetupButton } from '../../equipment/EquipmentSetupButton'
import { useRoleDevice } from '../../equipment/useEquipment'
import { activeProfile, mountRemoteBinding, profileCamera, profileState, setMountRemoteBinding } from '../../profile/profile'
import { type CameraIdentity, MOUNT_REMOTE_PROTOCOLS } from '../../profile/schema'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SectionHeading } from '../../ui/SectionHeading'
import { StatusBadge } from '../../ui/StatusBadge'
import { TextInput } from '../../ui/TextInput'
import { clientKey, connectEndpoints, disconnectRemoteClient, formatEndpoint, isLoopback, MOUNT_REMOTE_PROTOCOL_LABELS, mountRemoteControlState, remoteKey, startRemoteServer, stopRemoteServer } from './listeners'

// Mount Remote Control tool: exposes the MOUNT of the active profile's Equipment Setup to planetarium programs over the
// LX200 and Stellarium telescope protocols, one independent listener per protocol, each in a card of its own: while
// stopped, the host and port to bind and Start; while serving, a readout of the addresses a planetarium connects to and
// the binding itself, Stop, and the connected clients, each disconnected one by one. A guide at the end explains how to
// connect a program, what clients may command, and what an unauthenticated listener exposes. The mount is never chosen
// here: a missing or unavailable one is reported and Start is disabled with the reason, never replaced by another
// mount. The listeners are the server's, so changing profile, setup, or workspace, or closing the tab, leaves them
// running for the mount they were started for, and the status bar shows them from every workspace; a stopped listener
// shows the host and port entered last for that mount (remembered by the profile when started).

// What each protocol is for.
const DESCRIPTIONS: Readonly<Record<MountRemoteProtocol, string>> = {
	lx200: 'For programs that drive a Meade LX200 over TCP, such as SkySafari or Stellarium in LX200 mode.',
	stellarium: "For Stellarium's Telescope Control plugin, connected as an external software or remote computer telescope.",
}

// Touch height of the commands of a card on phones (43.75 px), the size of the other touch targets of the app.
const TOUCH_COMMAND = 'max-sm:min-h-12.5'

// Mount Remote Control tool.
export function MountRemoteControl() {
	const mount = useRoleDevice('MOUNT')
	const profile = activeProfile(useSnapshot(profileState))
	const device = mount.device
	const blocker = mount.status === 'connected' ? undefined : MOUNT_ROLE_BLOCKERS[mount.status]
	const identity = profileCamera(profile, device?.id)

	return (
		<WorkspaceLayout workspace="tools" title="Mount Remote Control">
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-5">
						<span className="text-ink-300">Mount</span>
						<span className="min-w-0 truncate text-ink-100">
							<DeviceLink device={device} fallback={mount.status === 'notSelected' ? 'None selected' : 'Unavailable'} />
						</span>
						{blocker && <span className="text-ink-300">{blocker}</span>}
						{mount.status === 'notSelected' && <EquipmentSetupButton />}
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						{MOUNT_REMOTE_PROTOCOLS.map((protocol) => (
							<ProtocolPanel key={`${profile.id}:${device?.connectionId}:${device?.id}:${protocol}`} protocol={protocol} device={device} identity={identity} blocker={blocker} />
						))}
					</div>
					<RemoteControlGuide />
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

// Listener of one protocol for the mount: its state in words, then the binding to enter and Start while stopped, or
// where clients connect, Stop, and its clients while it serves.
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
	// Why Start cannot be pressed now, as its tooltip.
	const startReason = blocker ?? (pending ? 'Waiting for the server to answer.' : !host.trim() ? 'Enter the host to listen on.' : undefined)

	function start() {
		if (!device) return
		const binding = { host: host.trim(), port }
		setMountRemoteBinding(profileState, identity, protocol, binding)
		void startRemoteServer(mountRemoteControlState, device.connectionId, device.id, protocol, binding)
	}

	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-md border border-line-100 bg-base-100 p-4">
			<div className="flex items-center justify-between gap-3">
				<h2 className="m-0 text-sm leading-5 font-semibold text-ink-100">{label}</h2>
				{pending ? <StatusBadge tone="neutral" label={pending === 'start' ? 'Starting' : 'Stopping'} /> : server ? <StatusBadge tone="active" label="Serving" /> : <StatusBadge tone="muted" label="Stopped" />}
			</div>
			<Notice>{DESCRIPTIONS[protocol]}</Notice>
			{server ? (
				<ServingReadout server={server} />
			) : (
				<>
					<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
						<TextInput label="Host" value={host} disabled={!!pending} onChange={(event) => setHost(event.target.value)} inputMode="url" />
						<NumberInput label="Port" value={port} min={1} max={65535} disabled={!!pending} onChange={setPort} />
					</div>
					{!isLoopback(host) && <p className="m-0 text-xs leading-4 text-warning">Anyone on the network can move the mount: clients are not authenticated. Use 127.0.0.1 to accept only this computer.</p>}
				</>
			)}
			{error && <Notice error>{error}</Notice>}
			<div className="flex">
				{server ? (
					<Button variant="secondary" disabled={!!pending} title={pending ? 'Waiting for the server to answer.' : undefined} className={cn(TOUCH_COMMAND, 'max-sm:flex-1')} onClick={() => void stopRemoteServer(mountRemoteControlState, server.connectionId, server.deviceId, protocol)}>
						{pending === 'stop' ? 'Stopping…' : 'Stop'}
					</Button>
				) : (
					<Button disabled={!device || startReason !== undefined} title={startReason} className={cn(TOUCH_COMMAND, 'max-sm:flex-1')} onClick={start}>
						{pending === 'start' ? 'Starting…' : 'Start'}
					</Button>
				)}
			</div>
			{server && <ClientList server={server} />}
		</section>
	)
}

// Readout of a serving listener: the addresses a planetarium enters, each selected whole by one tap, the binding
// itself when it differs (a wildcard host), and who can reach it, in the warning tone when that is the network.
function ServingReadout({ server }: { readonly server: MountRemoteServer }) {
	const endpoints = connectEndpoints(server)
	const binding = formatEndpoint(server.host, server.port)
	const exposed = !isLoopback(server.host)

	return (
		<>
			<DataList>
				<DataRow label="Connect to">
					{endpoints.length > 0 ? (
						endpoints.map((endpoint) => (
							<span key={endpoint} className="block text-ink-100 select-all">
								{endpoint}
							</span>
						))
					) : (
						<span className="text-ink-300">No network address</span>
					)}
				</DataRow>
				{!endpoints.includes(binding) && <DataRow label="Listening on">{binding}</DataRow>}
			</DataList>
			{exposed ? <p className="m-0 text-xs leading-4 text-warning">Anyone on the network can move the mount: clients are not authenticated.</p> : <Notice>Only programs on this computer can connect.</Notice>}
			<Notice>It keeps running on the server when this tab closes, until Stop or until the mount disconnects.</Notice>
		</>
	)
}

// Clients connected to a serving listener, each with its address and a Disconnect button.
function ClientList({ server }: { readonly server: MountRemoteServer }) {
	const state = useSnapshot(mountRemoteControlState)
	const { clients } = server

	return (
		<div className="flex flex-col gap-2 border-t border-line-100 pt-3">
			<SectionHeading>Clients · {clients.length}</SectionHeading>
			{clients.length > 0 ? (
				<ul className="m-0 flex list-none flex-col gap-2 p-0">
					{clients.map((client) => {
						const disconnecting = state.disconnecting[clientKey(remoteKey(server.connectionId, server.deviceId, server.protocol), client.id)]

						return (
							<li key={client.id} className="flex items-center justify-between gap-3 text-sm leading-5">
								<span className="min-w-0 truncate text-ink-100 tabular-nums">{formatEndpoint(client.ip, client.port)}</span>
								<Button variant="secondary" disabled={disconnecting} title={disconnecting ? 'Waiting for the server to answer.' : undefined} className={TOUCH_COMMAND} onClick={() => void disconnectRemoteClient(mountRemoteControlState, server, client.id)}>
									{disconnecting ? 'Disconnecting…' : 'Disconnect'}
								</Button>
							</li>
						)
					})}
				</ul>
			) : (
				<Notice>Waiting for a planetarium to connect.</Notice>
			)}
		</div>
	)
}

// Part of the guide: its title and what it explains.
interface GuideTopic {
	// Short name of the topic.
	readonly title: string
	// What it explains.
	readonly text: string
}

// Topics of the guide, from connecting a program to what a listener exposes.
const GUIDE: readonly GuideTopic[] = [
	{
		title: 'Connecting',
		text: "Start a listener, then enter an address under Connect to in the planetarium: SkySafari, or Stellarium in LX200 mode, as a Meade LX200 telescope over the network (TCP); Stellarium's Telescope Control plugin as an external software or remote computer telescope. A phone or tablet must be on the same network as this computer.",
	},
	{
		title: 'Commands',
		text: "A goto from a client runs as a mount operation, is refused while another operation holds the mount, and goes on if the client disconnects. An LX200 client's manual motion stops when it releases the axes, disconnects, or after 30 seconds. An LX200 client may set the mount's site (latitude and longitude, such as a phone's GPS position); time and slew rate commands are refused or ignored.",
	},
	{
		title: 'Security',
		text: 'Clients are not authenticated: anyone who can reach a listener can move the mount. Bind 127.0.0.1 to accept only programs on this computer, and stop the listeners when the night ends. A listener stops with its mount or connection and is never started again by itself; changing profile or closing this tab leaves it running.',
	},
]

// How It Works disclosure of the tool, closed until opened. Text only; it reads no state.
function RemoteControlGuide() {
	return (
		<CollapsibleSection className="p-0" id="mount-remote-control.guide" title="How It Works" defaultOpen={false}>
			<ol className="m-0 grid list-none gap-x-8 gap-y-4 p-0 md:grid-cols-2">
				{GUIDE.map((step, index) => (
					<li key={step.title} className="flex min-w-0 gap-3">
						<span className="flex size-6 flex-none items-center justify-center rounded-full border border-line-200 text-xs leading-4 text-ink-200 tabular-nums">{index + 1}</span>
						<div className="flex min-w-0 flex-col gap-1">
							<span className="text-sm leading-5 font-semibold text-ink-100">{step.title}</span>
							<p className="m-0 text-sm leading-5 text-ink-200">{step.text}</p>
						</div>
					</li>
				))}
			</ol>
		</CollapsibleSection>
	)
}
