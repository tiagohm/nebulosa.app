import { useSnapshot } from 'valtio'
import { activeProfile, dateTimePreferences, profileState } from '../profile/profile'
import { activeSite, type ObservingSite, type ResolvedLocation, resolveToolLocation, siteState, type ToolLocation } from './site'
import { type DisplayZone, type DisplayZoneOverride, resolveDisplayZone } from './zone'

// Hooks of the place a screen observes from and the zone it shows civil times in, read from the active profile and the
// catalog of sites, re-rendering when either changes. They derive everything: nothing here is stored.

// Returns the site the active profile observes from; undefined when it has none.
export function useActiveSite(): ObservingSite | undefined {
	const profiles = useSnapshot(profileState)
	const { sites } = useSnapshot(siteState)
	return activeSite(activeProfile(profiles), sites)
}

// Returns the place a tool observes from (ToolLocation); undefined when the profile has no site or the saved site was
// deleted.
export function useToolLocation(location: ToolLocation): ResolvedLocation | undefined {
	const profiles = useSnapshot(profileState)
	const { sites } = useSnapshot(siteState)
	return resolveToolLocation(location, activeProfile(profiles).activeSiteId, sites)
}

// Returns the zone civil times are shown in for a screen observing from site (the active profile's site when the
// screen has no place of its own), under the override of the screen, if any.
export function useDisplayZone(site: { readonly timeZone: string } | undefined, override?: DisplayZoneOverride): DisplayZone {
	const profiles = useSnapshot(profileState)
	return resolveDisplayZone(dateTimePreferences(activeProfile(profiles).settings).displayTimeZone, override, site)
}
