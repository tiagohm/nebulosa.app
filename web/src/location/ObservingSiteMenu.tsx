import { useSnapshot } from 'valtio'
import { formatGeographic } from '../format'
import { activeProfile, profileState } from '../profile/profile'
import { Icon } from '../ui/Icon'
import { Menu, MenuItem, NavigationMenu } from '../ui/NavigationMenu'
import { activeSite, openObservingSites, selectSite, siteState } from './site'

// Site switcher of the active profile: a pin with the name of the site the profile observes from, or Set Location,
// opening the saved sites to choose one in one click, No Active Site, and Manage Sites. Below the sm breakpoint only the
// pin shows, the name staying in its title. Choosing a site changes the profile only: it never commands a device.

// Dropdown that selects the site the active profile observes from.
export function ObservingSiteMenu() {
	const profiles = useSnapshot(profileState)
	const { sites } = useSnapshot(siteState)
	const profile = activeProfile(profiles)
	const site = activeSite(profile, sites)
	const label = site?.name ?? 'Set Location'

	return (
		<NavigationMenu>
			<Menu
				id="observing-site"
				align="end"
				triggerClassName="max-w-56 max-sm:px-2"
				label={
					<span className="flex min-w-0 items-center gap-1.5" title={site ? `${site.name} · ${formatGeographic(site.latitude, site.longitude)} · ${site.timeZone}` : 'No observing site selected in this profile'}>
						<Icon name="location" className={site ? 'size-4.5' : 'size-4.5 text-ink-300'} />
						<span className={site ? 'truncate max-sm:hidden' : 'truncate text-ink-300 max-sm:hidden'}>{label}</span>
					</span>
				}
			>
				<li className="px-2 pt-1 pb-2 text-xs leading-4 text-ink-300">Observing Sites</li>
				{sites.map((entry) => (
					<MenuItem key={entry.id} checked={entry.id === site?.id} onSelect={() => selectSite(profileState, siteState, entry.id)}>
						{entry.name}
					</MenuItem>
				))}
				<MenuItem checked={site === undefined} onSelect={() => selectSite(profileState, siteState, undefined)}>
					No Active Site
				</MenuItem>
				<li className="mx-2 my-1 h-px bg-line-100" />
				<MenuItem onSelect={() => openObservingSites(site?.id)}>{sites.length === 0 ? 'Add Site' : 'Manage Sites'}</MenuItem>
			</Menu>
		</NavigationMenu>
	)
}
