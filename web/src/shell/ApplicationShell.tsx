import { useSnapshot } from 'valtio'
import { AboutPage } from '../about/AboutPage'
import { ConnectionModal } from '../connection/ConnectionModal'
import { EquipmentControlPage } from '../equipment-control/EquipmentControlPage'
import { EquipmentModal } from '../equipment/EquipmentModal'
import { TopBar } from '../layout/TopBar'
import { NotificationToasts } from '../notifications/NotificationToasts'
import { ProfileModal } from '../profile/ProfileModal'
import { SettingsPage } from '../settings/SettingsPage'
import { NavigationRail } from './NavigationRail'
import { routeState } from './route'
import { StatusBar } from './StatusBar'
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary'
import { workspaceDefinition } from './workspaces'

// Persistent frame of the application: top bar, navigation rail, the active workspace, the Equipment
// Control page, the Settings page, or the About page, status bar, the management modals, and the notification toasts. The frame stays mounted while navigating; only the
// active workspace's component is swapped, and unmounting it releases presentation resources only. A workspace that
// throws while rendering shows its failure in its place (WorkspaceErrorBoundary), and the rest of the frame stays.

// Application shell.
export function ApplicationShell() {
	const { route } = useSnapshot(routeState)
	const Workspace = route.workspace === 'equipment' ? EquipmentControlPage : route.workspace === 'settings' ? SettingsPage : route.workspace === 'about' ? AboutPage : workspaceDefinition(route.workspace).component

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-base-100">
			<TopBar />
			<div className="flex min-h-0 flex-1">
				<NavigationRail />
				<WorkspaceErrorBoundary key={route.workspace}>
					<Workspace />
				</WorkspaceErrorBoundary>
			</div>
			<StatusBar />
			<ConnectionModal />
			<EquipmentModal />
			<ProfileModal />
			<NotificationToasts />
		</div>
	)
}
