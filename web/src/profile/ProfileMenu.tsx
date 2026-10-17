import { useSnapshot } from 'valtio'
import { Menu, MenuItem, NavigationMenu } from '../ui/NavigationMenu'
import { activeProfile, profileState, selectProfile } from './profile'

// Top bar profile switcher: the active profile's avatar and name, opening a list of the profiles with
// the actions that create and manage them.

// Returns up to two uppercase initials of a profile name, for its avatar.
function initials(name: string): string {
	return name
		.split(/\s+/)
		.slice(0, 2)
		.map((word) => word.charAt(0).toUpperCase())
		.join('')
}

// Dropdown that switches the tab's active profile and opens the profile management modal.
export function ProfileMenu() {
	const state = useSnapshot(profileState)
	const active = activeProfile(state)

	return (
		<NavigationMenu>
			<Menu
				id="profile"
				align="end"
				triggerClassName="pl-1.5"
				label={
					<>
						<span className="flex size-7 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold text-accent">{initials(active.name)}</span>
						<span className="max-w-40 truncate max-sm:hidden">{active.name}</span>
						<span className="-mt-1 size-[7px] rotate-45 border-r-[1.5px] border-b-[1.5px] border-ink-300" />
					</>
				}
			>
				<li className="px-2 pt-1 pb-2 text-xs leading-4 text-ink-300">Profiles</li>
				{state.profiles.map((profile) => (
					<MenuItem key={profile.id} checked={profile.id === active.id} onSelect={() => selectProfile(profileState, profile.id)}>
						{profile.name}
					</MenuItem>
				))}
				<li className="mx-2 my-1 h-px bg-line-100" />
				<MenuItem onSelect={() => (profileState.open = true)}>New Profile</MenuItem>
				<MenuItem onSelect={() => (profileState.open = true)}>Manage Profiles</MenuItem>
			</Menu>
		</NavigationMenu>
	)
}
