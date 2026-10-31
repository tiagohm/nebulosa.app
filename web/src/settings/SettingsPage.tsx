import { useSnapshot } from 'valtio'
import { navigate, routeState, SETTINGS_SECTION_IDS, type SettingsSectionId, settingsSection } from '../shell/route'
import { Select } from '../ui/Select'
import { ExternalToolsActions, ExternalToolsSettings } from './ExternalToolsSettings'
import { StatusBarSettings } from './StatusBarSettings'

// Settings page (the gear button of the top bar): a selector of its sections in the header, like the Images tool
// selector, with the actions of the section shown beside it, and the section below. The section shown is part of
// the URL. External Tools belongs to the server instance, Status Bar to the active profile.

// Display name of each section.
const SECTION_LABELS: Readonly<Record<SettingsSectionId, string>> = { 'external-tools': 'External Tools', 'status-bar': 'Status Bar' }

// Settings page.
export function SettingsPage() {
	const { route } = useSnapshot(routeState)
	const section = route.workspace === 'settings' ? settingsSection(route) : SETTINGS_SECTION_IDS[0]
	const tool = route.workspace === 'settings' ? route.tool : undefined

	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<header className="flex min-h-12 flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-100 bg-base-100 px-4 py-1.5">
				<h1 className="m-0 flex-none text-sm font-semibold text-ink-100">Settings</h1>
				<Select options={SETTINGS_SECTION_IDS} value={section} format={(id) => SECTION_LABELS[id]} onChange={(id) => id !== section && navigate(routeState, { workspace: 'settings', section: id })} className="w-52 max-sm:w-40" />
				<div className="ml-auto flex flex-none items-center gap-2">{section === 'external-tools' && <ExternalToolsActions />}</div>
			</header>
			{section === 'external-tools' && <ExternalToolsSettings tool={tool} />}
			{section === 'status-bar' && <StatusBarSettings />}
		</section>
	)
}
