import type { DeviceSummary, ManagedDeviceType } from 'api'
import { type ReactNode, useState } from 'react'
import { tv } from 'tailwind-variants'
import { useSnapshot } from 'valtio'
import { connect, connectionState, serverOf } from '../connection/connection'
import { activeProfile, activeSetup, assignDevice, profileState } from '../profile/profile'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { deviceState, ROLE_STATUS_LABELS, type RoleStatus, roleDevice, roleStatus, switchDevice } from './equipment'
import { conflictingRole, type EquipmentSetup, type RoleDefinition, roleDefinition, ROLE_GROUPS, ROLES } from './roles'
import { useWatchedDevices } from './useEquipment'

// Modal that assigns the devices of the active profile's connection to the equipment roles and connects
// or disconnects them one by one. Selecting a device never connects it, and closing the modal never
// disconnects anything.

// Select value of the None option.
const NONE = ''

// Styles of the status badge for each role status; the text label always accompanies the color.
const badge = tv({
	slots: {
		root: 'inline-flex h-6 flex-none items-center gap-1.5 rounded-full border px-2.5 text-xs leading-none whitespace-nowrap',
		dot: 'size-1.5 rounded-full',
	},
	variants: {
		status: {
			notSelected: { root: 'border-dashed border-line-100 text-ink-300', dot: 'hidden' },
			unavailable: { root: 'border-line-200 text-ink-300', dot: 'border border-ink-300' },
			disconnected: { root: 'border-line-100 text-ink-200', dot: 'border border-ink-200' },
			connecting: { root: 'border-accent/50 text-accent', dot: 'animate-pulse bg-accent' },
			disconnecting: { root: 'border-accent/50 text-accent', dot: 'animate-pulse bg-accent' },
			connected: { root: 'border-success/50 text-success', dot: 'bg-success' },
			error: { root: 'border-danger/60 text-danger', dot: 'bg-danger' },
		},
	},
})

// SVG path data of the icon of each device type, drawn in a 24×24 box.
const ICONS: Readonly<Record<ManagedDeviceType, string>> = {
	camera: 'M4 7h3l1.5-2h7L17 7h3v12H4zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7',
	mount: 'M3.5 12.5L15 7l1.5 3L5 15.5zM15 7l3-1.5l1.5 3l-3 1.5M10.5 13.5V16M10.5 16L7 21M10.5 16L14 21M10.5 16v5',
	guideOutput: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
	focuser: 'M4 10h12v4H4zM16 8h4v8h-4zM8 6v4M8 14v4',
	wheel: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 6.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M7 11.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M17 11.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M12 14.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
	rotator: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
	dome: 'M4 18a8 8 0 0 1 16 0M3 18h18M11 10.1V18M13 10.1V18',
	cover: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M8 12h8',
	flatPanel: 'M4 8h16v11H4zM8 4l1 2M12 3v3M16 4l-1 2',
}

// Equipment Setup modal, shown while deviceState.open is true; works on the active profile only.
export function EquipmentModal() {
	const { open } = useSnapshot(deviceState)
	const profiles = useSnapshot(profileState)
	const { connections, servers, loading, errors } = useSnapshot(connectionState)
	const runtime = useWatchedDevices()
	const profile = activeProfile(profiles)
	const setup = activeSetup(profile)
	const connection = connections.find((c) => c.id === profile.connectionId)
	const serverOpen = serverOf(servers, connection) !== undefined
	const serverConnecting = connection !== undefined && loading?.kind === 'connect' && loading.connectionId === connection.id
	// Failure of the last connect or disconnect of the profile's connection.
	const connectionError = connection && errors[connection.id]

	// Closes this modal and opens the Connections modal, where the profile's connection is chosen.
	function openConnections() {
		deviceState.open = false
		connectionState.open = true
	}

	return (
		<Modal open={open} onClose={() => (deviceState.open = false)} title="Equipment Setup" className="max-w-[760px]" fit>
			<div className="flex min-h-0 flex-col gap-5">
				<div className="flex flex-col gap-1">
					<p className="m-0">Select and connect the devices used by this profile.</p>
					<p className="m-0 text-xs leading-5 text-ink-300">
						Profile: <span className="text-ink-200">{profile.name}</span> · Connection: <span className="text-ink-200">{connection?.name ?? 'None'}</span>
						{connection && <> · {serverOpen ? 'Connected' : serverConnecting ? 'Connecting…' : 'Not connected'}</>}
					</p>
				</div>
				{!connection ? (
					<Notice text="This profile has no connection selected. Choose the server whose devices it uses in Management → Connections.">
						<Button data-autofocus onClick={openConnections}>
							Open Connections
						</Button>
					</Notice>
				) : (
					<>
						{!serverOpen && (
							<Notice text={`${connection.name} is not connected. Assignments are kept; connect the server to list its devices.`}>
								<Button data-autofocus disabled={loading !== undefined} onClick={() => void connect(connectionState, connection)}>
									{serverConnecting ? 'Connecting…' : 'Connect'}
								</Button>
							</Notice>
						)}
						{connectionError && !serverOpen && <p className="m-0 text-[13px] leading-5 text-danger">{connectionError}</p>}
						{serverOpen && runtime.loading && <p className="m-0 text-[13px] leading-5 text-ink-300">Loading devices…</p>}
						<div className="-mr-2 flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-2">
							{ROLE_GROUPS.map(({ group, label }) => (
								<section key={group} className="flex flex-col gap-2">
									<h3 className="m-0 text-xs leading-4 font-medium tracking-[0.08em] text-ink-300 uppercase">{label}</h3>
									<ul className="m-0 flex list-none flex-col gap-2 p-0">
										{ROLES.filter((definition) => definition.group === group).map((definition) => {
											const assigned = setup[definition.role]

											return (
												<RoleRow
													// Keyed by profile and connection, so a switch resets the row's messages.
													key={`${profile.id}:${connection.id}:${definition.role}`}
													definition={definition}
													setup={setup}
													devices={runtime.devices}
													status={roleStatus(setup, definition.role, runtime)}
													device={roleDevice(setup, definition.role, runtime)}
													error={assigned && runtime.errors[assigned.id]}
													serverOpen={serverOpen}
												/>
											)
										})}
									</ul>
								</section>
							))}
						</div>
					</>
				)}
			</div>
		</Modal>
	)
}

interface NoticeProps {
	// Explanation shown before the action.
	readonly text: string
	// Action that resolves the situation.
	readonly children: ReactNode
}

// Bordered explanation of why devices cannot be shown, with the action that fixes it.
function Notice({ text, children }: NoticeProps) {
	return (
		<div className="flex flex-wrap items-center gap-4 rounded-md border border-line-100 bg-base-100 px-4 py-3">
			<p className="m-0 min-w-0 flex-[1_1_280px] text-[13px] leading-5 text-ink-200">{text}</p>
			{children}
		</div>
	)
}

interface RoleRowProps {
	// Role shown by the row.
	readonly definition: RoleDefinition
	// Active setup of the profile.
	readonly setup: Readonly<EquipmentSetup>
	// Devices of the watched connection.
	readonly devices: readonly DeviceSummary[]
	// Assigned device, when present on the connection.
	readonly device?: DeviceSummary
	// Operational state of the role.
	readonly status: RoleStatus
	// Last failure of the assigned device.
	readonly error?: string
	// Whether the server holds the profile's connection open.
	readonly serverOpen: boolean
}

// Row of one role: icon and name, device selector, status badge, and connect or disconnect action.
function RoleRow({ definition, setup, devices, device, status, error, serverOpen }: RoleRowProps) {
	const { role, label, deviceType } = definition
	const assignment = setup[role]
	const assigned = assignment?.id
	const candidates = devices.filter((d) => d.type === deviceType)
	// The saved device stays selectable while missing, so the assignment is shown and can be replaced or cleared.
	const options = [NONE, ...candidates.map((d) => d.id), ...(assigned && !candidates.some((d) => d.id === assigned) ? [assigned] : [])]
	const [message, setMessage] = useState<string>()
	const { root, dot } = badge({ status })

	// Assigns the chosen device, or clears the role for None.
	function handleChange(value: string) {
		const device = candidates.find((d) => d.id === value)
		const result = assignDevice(profileState, role, device && { id: device.id, name: device.name })
		setMessage(result.ok ? undefined : result.reason === 'conflict' ? `Already used as ${roleDefinition(result.role).label}.` : 'Select a connection first.')
	}

	// Display name of a select option.
	function format(value: string) {
		if (value === NONE) return 'None'
		// A missing saved device keeps the name stored with its assignment; assignments saved before names
		// were stored have none.
		return candidates.find((d) => d.id === value)?.name ?? (value === assigned && assignment?.name ? assignment.name : 'Saved device')
	}

	// Reason an option cannot be chosen: another role that cannot share the device already holds it.
	function disabledReason(value: string) {
		if (value === NONE || value === assigned) return undefined
		const other = conflictingRole(setup, role, value)
		return other && `Used as ${roleDefinition(other).label}`
	}

	const hint =
		message ??
		error ??
		(status === 'unavailable' && serverOpen
			? 'The saved device is not on this connection. Select a replacement or None.'
			: serverOpen && candidates.length === 0
				? deviceType === 'guideOutput'
					? 'No devices available. Guide outputs appear once their mount or camera is connected.'
					: 'No devices available'
				: undefined)

	return (
		<li className="grid grid-cols-[auto_minmax(0,1fr)_7.5rem_7rem] items-center gap-x-3 gap-y-1 rounded-md border border-line-100 bg-base-100 px-3 py-2.5 max-sm:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:items-start">
			<svg viewBox="0 0 24 24" className="size-5 text-ink-300 max-sm:mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
				<path d={ICONS[deviceType]} />
			</svg>
			<div className="flex min-w-0 items-center gap-3 max-sm:col-span-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
				<span className="w-32 flex-none text-xs font-medium tracking-[0.08em] text-ink-200 uppercase max-sm:w-auto">{label}</span>
				<Select className="min-w-0 flex-1" options={options} value={assigned ?? NONE} onChange={handleChange} format={format} disabledReason={disabledReason} />
			</div>
			<span className={root({ className: 'max-sm:col-start-2 max-sm:self-center max-sm:justify-self-start' })}>
				<span className={dot()} />
				{ROLE_STATUS_LABELS[status]}
			</span>
			<div className="flex justify-end max-sm:col-start-3">{device && <DeviceAction device={device} status={status} />}</div>
			{hint && <p className={`col-start-2 -col-end-1 m-0 text-xs leading-4 ${message || error ? 'text-danger' : 'text-ink-300'}`}>{hint}</p>}
		</li>
	)
}

interface DeviceActionProps {
	// Assigned device present on the connection.
	readonly device: DeviceSummary
	// Operational state of its role.
	readonly status: RoleStatus
}

// Connect or Disconnect button of an assigned device, disabled while a request is pending.
function DeviceAction({ device, status }: DeviceActionProps) {
	const busy = status === 'connecting' || status === 'disconnecting'
	const connected = device.connected

	return (
		<Button size="sm" variant={connected ? 'secondary' : 'primary'} disabled={busy} onClick={() => void switchDevice(deviceState, device.id, !connected)}>
			{status === 'connecting' ? 'Connecting…' : status === 'disconnecting' ? 'Disconnecting…' : connected ? 'Disconnect' : 'Connect'}
		</Button>
	)
}
