import logo from '../../assets/nebulosa.ico'
import { connectionState } from '../connection/connection'
import { ConnectionIndicator } from '../connection/ConnectionIndicator'
import { deviceState } from '../equipment/equipment'
import { ProfileMenu } from '../profile/ProfileMenu'
import { navigate, routeState } from '../shell/route'
import { Icon } from '../ui/Icon'
import { Menu, MenuItem, NavigationMenu, SubMenu } from '../ui/NavigationMenu'

// Application top bar: logo and the primary-action menus on the left, the connection status,
// notifications, and the profile switcher on the right. Notifications are a visual placeholder for now.

// Unread notification count shown on the bell badge; a fixed sample until notifications exist.
const NOTIFICATION_COUNT = 3

// Largest count the badge shows as a number; higher counts read as "9+".
const MAX_BADGE_COUNT = 9

// Top bar of the application window.
export function TopBar() {
	return (
		<header className="box-border flex h-14 flex-none items-center justify-between gap-4 border-b border-line-100 bg-base-000 px-4">
			<div className="flex min-w-0 items-center gap-4">
				<div className="flex flex-none items-center gap-2">
					<img src={logo} alt="" className="size-7" />
					<span className="text-lg leading-[26px] font-semibold max-sm:hidden">Nebulosa</span>
				</div>
				<NavigationMenu>
					<Menu id="management" label="Management">
						<MenuItem onSelect={() => (connectionState.open = true)}>Connections</MenuItem>
						<MenuItem onSelect={() => (deviceState.open = true)}>Equipment Setup</MenuItem>
						<MenuItem onSelect={() => navigate(routeState, { workspace: 'equipment' })}>Equipment Control</MenuItem>
						<SubMenu id="settings" label="Settings">
							<MenuItem onSelect={() => navigate(routeState, { workspace: 'settings' })}>External Tools</MenuItem>
						</SubMenu>
					</Menu>
				</NavigationMenu>
			</div>
			<div className="flex flex-none items-center gap-2">
				<ConnectionIndicator />
				<NotificationButton count={NOTIFICATION_COUNT} />
				<ProfileMenu />
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
			<Icon name="bell" />
			{count > 0 && <span className="absolute top-0.5 right-0.5 box-border flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-on-accent tabular-nums">{count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : count}</span>}
		</button>
	)
}
