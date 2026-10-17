import { useState } from 'react'
import logo from '../../assets/nebulosa.ico'
import { connectionState } from '../connection/connection'
import { Menu, MenuItem, NavigationMenu } from '../ui/NavigationMenu'

// Application top bar: logo and the primary-action menus on the left, notifications and the profile
// switcher on the right. Notifications and profiles are visual placeholders for now.

// Unread notification count shown on the bell badge; a fixed sample until notifications exist.
const NOTIFICATION_COUNT = 3

// Largest count the badge shows as a number; higher counts read as "9+".
const MAX_BADGE_COUNT = 9

// Sample profiles listed by the profile switcher, until profiles exist.
const PROFILES = ['Default', 'Backyard', 'Remote observatory'] as const

// Name of one of the sample profiles.
type Profile = (typeof PROFILES)[number]

// Returns up to two uppercase initials of a profile name, for its avatar.
function initials(name: string): string {
	return name
		.split(/\s+/)
		.slice(0, 2)
		.map((word) => word.charAt(0).toUpperCase())
		.join('')
}

// Top bar of the application window.
export function TopBar() {
	const [profile, setProfile] = useState<Profile>('Default')

	return (
		<header className="box-border flex h-14 flex-none items-center justify-between gap-4 border-b border-line-100 bg-base-000 px-4">
			<div className="flex min-w-0 items-center gap-4">
				<div className="flex flex-none items-center gap-2">
					<img src={logo} alt="" className="size-7" />
					<span className="text-lg leading-[26px] font-semibold max-sm:hidden">Nebulosa</span>
				</div>
				<NavigationMenu>
					<Menu id="devices" label="Devices">
						<MenuItem onSelect={() => (connectionState.open = true)}>Connections</MenuItem>
					</Menu>
				</NavigationMenu>
			</div>
			<div className="flex flex-none items-center gap-2">
				<NotificationButton count={NOTIFICATION_COUNT} />
				<NavigationMenu>
					<Menu
						id="profile"
						align="end"
						triggerClassName="pl-1.5"
						label={
							<>
								<span className="flex size-7 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold text-accent">{initials(profile)}</span>
								<span className="max-w-40 truncate max-sm:hidden">{profile}</span>
								<span className="-mt-1 size-[7px] rotate-45 border-r-[1.5px] border-b-[1.5px] border-ink-300" />
							</>
						}
					>
						<li className="px-2 pt-1 pb-2 text-xs leading-4 text-ink-300">Profiles</li>
						{PROFILES.map((name) => (
							<MenuItem key={name} checked={name === profile} onSelect={() => setProfile(name)}>
								{name}
							</MenuItem>
						))}
					</Menu>
				</NavigationMenu>
			</div>
		</header>
	)
}

interface NotificationButtonProps {
	// Unread notifications; the badge is hidden at zero.
	readonly count: number
}

// Bell button with an unread-count badge.
function NotificationButton({ count }: NotificationButtonProps) {
	return (
		<button
			type="button"
			title="Notifications"
			className="relative flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-ink-200 transition-colors duration-150 hover:bg-base-300 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
		>
			<svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
				<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
				<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
			</svg>
			{count > 0 && <span className="absolute top-0.5 right-0.5 box-border flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-on-accent tabular-nums">{count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : count}</span>}
		</button>
	)
}
