import { useCallback, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { dateTimeFormat, formatClockTime, formatDateTime } from '../format'
import { openObservingSites } from '../location/site'
import { useActiveSite } from '../location/useLocation'
import { BROWSER_TIME_ZONE, formatUtcOffset, nextOffsetChange, resolveDisplayZone, TIME_ZONES, zoneShortName } from '../location/zone'
import { activeProfile, dateTimePreferences, profileState, setDateTimePreferences } from '../profile/profile'
import { DISPLAY_TIME_ZONE_MODES, type DisplayTimeZoneMode } from '../profile/schema'
import { Button } from '../ui/Button'
import { DataList, DataRow } from '../ui/DataRow'
import { List, ListItem } from '../ui/List'
import { Notice } from '../ui/Notice'
import { SectionHeading } from '../ui/SectionHeading'
import { VirtualSelect } from '../ui/VirtualSelect'
import { useNow } from '../useNow'

// Date & Time section of the Settings page: the zone the active profile shows civil times in unless a tool overrides it,
// the observing site's, UTC, this device's, or one zone chosen for every device, each offered with the time it reads now,
// then the zone in effect, its offset from UTC, and its next change of offset. A change applies at once and belongs to
// the profile. It changes how times read only, never an instant, a calculation, the local day or night of a site, or a
// device.

// Names of the display modes.
const MODE_LABELS: Readonly<Record<DisplayTimeZoneMode, string>> = { site: 'Observing Site', utc: 'UTC', browser: 'This Device', zone: 'Fixed Zone' }

// Milliseconds in one minute: the step the next offset change is looked up again at.
const MINUTE_MS = 60_000

// Milliseconds in one day: an offset change closer than this asks for attention, since it falls within the night.
const DAY_MS = 86_400_000

// Returns the short name of a zone at an instant (Unix milliseconds) when it says more than its offset, such as "CET"
// or "PDT"; undefined for a name that only repeats the offset, such as "GMT-3" or "UTC".
function zoneAbbreviation(timeZone: string, time: number) {
	const name = zoneShortName(timeZone, time)
	return name === '' || name.startsWith('GMT') || name.startsWith('UTC') ? undefined : name
}

// Returns the offset of a zone from UTC at an instant (Unix milliseconds) with its short name when it has one:
// "UTC−03:00", "UTC+01:00 · CET".
function formatOffset(timeZone: string, time: number) {
	const abbreviation = zoneAbbreviation(timeZone, time)
	return abbreviation ? `${formatUtcOffset(timeZone, time)} · ${abbreviation}` : formatUtcOffset(timeZone, time)
}

// Returns the weekday, date, and time to the minute of an instant (Unix milliseconds) in a zone, such as
// "Sun 2027-03-28 03:00".
function formatChangeTime(time: number, timeZone: string) {
	return `${dateTimeFormat({ timeZone, weekday: 'short' }).format(time)} ${formatDateTime(time, timeZone, false)}`
}

// Content of the Date & Time section.
export function DateTimeSettings() {
	const settings = activeProfile(useSnapshot(profileState)).settings
	const preferences = dateTimePreferences(settings)
	const { displayTimeZone, timeZone } = preferences
	const site = useActiveSite()
	const now = useNow()
	const resolved = resolveDisplayZone(preferences, undefined, site)
	const minute = Math.floor(now / MINUTE_MS)
	const change = useMemo(() => nextOffsetChange(resolved.zone, minute * MINUTE_MS), [resolved.zone, minute])
	// Current hour, Unix milliseconds rounded down: the instant the offsets of the fixed zones are named at, kept for the
	// hour so the texts the search reads are not rebuilt every second.
	const hour = Math.floor(now / 3_600_000) * 3_600_000
	const zoneLabel = useCallback((zone: string) => `${zone} (${formatUtcOffset(zone, hour)})`, [hour])

	// Zone a mode shows the times in now; the fixed zone, until one is chosen, is the one in effect, which choosing it keeps.
	function zoneOf(mode: DisplayTimeZoneMode) {
		return resolveDisplayZone({ displayTimeZone: mode, timeZone: timeZone ?? resolved.zone }, undefined, site).zone
	}

	// Line under the name of a mode: what it shows and how it differs between devices.
	function describe(mode: DisplayTimeZoneMode) {
		switch (mode) {
			case 'site':
				return site ? `${site.name} · ${site.timeZone}` : "No site selected; this device's zone stands in"
			case 'utc':
				return 'The same on every device'
			case 'browser':
				return `${BROWSER_TIME_ZONE} · each device uses its own`
			case 'zone':
				return timeZone ? `${timeZone} · the same on every device` : 'One zone you choose, the same on every device'
		}
	}

	// Makes a mode the profile's default; the fixed zone starts from the zone in effect, so no time moves.
	function choose(mode: DisplayTimeZoneMode) {
		if (mode === displayTimeZone) return
		setDateTimePreferences(profileState, mode === 'zone' && !timeZone ? { displayTimeZone: mode, timeZone: resolved.zone } : { displayTimeZone: mode })
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
			<section className="flex max-w-md flex-col gap-3">
				<SectionHeading as="h2">Display Time Zone</SectionHeading>
				<List emptyText="No zones">
					{DISPLAY_TIME_ZONE_MODES.map((mode) => (
						<ListItem key={mode} title={MODE_LABELS[mode]} description={describe(mode)} meta={formatClockTime(now, zoneOf(mode))} selected={mode === displayTimeZone} onClick={() => choose(mode)} />
					))}
				</List>
				{displayTimeZone === 'zone' && <VirtualSelect label="Zone" options={TIME_ZONES} value={resolved.zone} format={zoneLabel} onChange={(zone) => setDateTimePreferences(profileState, { timeZone: zone })} searchable searchPlaceholder="Zone or UTC offset…" />}
				{resolved.source === 'browserFallback' && (
					<Button variant="secondary" className="self-start" onClick={() => openObservingSites()}>
						Set Location
					</Button>
				)}
				<Notice>Changes only how dates and times are written, on every screen of this profile. Positions, rise and set times, sidereal times, and which night a date belongs to always follow the site. A tool with its own Time Zone selector can choose another zone for itself.</Notice>
			</section>
			<section className="flex max-w-md flex-col gap-3">
				<SectionHeading as="h2">Zone in Effect</SectionHeading>
				<DataList>
					<DataRow label="Zone">{resolved.zone}</DataRow>
					<DataRow label="Now">{formatDateTime(now, resolved.zone, false)}</DataRow>
					<DataRow label="Offset from UTC">{formatOffset(resolved.zone, now)}</DataRow>
					<DataRow label="Next Offset Change" tone={change && change.time - now < DAY_MS ? 'warning' : 'default'}>
						{change ? `${formatChangeTime(change.time, resolved.zone)} → ${formatOffset(resolved.zone, change.time)}` : 'None within a year'}
					</DataRow>
				</DataList>
			</section>
		</div>
	)
}
