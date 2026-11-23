import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { captureRuntime } from '../camera/capture'
import { guidingRuntime } from '../camera/guiding'
import { controlRuntime } from '../equipment-control/control'
import { roleDevice, roleStatus } from '../equipment/equipment'
import { roleDefinition } from '../equipment/roles'
import { useActiveServerId, useWatchedDevices } from '../equipment/useEquipment'
import { openObservingSites } from '../location/site'
import { useActiveSite } from '../location/useLocation'
import { activeProfile, activeSetup, astronomicalClockPreferences, profileState, setAstronomicalClockPreferences, setStatusChipPreferences, statusChipPreferences } from '../profile/profile'
import { ASTRONOMICAL_CLOCK_READINGS, type AstronomicalClockReading, STATUS_CHIP_FIELDS, type StatusChipField } from '../profile/schema'
import { ASTRONOMICAL_CLOCK_READING_LABELS } from '../shell/statusbar/astronomicalclock'
import { activeCapture, activeGuiding, CHIP_ICONS, CHIP_ROLES, type ChipRole, type ChipValue, chipShown, deviceChip } from '../shell/statusbar/selectors'
import { TONE_CLASSES } from '../shell/statusbar/StatusItems'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DisclosureSummary } from '../ui/DisclosureSummary'
import { Icon } from '../ui/Icon'
import { Notice } from '../ui/Notice'
import { SectionHeading } from '../ui/SectionHeading'
import { Select } from '../ui/Select'

// Status Bar section of the Settings page: what the status bar of the active profile shows in its clock and for each
// device. A change applies at once and belongs to the profile, so the bar itself shows the result, and each device of the
// Equipment Setup shows beside its name what its chip reads right now; the roles the setup does not assign are folded away
// below them. The clock's civil time is shown in the profile's display zone (Settings → Date & Time); it has no zone of its
// own.

// Options of the secondary reading, in display order.
const SECONDARY_READINGS: readonly (AstronomicalClockReading | 'none')[] = ['none', ...ASTRONOMICAL_CLOCK_READINGS]

// Classes of every checkbox of the page: a row a thumb can press below 640 px.
const CHECKBOX_CLASS = 'max-sm:min-h-10'

// Returns the name of an option of the secondary reading.
function secondaryLabel(reading: AstronomicalClockReading | 'none') {
	return reading === 'none' ? 'None' : ASTRONOMICAL_CLOCK_READING_LABELS[reading]
}

// Returns whether a reading of the clock is a sidereal time, which needs an observing site.
function isSidereal(reading: AstronomicalClockReading | 'none') {
	return reading === 'last' || reading === 'lmst'
}

// Returns what the bar shows in place of the readings the profile chose while it has no observing site, or undefined while
// nothing is replaced: a sidereal primary reading gives way to the Julian Date (UTC), and a sidereal secondary one is left out.
function sitelessText(primary: AstronomicalClockReading, secondary: AstronomicalClockReading | 'none') {
	const dropped = isSidereal(secondary) ? secondaryLabel(secondary) : undefined
	if (isSidereal(primary)) return `This profile has no observing site, so the bar shows the Julian Date (UTC) in place of ${ASTRONOMICAL_CLOCK_READING_LABELS[primary]}${dropped ? ` and leaves out ${dropped}` : ''} until one is selected.`
	return dropped && `This profile has no observing site, so the bar leaves out ${dropped} until one is selected.`
}

// Name of each reading of a device.
const CHIP_FIELD_LABELS: Readonly<Record<StatusChipField, string>> = {
	status: 'Status',
	temperature: 'Temperature',
	cooler: 'Cooler power',
	filter: 'Filter',
	position: 'Position',
	angle: 'Angle',
	coordinates: 'Coordinates',
	shutter: 'Shutter',
	azimuth: 'Azimuth',
	brightness: 'Brightness',
}

// What the bar shows for the device of a role right now: its chip, or hidden while the profile hides it connected.
type ChipPreview = ChipValue | 'hidden'

interface ChipReadingProps {
	// Role of the device.
	readonly role: ChipRole
	// What the bar shows for it.
	readonly preview: ChipPreview
}

// Icon and short reading of a chip as the bar shows it, its full reading in its title; "Hidden" while the bar leaves it out.
function ChipReading({ role, preview }: ChipReadingProps) {
	if (preview === 'hidden') return <span className="flex-none text-xs leading-4 text-ink-300">Hidden</span>

	return (
		<span title={preview.title} className="flex max-w-[50%] min-w-0 flex-none items-center gap-1 text-xs leading-4">
			<Icon name={CHIP_ICONS[role]} className="size-3.5 flex-none text-ink-300" />
			<span className={cn('truncate tabular-nums', preview.text ? TONE_CLASSES[preview.tone] : 'text-ink-300')}>{preview.text || 'Icon only'}</span>
		</span>
	)
}

interface DeviceChipSettingsProps {
	// Role of the device.
	readonly role: ChipRole
	// Settings of the active profile.
	readonly settings: Parameters<typeof statusChipPreferences>[0]
	// Name of the device the Equipment Setup assigns to the role; absent for a role it does not assign.
	readonly device?: string
	// What the bar shows for the device right now; absent while it shows no device of the role, as with no connection open.
	readonly preview?: ChipPreview
}

// Whether a device shows in the bar while it is connected, and which of its readings, with the name of the device the
// setup assigns and what its chip reads now.
function DeviceChipSettings({ role, settings, device, preview }: DeviceChipSettingsProps) {
	const { visible, fields } = statusChipPreferences(settings, role)
	const label = roleDefinition(role).label

	return (
		<div className="flex flex-col gap-2">
			<div className="flex min-w-0 items-center gap-3">
				<Checkbox label={label} className={cn(CHECKBOX_CLASS, 'min-w-0 flex-1 font-medium text-ink-100')} checked={visible} onChange={(value) => setStatusChipPreferences(profileState, role, { visible: value })} />
				{preview && <ChipReading role={role} preview={preview} />}
			</div>
			{device && <p className="m-0 -mt-1 truncate pl-5.5 text-xs leading-4 text-ink-200">{device}</p>}
			<div className="flex flex-wrap gap-x-4 gap-y-2 pl-5.5">
				{STATUS_CHIP_FIELDS[role].map((field: StatusChipField) => (
					<Checkbox
						key={field}
						label={CHIP_FIELD_LABELS[field]}
						className={CHECKBOX_CLASS}
						disabled={!visible}
						title={visible ? undefined : `Check ${label} to choose what its chip reads`}
						checked={fields.includes(field)}
						onChange={(value) => setStatusChipPreferences(profileState, role, { fields: value ? [...fields, field] : fields.filter((other) => other !== field) })}
					/>
				))}
			</div>
		</div>
	)
}

// Content of the Status Bar section.
export function StatusBarSettings() {
	const profile = activeProfile(useSnapshot(profileState))
	const settings = profile.settings
	const setup = activeSetup(profile)
	const serverId = useActiveServerId()
	const devices = useWatchedDevices()
	const control = useSnapshot(controlRuntime)
	const captures = useSnapshot(captureRuntime)
	const guiding = useSnapshot(guidingRuntime)
	const { enabled, primary, secondary, showSeconds } = astronomicalClockPreferences(settings)
	const located = useActiveSite() !== undefined
	const siteless = enabled && !located ? sitelessText(primary, secondary) : undefined
	const clockOff = enabled ? undefined : 'Show the clock in the status bar first'
	const assigned = CHIP_ROLES.filter((role) => setup[role] !== undefined)
	const unassigned = CHIP_ROLES.filter((role) => setup[role] === undefined)
	// The bar knows the devices of the setup only once the device list of the profile's open connection is.
	const known = serverId !== undefined && !devices.loading
	const sessions = { capture: activeCapture(captures.sessions, roleDevice(setup, 'MAIN_CAMERA', devices)), guiding: activeGuiding(guiding.sessions, roleDevice(setup, 'GUIDE_CAMERA', devices)) }

	// Returns what the bar shows for the device of a role, as the bar decides it, or undefined while it shows none.
	function preview(role: ChipRole): ChipPreview | undefined {
		const status = roleStatus(setup, role, devices)
		if (!known || status === 'notSelected') return undefined
		const { visible, fields } = statusChipPreferences(settings, role)
		if (!chipShown(visible, status)) return 'hidden'
		return deviceChip(role, status, roleDevice(setup, role, devices), control, { capture: role === 'MAIN_CAMERA' ? sessions.capture : undefined, guiding: role === 'GUIDE_CAMERA' ? sessions.guiding : undefined }, fields)
	}

	// Makes a reading the primary one; choosing the secondary reading swaps the two, so the clock keeps both.
	function choosePrimary(reading: AstronomicalClockReading) {
		setAstronomicalClockPreferences(profileState, reading === secondary ? { primary: reading, secondary: primary } : { primary: reading })
	}

	const unassignedRows = unassigned.map((role) => <DeviceChipSettings key={role} role={role} settings={settings} />)

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
			<Notice className="max-w-md">Applies to the profile {profile.name}. A change shows in the status bar at once.</Notice>
			<section className="flex max-w-md flex-col gap-3">
				<SectionHeading as="h2">Astronomical Clock</SectionHeading>
				<Checkbox label="Show the clock in the status bar" className={CHECKBOX_CLASS} checked={enabled} onChange={(value) => setAstronomicalClockPreferences(profileState, { enabled: value })} />
				<Select label="Primary Reading" title={clockOff} disabled={!enabled} options={ASTRONOMICAL_CLOCK_READINGS} value={primary} format={(reading) => ASTRONOMICAL_CLOCK_READING_LABELS[reading]} onChange={choosePrimary} />
				<Select
					label="Secondary Reading"
					title={clockOff}
					disabled={!enabled}
					options={SECONDARY_READINGS}
					value={secondary}
					format={secondaryLabel}
					disabledReason={(reading) => (reading === primary ? 'Already the primary reading' : undefined)}
					onChange={(reading) => setAstronomicalClockPreferences(profileState, { secondary: reading })}
				/>
				<Checkbox label="Show seconds" className={CHECKBOX_CLASS} title={clockOff} disabled={!enabled} checked={showSeconds} onChange={(value) => setAstronomicalClockPreferences(profileState, { showSeconds: value })} />
				{siteless && (
					<>
						<Notice warning>{siteless}</Notice>
						<Button variant="secondary" className="self-start" onClick={() => openObservingSites()}>
							Set Location
						</Button>
					</>
				)}
				<Notice>
					The clock is always the real current time, never the Sky simulation clock. It takes only the room left once every device chip and operation fits, so a narrow bar may leave it out, and the secondary reading shows only when room remains after the primary. The details button at the right end of the bar
					always lists it.
				</Notice>
			</section>
			<section className="flex max-w-md flex-col gap-3">
				<SectionHeading as="h2">Devices</SectionHeading>
				{assigned.length === 0 && <Notice>The equipment setup of this profile assigns no device yet, so the bar has no device chip.</Notice>}
				{assigned.length > 0 && serverId === undefined && <Notice>No connection is open, so the bar shows no device yet. Each device shows what its chip reads here once the profile's connection opens.</Notice>}
				{assigned.map((role) => (
					<DeviceChipSettings key={role} role={role} settings={settings} device={setup[role]?.name} preview={preview(role)} />
				))}
				{assigned.length === 0
					? unassignedRows
					: unassigned.length > 0 && (
							<details>
								<DisclosureSummary title={`Not in the Equipment Setup · ${unassigned.length}`} />
								<div className="-mt-1 flex flex-col gap-3 pb-1">{unassignedRows}</div>
							</details>
						)}
				<Notice>Unchecking a device hides its chip while it is connected. A device of the equipment setup that is not connected always has a chip that says so in red, kept in view first. A chip with no reading checked shows its icon alone. The details button lists every device with its full reading.</Notice>
			</section>
		</div>
	)
}
