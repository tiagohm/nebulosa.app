import { useSnapshot } from 'valtio'
import { openObservingSites } from '../location/site'
import { useActiveSite, useDisplayZone } from '../location/useLocation'
import { BROWSER_TIME_ZONE, describeDisplayZone, formatUtcOffset } from '../location/zone'
import { activeProfile, dateTimePreferences, profileState, setDateTimePreferences } from '../profile/profile'
import { DISPLAY_TIME_ZONE_MODES, type DisplayTimeZoneMode } from '../profile/schema'
import { Button } from '../ui/Button'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { RadioGroup } from '../ui/RadioGroup'
import { SectionHeading } from '../ui/SectionHeading'

// Date & Time section of the Settings page: the zone the active profile shows civil times in unless a tool overrides it,
// the observing site's, UTC, or the browser's. A change applies at once and belongs to the profile. It changes how times
// read only, never an instant, a calculation, the local day or night of a site, or a device.

// Names of the display modes.
const MODE_LABELS: Readonly<Record<DisplayTimeZoneMode, string>> = { site: 'Observing Site', utc: 'UTC', browser: 'Browser Time Zone' }

// Content of the Date & Time section.
export function DateTimeSettings() {
	const settings = activeProfile(useSnapshot(profileState)).settings
	const { displayTimeZone } = dateTimePreferences(settings)
	const site = useActiveSite()
	const resolved = useDisplayZone(site)
	const now = Date.now()

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
			<section className="flex max-w-md flex-col gap-3">
				<SectionHeading as="h2">Display Time Zone</SectionHeading>
				<RadioGroup label="Show Civil Times In" options={DISPLAY_TIME_ZONE_MODES} value={displayTimeZone} format={(mode) => MODE_LABELS[mode]} onChange={(mode) => setDateTimePreferences(profileState, { displayTimeZone: mode })} />
				<DataRow label="Effective Zone">{describeDisplayZone(resolved)}</DataRow>
				<DataRow label="Offset Now">{formatUtcOffset(resolved.zone, now)}</DataRow>
				<DataRow label="Browser Zone">{BROWSER_TIME_ZONE}</DataRow>
				{resolved.source === 'browserFallback' && (
					<>
						<Notice>This profile has no observing site, so civil times are shown in the browser's zone until one is selected.</Notice>
						<Button variant="secondary" className="self-start" onClick={() => openObservingSites()}>
							Set Location
						</Button>
					</>
				)}
				<Notice>
					This is how dates and times read, in every screen of this profile; a tool may choose another zone for itself. It never changes an instant, a position, a rise or set, the sidereal time, or which local day or night of a site is computed, which always follow the site and its own zone. UTC, Julian
					dates, and sidereal times keep their own definitions.
				</Notice>
			</section>
		</div>
	)
}
