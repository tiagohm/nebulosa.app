import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import logo from '../../assets/nebulosa.ico'
import { connectionState } from '../connection/connection'
import { ConnectionIndicator } from '../connection/ConnectionIndicator'
import { deviceState } from '../equipment/equipment'
import { NotificationButton } from '../notifications/NotificationButton'
import { ProfileMenu } from '../profile/ProfileMenu'
import { navigate, routeState } from '../shell/route'
import { Icon } from '../ui/Icon'
import { Menu, MenuItem, NavigationMenu } from '../ui/NavigationMenu'

// Application top bar: logo and the primary-action menus on the left, the connection status, the notification bell,
// the Settings page button, and the profile switcher on the right.

// Classes of the round icon buttons of the right side of the bar.
const ICON_BUTTON_CLASS = 'relative flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-ink-200 transition-colors duration-150 hover:bg-base-300 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

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
					</Menu>
				</NavigationMenu>
			</div>
			<div className="flex flex-none items-center gap-2">
				<ConnectionIndicator />
				<NotificationButton className={ICON_BUTTON_CLASS} />
				<SettingsButton />
				<ProfileMenu />
			</div>
		</header>
	)
}

// Gear button opening the Settings page, highlighted while it is shown.
function SettingsButton() {
	const { route } = useSnapshot(routeState)
	const active = route.workspace === 'settings'

	return (
		<button type="button" title="Settings" className={cn(ICON_BUTTON_CLASS, active && 'bg-base-300 text-ink-100')} onClick={() => navigate(routeState, { workspace: 'settings' })}>
			<Icon name="settings" />
		</button>
	)
}
