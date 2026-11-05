import { useSnapshot } from 'valtio'
import { activeProfile, dateTimePreferences, profileState } from '../profile/profile'
import { Select } from '../ui/Select'
import { BROWSER_TIME_ZONE, describeDisplayZone, type DisplayZoneOverride, resolveDisplayZone, TIME_ZONES } from './zone'

// Selector of the zone a tool shows its civil times in: the profile's default (named with the zone it gives now), the
// site of the tool, UTC, the browser's, or any IANA zone. It changes how times read only: never an instant, a request,
// the profile's default, or a site.

export interface TimeZoneSelectProps {
	// Label above the selector.
	readonly label?: string
	// Choice of the tool.
	readonly value: DisplayZoneOverride
	// Receives the choice made.
	readonly onChange: (value: DisplayZoneOverride) => void
	// Place the tool observes from, whose zone Site takes; absent when it has none.
	readonly site?: { readonly timeZone: string }
	// Whether the site is one the tool chose rather than the active profile's, so it is named Selected Site.
	readonly selectedSite?: boolean
	// Classes of the selector.
	readonly className?: string
}

// Option of the selector: a mode of DisplayZoneOverride, or an IANA zone after "zone:".
type ZoneOption = 'default' | 'site' | 'utc' | 'browser' | `zone:${string}`

// Modes listed before the zones.
const MODES: readonly ZoneOption[] = ['default', 'site', 'utc', 'browser']

// Every option, the modes first.
const OPTIONS: readonly ZoneOption[] = [...MODES, ...TIME_ZONES.map((zone): ZoneOption => `zone:${zone}`)]

// Option of a choice.
function optionOf(value: DisplayZoneOverride): ZoneOption {
	return value.mode === 'zone' ? `zone:${value.zone}` : value.mode
}

// Choice of an option.
function valueOf(option: ZoneOption): DisplayZoneOverride {
	return option.startsWith('zone:') ? { mode: 'zone', zone: option.slice(5) } : { mode: option as Exclude<ZoneOption, `zone:${string}`> }
}

// Selector of the zone of a tool's civil times.
export function TimeZoneSelect({ label = 'Time Zone', value, onChange, site, selectedSite = false, className }: TimeZoneSelectProps) {
	const profiles = useSnapshot(profileState)
	const preference = dateTimePreferences(activeProfile(profiles).settings).displayTimeZone
	const siteName = selectedSite ? 'Selected Site' : 'Observing Site'

	function format(option: ZoneOption) {
		switch (option) {
			case 'default':
				return `Default: ${describeDisplayZone(resolveDisplayZone(preference, undefined, site))}`
			case 'site':
				return site ? `${siteName}: ${site.timeZone}` : `${siteName}: none, browser ${BROWSER_TIME_ZONE}`
			case 'utc':
				return 'UTC'
			case 'browser':
				return `Browser: ${BROWSER_TIME_ZONE}`
			default:
				return option.slice(5)
		}
	}

	return <Select label={label} options={OPTIONS} value={optionOf(value)} format={format} group={(option) => (MODES.includes(option) ? 'Display' : 'Time zones')} onChange={(option) => onChange(valueOf(option))} className={className} />
}
