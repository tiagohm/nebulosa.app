import type { SatelliteGroupStatus, SatelliteSummary } from 'api'
import { cn } from 'cn'
import type { KeyboardEvent } from 'react'
import { useSnapshot } from 'valtio'
import { activeProfile, profileState, satelliteFavorites, setSatelliteFavorite } from '../../profile/profile'
import { downloadSatelliteSource, satelliteCatalogState } from '../../satellites/satellites'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { inputClassName } from '../../ui/Field'
import { IconButton } from '../../ui/IconButton'
import { moveIndex } from '../../ui/navigation'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { Note } from '../eclipse/EclipsePanelParts'
import { artificialSatellitesState, CATALOG_PAGE_SIZE, formatSatelliteTime, importSatelliteElements, searchSatellites, selectSatellite } from './artificialsatellites'

// Catalog tab of Artificial Satellites: the local search of the server's catalog (never CelesTrak), its groups with
// their downloads, and imports of element sets. A download is the only action that reaches CelesTrak, made by the
// server under its fair-use rules: a refused one shows the server's reason, never a spinner.

// Names of the SATCAT object types.
const OBJECT_TYPE_NAMES = { payload: 'Payload', rocketBody: 'Rocket body', debris: 'Debris', unknown: 'Unknown' } as const

// Text of an absent value.
const ABSENT = '—'

// Searches the catalog with the state of the tab and the favorites of the active profile.
function search(offset = 0) {
	void searchSatellites(artificialSatellitesState, satelliteFavorites(activeProfile(profileState).settings), offset)
}

// Name of a group for its source key: an allowlisted group by its label, the imports, or the key itself.
function groupName(sourceKey: string, groups: readonly SatelliteGroupStatus[]) {
	if (sourceKey === 'manual') return 'Imported'
	const [provider, , value] = sourceKey.split(':')
	const group = groups.find((entry) => entry.group === value)
	return group && provider === 'gp' ? group.label : sourceKey
}

// Search form of the catalog.
function SearchForm() {
	const { query, group, favoritesOnly, searching } = useSnapshot(artificialSatellitesState)
	const { snapshot } = useSnapshot(satelliteCatalogState)
	const groups = snapshot?.groups.filter((entry) => entry.members > 0).map((entry) => `gp:GROUP:${entry.group}`) ?? []
	const options = ['', ...groups, ...(snapshot?.imported ? ['manual'] : [])]

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				search()
			}}
			className="flex flex-none flex-wrap items-end gap-2 border-b border-line-100 bg-base-100 px-4 py-3"
		>
			<TextInput label="Name, NORAD ID, or COSPAR ID" className="w-72 max-w-full" value={query} onChange={(event) => (artificialSatellitesState.query = event.target.value)} />
			<Select label="Group" className="w-56" options={options} value={options.includes(group) ? group : ''} format={(value) => (value ? groupName(value, snapshot?.groups ?? []) : 'Every object')} onChange={(value) => (artificialSatellitesState.group = value)} />
			<span className="flex h-9.5 items-center">
				<Checkbox label="Favorites only" checked={favoritesOnly} onChange={(value) => (artificialSatellitesState.favoritesOnly = value)} />
			</span>
			<Button type="submit" className="ml-auto" disabled={searching}>
				Search
			</Button>
		</form>
	)
}

interface SatelliteRowProps {
	readonly satellite: SatelliteSummary
	readonly favorite: boolean
	readonly index: number
	readonly count: number
}

// Row of one object of the catalog.
function SatelliteRow({ satellite, favorite, index, count }: SatelliteRowProps) {
	const { selectedId } = useSnapshot(artificialSatellitesState)
	const { noradId, name, cosparId, objectType, elementKind, elementEpoch } = satellite
	const select = () => void selectSatellite(artificialSatellitesState, noradId, activeProfile(profileState).settings.sky.observer)

	function press(event: KeyboardEvent<HTMLTableRowElement>) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault()
			select()
			return
		}

		const next = moveIndex(index, count, event.key)
		if (next === undefined) return
		event.preventDefault()
		;(event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
	}

	return (
		<tr tabIndex={0} onClick={select} onKeyDown={press} className={cn('cursor-pointer border-b border-line-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', selectedId === noradId ? 'bg-accent-subtle' : 'hover:bg-base-200')}>
			<td className="px-2 py-1">
				<IconButton
					icon="pin"
					label={favorite ? 'Remove from favorites' : 'Add to favorites'}
					pressed={favorite}
					onClick={(event) => {
						event.stopPropagation()
						setSatelliteFavorite(profileState, noradId, !favorite)
					}}
				/>
			</td>
			<td className="max-w-64 truncate px-2 py-1.5 text-ink-100" title={name}>
				{name}
			</td>
			<td className="px-2 py-1.5 text-right">{noradId}</td>
			<td className="px-2 py-1.5 whitespace-nowrap">{cosparId ?? ABSENT}</td>
			<td className="px-2 py-1.5 whitespace-nowrap">{objectType ? OBJECT_TYPE_NAMES[objectType] : ABSENT}</td>
			<td className="px-2 py-1.5 whitespace-nowrap" title={elementKind ? undefined : 'No orbital elements: catalog data only, no prediction.'}>
				{elementEpoch === undefined ? 'Catalog only' : `${elementKind === 'manual' ? 'Imported' : 'GP'} · ${formatSatelliteTime(elementEpoch, 'UTC')} UTC`}
			</td>
		</tr>
	)
}

// Objects of the page, or why there are none.
function Results() {
	const { results, searching, searchError, offset } = useSnapshot(artificialSatellitesState)
	const profiles = useSnapshot(profileState)
	const { snapshot } = useSnapshot(satelliteCatalogState)
	const favorites = satelliteFavorites(activeProfile(profiles).settings)
	const items = results?.items ?? []
	const total = results?.total ?? 0

	if (searchError) return <EmptyState title="The catalog could not be searched" description={searchError} action={<Button onClick={() => search(offset)}>Retry</Button>} />
	if (!results) return <EmptyState title={searching ? 'Searching' : 'No search yet'} />
	if (items.length === 0) return <EmptyState title={snapshot?.objects === 0 ? 'No catalog downloaded' : 'No satellite matches'} description={snapshot?.objects === 0 ? 'Download a group below, such as Space stations, or import element sets.' : 'Change the search, or download more groups below.'} />

	return (
		<div className="flex min-h-80 flex-1 flex-col">
			<div className="min-h-0 flex-1 overflow-auto">
				<table className="w-full border-collapse font-mono text-xs text-ink-200 tabular-nums">
					<thead className="sticky top-0 z-1 bg-base-100">
						<tr className="border-b border-line-100 text-left text-ink-300">
							<th className="w-10 px-2 py-2 font-normal">
								<span className="sr-only">Favorite</span>
							</th>
							<th className="px-2 py-2 font-normal">Name</th>
							<th className="px-2 py-2 text-right font-normal">NORAD</th>
							<th className="px-2 py-2 font-normal">COSPAR</th>
							<th className="px-2 py-2 font-normal">Type</th>
							<th className="px-2 py-2 font-normal">Elements (epoch)</th>
						</tr>
					</thead>
					<tbody>
						{items.map((satellite, index) => (
							<SatelliteRow key={satellite.noradId} satellite={satellite} favorite={favorites.includes(satellite.noradId)} index={index} count={items.length} />
						))}
					</tbody>
				</table>
			</div>
			<div className="flex flex-none items-center justify-center gap-3 border-t border-line-100 px-4 py-2">
				<Button variant="secondary" disabled={searching || offset === 0} onClick={() => search(Math.max(0, offset - CATALOG_PAGE_SIZE))}>
					Previous
				</Button>
				<span className="text-xs text-ink-200 tabular-nums">
					{offset + 1}–{offset + items.length} of {total}
				</span>
				<Button variant="secondary" disabled={searching || offset + CATALOG_PAGE_SIZE >= total} onClick={() => search(offset + CATALOG_PAGE_SIZE)}>
					Next
				</Button>
			</div>
		</div>
	)
}

// State of the downloads of a group, in words.
function groupStatus(group: SatelliteGroupStatus, now: number) {
	const parts = [group.members > 0 ? `${group.members} objects` : 'Not downloaded']
	if (group.gp?.lastSuccessAt) parts.push(`elements read ${formatSatelliteTime(group.gp.lastSuccessAt, '')}`)
	if (group.gpAllowedAt > now) parts.push(`next download from ${formatSatelliteTime(group.gpAllowedAt, '')}`)
	if (group.gp?.lastError) parts.push(`last failure: ${group.gp.lastError}`)
	return parts.join(' · ')
}

// Groups of CelesTrak with their downloads.
function Sources() {
	const { snapshot, downloading, errors } = useSnapshot(satelliteCatalogState)
	const now = Date.now()
	if (!snapshot) return <Note>Reading the catalog sources…</Note>

	return (
		<div className="flex flex-col gap-2">
			<Note>Groups are downloaded from CelesTrak only when you ask, at most once per update of its data (every 2 hours), and never by opening the Sky or this tool. Large groups take longer and their catalog data is not downloaded with them.</Note>
			<ul className="m-0 flex list-none flex-col gap-1 p-0">
				{snapshot.groups.map((group) => {
					const key = `gp:GROUP:${group.group}`
					const waiting = group.gpAllowedAt > now
					return (
						<li key={key} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-100 py-1.5 last:border-b-0">
							<span className="min-w-0">
								<span className="text-ink-100">{group.label}</span>
								{group.large && <span className="ml-2 text-xs text-warning">large</span>}
								<span className="block text-xs text-ink-300">{groupStatus(group, now)}</span>
								{errors[key] && <span className="block text-xs text-danger">{errors[key]}</span>}
							</span>
							<Button
								variant="secondary"
								size="sm"
								disabled={key in downloading || waiting}
								title={waiting ? `CelesTrak is not asked again before ${formatSatelliteTime(group.gpAllowedAt, '')}.` : 'Downloads the elements of the group from CelesTrak.'}
								onClick={() => void downloadSatelliteSource(satelliteCatalogState, key)}
							>
								{key in downloading ? 'Downloading…' : group.members > 0 ? 'Refresh' : 'Download'}
							</Button>
						</li>
					)
				})}
			</ul>
		</div>
	)
}

// Import of element sets typed or pasted.
function Import() {
	const { importText, importing, importResult, importError } = useSnapshot(artificialSatellitesState)

	return (
		<div className="flex flex-col gap-2">
			<textarea className={cn(inputClassName, 'h-32 resize-y py-2 font-mono text-xs')} placeholder={'OMM JSON, or TLE sets:\nISS (ZARYA)\n1 25544U 98067A …\n2 25544  51.6415 …'} value={importText} onChange={(event) => (artificialSatellitesState.importText = event.target.value)} />
			<Button className="self-start" disabled={importing || !importText.trim()} onClick={() => void importSatelliteElements(artificialSatellitesState)}>
				Import
			</Button>
			{importError && <Note danger>{importError}</Note>}
			{importResult && (
				<Note>
					{importResult.imported.length} imported{importResult.imported.length > 0 ? `: ${importResult.imported.map((entry) => entry.name).join(', ')}` : ''}.
					{importResult.rejected.length > 0 && ` ${importResult.rejected.length} left out (${importResult.rejected.map((entry) => `${entry.noradId ?? `#${entry.index + 1}`}: ${entry.error}`).join(', ')}).`} Imported elements are used for their satellites until you choose GP elements again.
				</Note>
			)}
		</div>
	)
}

// Catalog tab.
export function SatelliteCatalog() {
	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<SearchForm />
			<Results />
			<CollapsibleSection id="satellites.sources" title="CelesTrak Groups">
				<Sources />
			</CollapsibleSection>
			<CollapsibleSection id="satellites.import" title="Import Elements" defaultOpen={false}>
				<Import />
			</CollapsibleSection>
		</div>
	)
}
