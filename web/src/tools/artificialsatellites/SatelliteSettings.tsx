import type { SatelliteGroupStatus } from 'api'
import { useSnapshot } from 'valtio'
import { formatDateTime } from '../../format'
import { downloadSatelliteSource, satelliteCatalogState, setSatelliteAutoDownload } from '../../satellites/satellites'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Modal } from '../../ui/Modal'
import { Notice } from '../../ui/Notice'

// Settings of Artificial Satellites, opened from the workspace actions of the tool: the CelesTrak groups of the server's
// catalog, each with its download state, a download now, and the choice of downloading it automatically. The choices
// belong to the server, shared by every profile and tab, and its downloads follow CelesTrak's fair-use rules whoever
// asks.

// State of the downloads of a group, in words, its instants in an IANA time zone.
function groupStatus(group: SatelliteGroupStatus, now: number, timeZone: string) {
	const parts = [group.members > 0 ? `${group.members} objects` : 'Not downloaded']
	if (group.gp?.lastSuccessAt) parts.push(`elements read ${formatDateTime(group.gp.lastSuccessAt, timeZone)}`)
	if (group.gpAllowedAt > now) parts.push(`next download from ${formatDateTime(group.gpAllowedAt, timeZone)}`)
	if (group.gp?.lastError) parts.push(`last failure: ${group.gp.lastError}`)
	return parts.join(' · ')
}

interface GroupRowProps {
	readonly group: SatelliteGroupStatus
	readonly now: number
	// IANA time zone the instants of the group are shown in.
	readonly timeZone: string
}

// One CelesTrak group: its state, its automatic downloads, and a download now.
function GroupRow({ group, now, timeZone }: GroupRowProps) {
	const { downloading, errors } = useSnapshot(satelliteCatalogState)
	const key = `gp:GROUP:${group.group}`
	const waiting = group.gpAllowedAt > now

	return (
		<li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-100 py-2 pe-1 last:border-b-0">
			<span className="min-w-0 flex-1 basis-64">
				<span className="text-ink-100">{group.label}</span>
				{group.large && <span className="ml-2 text-xs text-warning">large</span>}
				<span className="block text-xs text-ink-300">{groupStatus(group, now, timeZone)}</span>
				{errors[key] && <span className="block text-xs text-danger">{errors[key]}</span>}
			</span>
			<span className="flex flex-none items-center gap-4">
				<Checkbox label="Automatic" checked={group.autoDownload} onChange={(enabled) => void setSatelliteAutoDownload(satelliteCatalogState, key, enabled)} />
				<Button
					variant="secondary"
					className="w-32"
					disabled={key in downloading || waiting}
					title={waiting ? `CelesTrak is not asked again before ${formatDateTime(group.gpAllowedAt, timeZone)}.` : 'Downloads the elements of the group from CelesTrak now.'}
					onClick={() => void downloadSatelliteSource(satelliteCatalogState, key)}
				>
					{key in downloading ? 'Downloading…' : group.members > 0 ? 'Refresh' : 'Download'}
				</Button>
			</span>
		</li>
	)
}

export interface SatelliteSettingsProps {
	// Whether the settings are shown.
	readonly open: boolean
	// Closes them.
	readonly onClose: () => void
	// IANA time zone the tool shows its civil times in.
	readonly timeZone: string
}

// Settings of the tool.
export function SatelliteSettings({ open, onClose, timeZone }: SatelliteSettingsProps) {
	const { snapshot } = useSnapshot(satelliteCatalogState)
	const now = Date.now()

	return (
		<Modal open={open} onClose={onClose} title="Settings" className="max-w-[760px]" fit>
			<div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
				<h3 className="m-0 text-sm font-semibold text-ink-100">CelesTrak Groups</h3>
				<Notice>
					Groups are downloaded from CelesTrak when you ask, and those marked Automatic also when the server starts and every 6 hours. Each group is downloaded at most once per update of its data (every 2 hours), and never by opening the Sky or this tool. Large groups take longer and their catalog data is not
					downloaded with them.
				</Notice>
				{!snapshot && <Notice>Reading the catalog sources…</Notice>}
				{snapshot && (
					<ul className="m-0 flex list-none flex-col p-0">
						{snapshot.groups.map((group) => (
							<GroupRow key={group.group} group={group} now={now} timeZone={timeZone} />
						))}
					</ul>
				)}
			</div>
		</Modal>
	)
}
