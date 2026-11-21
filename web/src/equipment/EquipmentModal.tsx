import type { DeviceSummary } from 'api'
import { type ReactNode, useState } from 'react'
import { useSnapshot } from 'valtio'
import { connect, connectionState, serverOf } from '../connection/connection'
import { DEFAULT_TELESCOPE, type TelescopeOptics } from '../framing/geometry'
import { activeProfile, activeSetup, assignDevice, profileState, setGuideTelescopeOptics, setTelescopeOptics } from '../profile/profile'
import { navigate, routeState } from '../shell/route'
import { Button } from '../ui/Button'
import { ConfirmButton } from '../ui/ConfirmButton'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { LinkButton } from '../ui/LinkButton'
import { Modal, ModalActions } from '../ui/Modal'
import { NumberInput } from '../ui/NumberInput'
import { SectionHeading } from '../ui/SectionHeading'
import { Select } from '../ui/Select'
import { StatusBadge, type StatusTone } from '../ui/StatusBadge'
import { catalogState } from './catalog'
import { CatalogBinding } from './CatalogBinding'
import { deviceState, ROLE_STATUS_LABELS, type RoleStatus, roleDevice, roleStatus, switchDevice, switchSetup } from './equipment'
import { conflictingRole, type EquipmentSetup, type RoleDefinition, type RoleGroup, roleDefinition, ROLE_GROUPS, ROLES } from './roles'
import { referencedTelescope, referToTelescope, resolveTelescope } from './telescopes'
import { useWatchedDevices } from './useEquipment'

// Modal that assigns the devices of the active profile's connection to the equipment roles and connects
// or disconnects them one by one or all at once; Disconnect all asks first, since it drops the whole rig. Selecting a
// device never connects it, and closing the modal never disconnects anything; a device a change leaves connected and
// unassigned is pointed out with its Disconnect. While the server of the connection is not connected, the assignments
// are shown offline and cannot be changed. A camera role also binds its device to a camera of the Equipment Catalog
// (CatalogBinding), which holds for every profile and is shown read-only while the device is not on an open connection.
// It also holds the profile's telescope and guide telescope optics, which no device reports, each a telescope of the
// Equipment Catalog or entered by hand and shown beside the role group that looks through it: the Sky's Equipment Setup
// field of view of a camera uses the optics it looks through, and Guiding the second.

// Select value of the None option.
const NONE = ''

// Select value of telescope optics entered by hand, which refer to no telescope of the catalog.
const BY_HAND = ''

// Tone of the status badge of each role status; the label always accompanies it. An unavailable device is a warning,
// except a guide output, which is absent while its mount or camera is disconnected.
const ROLE_TONES: Readonly<Record<RoleStatus, StatusTone>> = {
	notSelected: 'muted',
	unavailable: 'warning',
	disconnected: 'neutral',
	connecting: 'active',
	disconnecting: 'active',
	connected: 'success',
	error: 'danger',
}

// Optics of the profile shown after the roles of a group, by the group of the camera that looks through them.
const GROUP_OPTICS: Partial<Record<RoleGroup, 'telescope' | 'guideTelescope'>> = { IMAGING: 'telescope', TELESCOPE: 'guideTelescope' }

// Classes of one entry of a group: a role row or the optics of the group.
const ENTRY_CLASS_NAME = 'rounded-md border border-line-100 bg-base-100 px-3 py-2.5'

// Classes of the name of an entry, in the uppercase Label style.
const ENTRY_LABEL_CLASS_NAME = 'text-xs font-medium tracking-[0.08em] text-ink-200 uppercase'

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
	// Assigned devices present on the connection, and those without a pending request: the ones Connect all or
	// Disconnect all would switch.
	const assignedIds = new Set(Object.values(setup).map((assignment) => assignment?.id))
	const present = runtime.devices.filter((d) => assignedIds.has(d.id))
	const idle = present.filter((d) => !runtime.pending[d.id])
	const toConnect = idle.filter((d) => !d.connected)
	const toDisconnect = idle.filter((d) => d.connected)
	// Roles whose device Disconnect all would disconnect, named by role since devices of one driver can share a name.
	const disconnectRoles = ROLES.filter((definition) => toDisconnect.some((d) => d.id === setup[definition.role]?.id)).map((definition) => definition.label)
	// Why Connect all or Disconnect all cannot run, as their tooltip.
	const offlineReason = connection && !serverOpen ? `Connect ${connection.name} to list its devices` : undefined
	const connectAllReason = offlineReason ?? (present.length === 0 ? 'No assigned device is on this connection' : toConnect.length === 0 ? 'Every assigned device is connected or switching' : undefined)
	const disconnectAllReason = offlineReason ?? (toDisconnect.length === 0 ? 'No assigned device is connected' : undefined)

	// Closes this modal.
	function close() {
		deviceState.open = false
	}

	// Closes this modal and opens the Connections modal, where the profile's connection is chosen.
	function openConnections() {
		deviceState.open = false
		connectionState.open = true
	}

	return (
		<Modal open={open} onClose={close} title="Equipment Setup" className="max-w-[760px]" fit>
			<div className="flex min-h-0 flex-col gap-5">
				<div className="flex flex-col gap-1">
					<p className="m-0">Assign and connect the devices of this profile, and enter the telescope optics no device reports.</p>
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
							<ConnectionCallout text={`${connection.name} is not connected. The assignments are kept; connect it to list its devices.`}>
								<Button data-autofocus disabled={loading !== undefined} onClick={() => void connect(connectionState, connection)}>
									{serverConnecting ? 'Connecting…' : 'Connect'}
								</Button>
							</ConnectionCallout>
						)}
						{connectionError && !serverOpen && <p className="m-0 text-sm leading-5 text-danger">{connectionError}</p>}
						{serverOpen && runtime.loading && <p className="m-0 text-sm leading-5 text-ink-300">Loading devices…</p>}
						<div className="-mr-2 flex min-h-0 flex-col gap-5 overflow-y-auto overscroll-contain pr-2">
							{ROLE_GROUPS.map(({ group, label }) => {
								const optics = GROUP_OPTICS[group]

								return (
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
														offlineReason={offlineReason}
													/>
												)
											})}
										</ul>
										{optics === 'telescope' && (
											<TelescopeSection title="Main Telescope" telescope={profile.settings.telescope} missing="Without a focal length, the Sky draws no field of view for the Main Camera." onChange={(value) => setTelescopeOptics(profileState, value)}>
												Gives the Sky the field of view of the Main Camera and of a manual sensor.
											</TelescopeSection>
										)}
										{optics === 'guideTelescope' && (
											<TelescopeSection title="Guide Telescope" telescope={profile.settings.guideTelescope} missing="Without a focal length, Guiding reports the RMS in pixels." onChange={(value) => setGuideTelescopeOptics(profileState, value)}>
												Gives Guiding its arcsecond scale and calibration step, and the Sky the Guide Camera&apos;s field of view. With an off-axis guider, enter the main telescope.
											</TelescopeSection>
										)}
									</section>
								)
							})}
						</div>
					</>
				)}
			</div>
			<ModalActions>
				{connection && (
					<ConfirmButton
						className="mr-auto"
						disabled={disconnectAllReason !== undefined}
						tooltip={disconnectAllReason}
						title="Disconnect all devices?"
						message={`Disconnects ${toDisconnect.length === 1 ? 'the one connected device' : `the ${toDisconnect.length} connected devices`} of this setup, used as ${disconnectRoles.join(', ')}.`}
						confirmLabel="Disconnect all"
						onConfirm={() => void switchSetup(deviceState, setup, false)}
					>
						Disconnect all
					</ConfirmButton>
				)}
				<div className="flex gap-2">
					<Button variant="secondary" onClick={close}>
						Close
					</Button>
					{connection && (
						<Button disabled={connectAllReason !== undefined} title={connectAllReason} onClick={() => void switchSetup(deviceState, setup, true)}>
							Connect all
						</Button>
					)}
				</div>
			</ModalActions>
		</Modal>
	)
}

interface TelescopeSectionProps {
	// Name of the optics.
	readonly title: string
	// Saved optics; absent shows the defaults until entered.
	readonly telescope?: Readonly<TelescopeOptics>
	// What stays unknown while the optics have no positive focal length.
	readonly missing: string
	// Saves the whole optics after a change of one field.
	readonly onChange: (optics: TelescopeOptics) => void
	// What the optics are used for.
	readonly children: ReactNode
}

// Telescope optics of the active profile: a telescope of the Equipment Catalog, whose declared aperture and focal length
// are shown and not edited here, or optics entered by hand; the reducer or Barlow is always the profile's. Planning data
// never sent to a device.
function TelescopeSection({ title, telescope, missing, onChange, children }: TelescopeSectionProps) {
	const { telescopes } = useSnapshot(catalogState)
	const saved = telescope ?? DEFAULT_TELESCOPE
	const referenced = referencedTelescope(saved, telescopes)
	const current = resolveTelescope(saved, telescopes) ?? saved
	const chosen = saved.telescopeId ?? BY_HAND
	// A referenced telescope stays selectable while archived or deleted, so the reference is shown and can be replaced.
	const options = [BY_HAND, ...telescopes.filter((entry) => !entry.archived || entry.id === chosen).map((entry) => entry.id), ...(chosen !== BY_HAND && !referenced ? [chosen] : [])]
	// Why a field the catalog telescope declares cannot be edited here.
	const declaredReason = referenced && `Declared by ${referenced.name} in the Equipment Catalog`

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

	const source = referenced ? `${referenced.name} of the Equipment Catalog sets the values it declares.` : chosen !== BY_HAND ? 'Deleted from the Equipment Catalog; these are the values last copied from it.' : undefined

	return (
		<div className={`flex flex-col gap-2 ${ENTRY_CLASS_NAME}`}>
			<span className={ENTRY_LABEL_CLASS_NAME}>{title}</span>
			<div className="flex flex-wrap items-end gap-2">
				<Select label="Catalog" className="min-w-48 flex-1" options={options} value={chosen} format={format} onChange={choose} />
				<IconButton icon="edit" label={referenced ? `Edit ${referenced.name} in the Equipment Catalog` : 'Choose a telescope of the catalog to edit it'} disabled={!referenced} onClick={editTelescope} />
			</div>
			<div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
				<div title={referenced?.focalLength !== undefined ? declaredReason : undefined}>
					<NumberInput label="Focal length" suffix="mm" value={current.focalLength} min={0} step={1} disabled={referenced?.focalLength !== undefined} onChange={(focalLength) => change({ focalLength })} />
				</div>
				<NumberInput label="Reducer / Barlow" suffix="×" value={current.focalMultiplier} min={0.1} max={10} step={0.01} onChange={(focalMultiplier) => change({ focalMultiplier })} />
				<div title={referenced?.aperture !== undefined ? declaredReason : undefined}>
					<NumberInput label="Aperture" suffix="mm" value={current.aperture} min={0} step={1} disabled={referenced?.aperture !== undefined} onChange={(aperture) => change({ aperture })} />
				</div>
			</div>
			<p className="m-0 text-xs leading-5 text-ink-300">
				{source && `${source} `}
				{children}
			</p>
			{!(current.focalLength * current.focalMultiplier > 0) && <p className="m-0 text-xs leading-5 text-warning">{missing}</p>}
		</div>
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
	// Why the assignment cannot change while the server of the connection is not connected; absent while it is.
	readonly offlineReason?: string
}

// Row of one role: icon and name, device selector, status badge, and connect or disconnect action, then the note of a
// device the last change left connected without a role.
function RoleRow({ definition, setup, devices, device, status, error, offlineReason }: RoleRowProps) {
	const { role, label, deviceType } = definition
	const serverOpen = offlineReason === undefined
	const assignment = setup[role]
	const assigned = assignment?.id
	const candidates = devices.filter((d) => d.type === deviceType)
	// The saved device stays selectable while missing, so the assignment is shown and can be replaced or cleared.
	const options = [NONE, ...candidates.map((d) => d.id), ...(assigned && !candidates.some((d) => d.id === assigned) ? [assigned] : [])]
	const [message, setMessage] = useState<string>()
	// Id of the connected device the last change took off this role.
	const [released, setReleased] = useState<string>()
	// The released device while it is still connected and no role holds it.
	const orphan = released === undefined || Object.values(setup).some((entry) => entry?.id === released) ? undefined : devices.find((d) => d.id === released && d.connected)
	const offline = !serverOpen && status === 'unavailable'

	// Assigns the chosen device, or clears the role for None, remembering a connected device the change takes off it.
	function handleChange(value: string) {
		const chosen = candidates.find((d) => d.id === value)
		const result = assignDevice(profileState, role, chosen && { id: chosen.id, name: chosen.name })
		setMessage(result.ok ? undefined : result.reason === 'conflict' ? `Already used as ${roleDefinition(result.role).label}.` : 'Select a connection first.')
		if (result.ok) setReleased(device?.connected && device.id !== value ? device.id : undefined)
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

	const failure = message ?? error
	const hint =
		failure === undefined && serverOpen
			? status === 'unavailable'
				? deviceType === 'guideOutput'
					? 'Appears once its mount or camera connects.'
					: 'The saved device is not on this connection; it stays assigned until you change it.'
				: candidates.length === 0
					? deviceType === 'guideOutput'
						? 'None yet: guide outputs appear once their mount or camera connects.'
						: 'No devices of this kind on this connection.'
					: undefined
			: undefined

	return (
		<li className={`grid grid-cols-[auto_minmax(0,1fr)_7.5rem_7rem] items-center gap-x-3 gap-y-1 max-sm:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:items-start ${ENTRY_CLASS_NAME}`}>
			<Icon name={deviceType} className="text-ink-300 max-sm:mt-0.5" />
			<div title={offlineReason && `${offlineReason} and change the assignment`} className="flex min-w-0 items-center gap-3 max-sm:col-span-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
				<span className={`w-32 flex-none max-sm:w-auto ${ENTRY_LABEL_CLASS_NAME}`}>{label}</span>
				<Select options={options} value={assigned ?? NONE} onChange={handleChange} format={format} disabledReason={disabledReason} disabled={!serverOpen} />
			</div>
			<span className="max-sm:col-start-2 max-sm:self-center max-sm:justify-self-start">
				<StatusBadge tone={offline ? 'muted' : status === 'unavailable' && deviceType === 'guideOutput' ? 'neutral' : ROLE_TONES[status]} label={offline ? 'Offline' : ROLE_STATUS_LABELS[status]} title={offlineReason} />
			</span>
			<div className="flex justify-end max-sm:col-start-3">{device && <DeviceAction device={device} status={status} />}</div>
			{failure && <p className="col-start-2 -col-end-1 m-0 text-sm leading-5 text-danger">{failure}</p>}
			{hint && <p className="col-start-2 -col-end-1 m-0 text-xs leading-4 text-ink-300">{hint}</p>}
			{orphan && (
				<p className="col-start-2 -col-end-1 m-0 text-xs leading-4 text-ink-300">
					{`${orphan.name} is still connected. `}
					<LinkButton onClick={() => void switchDevice(deviceState, orphan.id, false)}>Disconnect it</LinkButton>
				</p>
			)}
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

// Connect or Disconnect button of an assigned device, disabled while a request is pending. Secondary, so Connect all
// stays the one primary action of the modal.
function DeviceAction({ device, status }: DeviceActionProps) {
	const busy = status === 'connecting' || status === 'disconnecting'
	const connected = device.connected

	return (
		<Button variant="secondary" disabled={busy} onClick={() => void switchDevice(deviceState, device.id, !connected)}>
			{status === 'connecting' ? 'Connecting…' : status === 'disconnecting' ? 'Disconnecting…' : connected ? 'Disconnect' : 'Connect'}
		</Button>
	)
}
