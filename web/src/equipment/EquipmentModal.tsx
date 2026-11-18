import type { DeviceSummary } from 'api'
import { type ReactNode, useState } from 'react'
import { tv } from 'tailwind-variants'
import { useSnapshot } from 'valtio'
import { connect, connectionState, serverOf } from '../connection/connection'
import { DEFAULT_TELESCOPE, type TelescopeOptics } from '../framing/geometry'
import { activeProfile, activeSetup, assignDevice, profileState, setGuideTelescopeOptics, setTelescopeOptics } from '../profile/profile'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Modal } from '../ui/Modal'
import { NumberInput } from '../ui/NumberInput'
import { SectionHeading } from '../ui/SectionHeading'
import { Select } from '../ui/Select'
import { catalogState } from './catalog'
import { CatalogBinding } from './CatalogBinding'
import { deviceState, ROLE_STATUS_LABELS, type RoleStatus, roleDevice, roleStatus, switchDevice, switchSetup } from './equipment'
import { conflictingRole, type EquipmentSetup, type RoleDefinition, roleDefinition, ROLE_GROUPS, ROLES } from './roles'
import { referencedTelescope, referToTelescope, resolveTelescope } from './telescopes'
import { useWatchedDevices } from './useEquipment'

// Modal that assigns the devices of the active profile's connection to the equipment roles and connects
// or disconnects them one by one or all at once. Selecting a device never connects it, and closing the modal never
// disconnects anything; while the server of the connection is not connected, the assignments are shown and cannot be
// changed. A camera role also binds its device to a camera of the Equipment Catalog (CatalogBinding), which holds for
// every profile and is shown read-only while the device is not on an open connection. It also holds the profile's telescope and guide telescope optics, which no device reports,
// each a telescope of the Equipment Catalog or entered by hand: the Sky's Equipment Setup field of view of a camera uses
// the optics it looks through, and Guiding the second.

// Select value of the None option.
const NONE = ''

// Select value of telescope optics entered by hand, which refer to no telescope of the catalog.
const BY_HAND = ''

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
			connecting: { root: 'border-accent/50 text-accent', dot: 'animate-pulse bg-accent motion-reduce:animate-none' },
			disconnecting: { root: 'border-accent/50 text-accent', dot: 'animate-pulse bg-accent motion-reduce:animate-none' },
			connected: { root: 'border-success/50 text-success', dot: 'bg-success' },
			error: { root: 'border-danger/60 text-danger', dot: 'bg-danger' },
		},
	},
})

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
	// Assigned devices present on the connection and without a pending request: those Connect all or
	// Disconnect all would switch.
	const assignedIds = new Set(Object.values(setup).map((assignment) => assignment?.id))
	const idle = runtime.devices.filter((d) => assignedIds.has(d.id) && !runtime.pending[d.id])
	const canConnectAll = idle.some((d) => !d.connected)
	const canDisconnectAll = idle.some((d) => d.connected)

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
					<ConnectionCallout text="This profile has no connection selected. Choose the server whose devices it uses in Management → Connections.">
						<Button data-autofocus onClick={openConnections}>
							Open Connections
						</Button>
					</ConnectionCallout>
				) : (
					<>
						{!serverOpen && (
							<ConnectionCallout text={`${connection.name} is not connected. Assignments are kept; connect the server to list its devices.`}>
								<Button data-autofocus disabled={loading !== undefined} onClick={() => void connect(connectionState, connection)}>
									{serverConnecting ? 'Connecting…' : 'Connect'}
								</Button>
							</ConnectionCallout>
						)}
						{connectionError && !serverOpen && <p className="m-0 text-sm leading-5 text-danger">{connectionError}</p>}
						{serverOpen && runtime.loading && <p className="m-0 text-sm leading-5 text-ink-300">Loading devices…</p>}
						<div className="flex justify-end gap-2">
							<Button variant="primary" disabled={!serverOpen || !canConnectAll} onClick={() => void switchSetup(deviceState, setup, true)}>
								Connect all
							</Button>
							<Button variant="ghost" disabled={!serverOpen || !canDisconnectAll} onClick={() => void switchSetup(deviceState, setup, false)}>
								Disconnect all
							</Button>
						</div>
						<div className="-mr-2 flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-2">
							{ROLE_GROUPS.map(({ group, label }) => (
								<section key={group} className="flex flex-col gap-2">
									<SectionHeading>{label}</SectionHeading>
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
							<TelescopeSection title="Telescope" telescope={profile.settings.telescope} onChange={(optics) => setTelescopeOptics(profileState, optics)}>
								Used by the Sky&apos;s Equipment Setup field of view of the Main Camera and of a manual sensor. Kept in the profile; never sent to a device.
							</TelescopeSection>
							<TelescopeSection title="Guide Telescope" telescope={profile.settings.guideTelescope} onChange={(optics) => setGuideTelescopeOptics(profileState, optics)}>
								Gives Guiding the pixel scale of the RMS in arcseconds and the calibration step, and the Sky the field of view of the Guide Camera; with an off-axis guider, enter the main telescope. Kept in the profile; never sent to a device.
							</TelescopeSection>
						</div>
					</>
				)}
			</div>
		</Modal>
	)
}

interface TelescopeSectionProps {
	// Heading of the section.
	readonly title: string
	// Saved optics; absent shows the defaults until entered.
	readonly telescope?: Readonly<TelescopeOptics>
	// Saves the whole optics after a change of one field.
	readonly onChange: (optics: TelescopeOptics) => void
	// What the optics are used for.
	readonly children: ReactNode
}

// Telescope optics of the active profile: a telescope of the Equipment Catalog, whose declared aperture and focal length
// are shown and not edited here, or optics entered by hand; the reducer or Barlow is always the profile's. Planning data
// never sent to a device.
function TelescopeSection({ title, telescope, onChange, children }: TelescopeSectionProps) {
	const { telescopes } = useSnapshot(catalogState)
	const saved = telescope ?? DEFAULT_TELESCOPE
	const referenced = referencedTelescope(saved, telescopes)
	const current = resolveTelescope(saved, telescopes) ?? saved
	const chosen = saved.telescopeId ?? BY_HAND
	// A referenced telescope stays selectable while archived or deleted, so the reference is shown and can be replaced.
	const options = [BY_HAND, ...telescopes.filter((entry) => !entry.archived || entry.id === chosen).map((entry) => entry.id), ...(chosen !== BY_HAND && !referenced ? [chosen] : [])]

	// Saves a change of the optics.
	function change(next: Partial<TelescopeOptics>) {
		onChange({ ...current, ...next })
	}

	// Refers to a telescope of the catalog, copying what it declares, or to none, keeping the optics last copied.
	function choose(id: string) {
		onChange(
			referToTelescope(
				current,
				telescopes.find((entry) => entry.id === id),
			),
		)
	}

	// Closes the Equipment Setup and shows the referenced telescope in Settings → Equipment Catalog.
	function editTelescope() {
		if (!referenced) return
		deviceState.open = false
		navigate(routeState, { workspace: 'settings', section: 'equipment-catalog', catalog: 'telescopes', item: referenced.id })
	}

	function format(id: string) {
		if (id === BY_HAND) return 'Entered by hand'
		return telescopes.find((entry) => entry.id === id)?.name ?? 'Deleted telescope'
	}

	const source = referenced ? `The values ${referenced.name} declares come from the Equipment Catalog, for every profile that uses it; the others are this profile's.` : chosen !== BY_HAND ? 'The telescope was deleted from the Equipment Catalog; these are the values last copied from it.' : undefined

	return (
		<section className="flex flex-col gap-2">
			<SectionHeading>{title}</SectionHeading>
			<div className="flex flex-wrap items-center gap-2">
				<Select label="Catalog Telescope" className="min-w-48 flex-1" options={options} value={chosen} format={format} onChange={choose} />
				<IconButton icon="edit" className="self-end" label={referenced ? `Edit ${referenced.name} in the Equipment Catalog` : 'Choose a telescope of the catalog to edit it'} disabled={!referenced} onClick={editTelescope} />
			</div>
			<div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
				<NumberInput label="Focal length" suffix="mm" value={current.focalLength} min={0} step={1} disabled={referenced?.focalLength !== undefined} onChange={(focalLength) => change({ focalLength })} />
				<NumberInput label="Reducer / Barlow" suffix="×" value={current.focalMultiplier} min={0.1} max={10} step={0.01} onChange={(focalMultiplier) => change({ focalMultiplier })} />
				<NumberInput label="Aperture" suffix="mm" value={current.aperture} min={0} step={1} disabled={referenced?.aperture !== undefined} onChange={(aperture) => change({ aperture })} />
			</div>
			<p className="m-0 text-xs leading-5 text-ink-300">
				{source && `${source} `}
				{children}
			</p>
		</section>
	)
}

interface ConnectionCalloutProps {
	// Explanation shown before the action.
	readonly text: string
	// Action that resolves the situation.
	readonly children: ReactNode
}

// Bordered explanation of why devices cannot be shown, with the action that fixes it.
function ConnectionCallout({ text, children }: ConnectionCalloutProps) {
	return (
		<div className="flex flex-wrap items-center gap-4 rounded-md border border-line-100 bg-base-100 px-4 py-3">
			<p className="m-0 min-w-0 flex-[1_1_280px] text-sm leading-5 text-ink-200">{text}</p>
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
			<Icon name={deviceType} className="text-ink-300 max-sm:mt-0.5" />
			<div className="flex min-w-0 items-center gap-3 max-sm:col-span-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
				<span className="w-32 flex-none text-xs font-medium tracking-[0.08em] text-ink-200 uppercase max-sm:w-auto">{label}</span>
				<Select options={options} value={assigned ?? NONE} onChange={handleChange} format={format} disabledReason={disabledReason} disabled={!serverOpen} />
			</div>
			<span className={root({ className: 'max-sm:col-start-2 max-sm:self-center max-sm:justify-self-start' })}>
				<span className={dot()} />
				{ROLE_STATUS_LABELS[status]}
			</span>
			<div className="flex justify-end max-sm:col-start-3">{device && <DeviceAction device={device} status={status} />}</div>
			{hint && <p className={`col-start-2 -col-end-1 m-0 text-xs leading-4 ${message || error ? 'text-danger' : 'text-ink-300'}`}>{hint}</p>}
			{deviceType === 'camera' && assigned && <CatalogBinding deviceId={assigned} device={device} />}
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
		<Button variant={connected ? 'secondary' : 'primary'} disabled={busy} onClick={() => void switchDevice(deviceState, device.id, !connected)}>
			{status === 'connecting' ? 'Connecting…' : status === 'disconnecting' ? 'Disconnecting…' : connected ? 'Disconnect' : 'Connect'}
		</Button>
	)
}
