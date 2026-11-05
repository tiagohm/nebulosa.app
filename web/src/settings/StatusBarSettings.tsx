import { useSnapshot } from 'valtio'
import { roleDefinition } from '../equipment/roles'
import { openObservingSites } from '../location/site'
import { useActiveSite } from '../location/useLocation'
import { activeProfile, astronomicalClockPreferences, profileState, setAstronomicalClockPreferences, setStatusChipPreferences, statusChipPreferences } from '../profile/profile'
import { ASTRONOMICAL_CLOCK_READINGS, type AstronomicalClockReading, STATUS_CHIP_FIELDS, type StatusChipField, type StatusChipRole } from '../profile/schema'
import { ASTRONOMICAL_CLOCK_READING_LABELS } from '../shell/statusbar/astronomicalclock'
import { CHIP_ROLES } from '../shell/statusbar/selectors'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Notice } from '../ui/Notice'
import { SectionHeading } from '../ui/SectionHeading'
import { Select } from '../ui/Select'

// Status Bar section of the Settings page: what the status bar of the active profile shows for each device and in its
// clock. A change applies at once and belongs to the profile, so the bar itself shows the result. The clock's civil time
// is shown in the profile's display zone (Settings → Date & Time); it has no zone of its own.

// Options of the secondary reading, in display order.
const SECONDARY_READINGS: readonly (AstronomicalClockReading | 'none')[] = ['none', ...ASTRONOMICAL_CLOCK_READINGS]

// Returns the name of an option of the secondary reading.
function secondaryLabel(reading: AstronomicalClockReading | 'none') {
	return reading === 'none' ? 'None' : ASTRONOMICAL_CLOCK_READING_LABELS[reading]
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

interface DeviceChipSettingsProps {
	// Role of the device.
	readonly role: StatusChipRole
	// Settings of the active profile.
	readonly settings: Parameters<typeof statusChipPreferences>[0]
}

// Whether a device shows in the bar, and which of its readings.
function DeviceChipSettings({ role, settings }: DeviceChipSettingsProps) {
	const { visible, fields } = statusChipPreferences(settings, role)

	return (
		<div className="flex flex-col gap-2">
			<Checkbox label={roleDefinition(role).label} checked={visible} onChange={(value) => setStatusChipPreferences(profileState, role, { visible: value })} />
			<div className="flex flex-wrap gap-x-4 gap-y-2 pl-5.5">
				{STATUS_CHIP_FIELDS[role].map((field: StatusChipField) => (
					<Checkbox key={field} label={CHIP_FIELD_LABELS[field]} disabled={!visible} checked={fields.includes(field)} onChange={(value) => setStatusChipPreferences(profileState, role, { fields: value ? [...fields, field] : fields.filter((other) => other !== field) })} />
				))}
			</div>
		</div>
	)
}

// Content of the Status Bar section.
export function StatusBarSettings() {
	const settings = activeProfile(useSnapshot(profileState)).settings
	const { enabled, primary, secondary, showSeconds } = astronomicalClockPreferences(settings)
	const located = useActiveSite() !== undefined
	const sidereal = primary === 'last' || primary === 'lmst'

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
			<section className="flex max-w-md flex-col gap-3">
				<SectionHeading as="h2">Devices</SectionHeading>
				{CHIP_ROLES.map((role) => (
					<DeviceChipSettings key={role} role={role} settings={settings} />
				))}
				<Notice>A device shows only while it is connected. A chip without any reading shows its icon alone, and its title always has the full reading.</Notice>
			</section>
			<section className="flex max-w-md flex-col gap-3">
				<SectionHeading as="h2">Astronomical Clock</SectionHeading>
				<Checkbox label="Show the clock in the status bar" checked={enabled} onChange={(value) => setAstronomicalClockPreferences(profileState, { enabled: value })} />
				<Select label="Primary Reading" disabled={!enabled} options={ASTRONOMICAL_CLOCK_READINGS} value={primary} format={(reading) => ASTRONOMICAL_CLOCK_READING_LABELS[reading]} onChange={(reading) => setAstronomicalClockPreferences(profileState, { primary: reading })} />
				<Select
					label="Secondary Reading"
					disabled={!enabled}
					options={SECONDARY_READINGS}
					value={secondary}
					format={secondaryLabel}
					disabledReason={(reading) => (reading === primary ? 'Already the primary reading' : undefined)}
					onChange={(reading) => setAstronomicalClockPreferences(profileState, { secondary: reading })}
				/>
				<Checkbox label="Show seconds in times of day" disabled={!enabled} checked={showSeconds} onChange={(value) => setAstronomicalClockPreferences(profileState, { showSeconds: value })} />
				{sidereal && !located && (
					<>
						<Notice>This profile has no observing site, so the bar shows the Julian Date (UTC) until one is selected.</Notice>
						<Button variant="secondary" className="self-start" onClick={() => openObservingSites()}>
							Set Location
						</Button>
					</>
				)}
				<Notice>The clock is always the real current time, never the Sky simulation clock. It uses the room the equipment and the operations leave, and is always listed in the status details.</Notice>
			</section>
		</div>
	)
}
