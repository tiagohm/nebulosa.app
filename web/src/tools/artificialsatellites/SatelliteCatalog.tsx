import type { SatelliteGroupStatus, SatelliteSummary } from 'api'
import { useSnapshot } from 'valtio'
import { formatUtcDateTime, MISSING } from '../../format'
import { activeSite, siteState } from '../../location/site'
import { activeProfile, profileState, satelliteFavorites, setSatelliteFavorite } from '../../profile/profile'
import { satelliteCatalogState } from '../../satellites/satellites'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { IconButton } from '../../ui/IconButton'
import { Select } from '../../ui/Select'
import { Cell, Row, Table } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { artificialSatellitesState, CATALOG_PAGE_SIZE, searchSatellites, selectSatellite } from './artificialsatellites'

// Catalog tab of Artificial Satellites: the local search of the server's catalog (never CelesTrak), its pages, and the
// favorites of the profile. The groups and their downloads are in the Settings of the tool, the imports in the Import
// Elements popover of its workspace actions.

// Names of the SATCAT object types.
const OBJECT_TYPE_NAMES = { payload: 'Payload', rocketBody: 'Rocket body', debris: 'Debris', unknown: 'Unknown' } as const

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
}

// Row of one object of the catalog.
function SatelliteRow({ satellite, favorite }: SatelliteRowProps) {
	const { selectedId } = useSnapshot(artificialSatellitesState)
	const { noradId, name, cosparId, objectType, elementKind, elementEpoch } = satellite
	const select = () => void selectSatellite(artificialSatellitesState, noradId, activeSite(activeProfile(profileState), siteState.sites))

	return (
		<Row selected={selectedId === noradId} onSelect={select}>
			<Cell className="w-10 py-1">
				<IconButton
					icon="pin"
					label={favorite ? 'Remove from favorites' : 'Add to favorites'}
					pressed={favorite}
					onClick={(event) => {
						event.stopPropagation()
						setSatelliteFavorite(profileState, noradId, !favorite)
					}}
				/>
			</Cell>
			<Cell className="max-w-64 truncate text-ink-100" title={name}>
				{name}
			</Cell>
			<Cell numeric>{noradId}</Cell>
			<Cell>{cosparId ?? MISSING}</Cell>
			<Cell>{objectType ? OBJECT_TYPE_NAMES[objectType] : MISSING}</Cell>
			<Cell title={elementKind ? undefined : 'No orbital elements: catalog data only, no prediction.'}>{elementEpoch === undefined ? 'Catalog only' : `${elementKind === 'manual' ? 'Imported' : 'GP'} · ${formatUtcDateTime(elementEpoch)}`}</Cell>
		</Row>
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
	if (items.length === 0) return <EmptyState title={snapshot?.objects === 0 ? 'No catalog downloaded' : 'No satellite matches'} description={snapshot?.objects === 0 ? 'Download a group in Settings, such as Space stations, or import element sets.' : 'Change the search, or download more groups in Settings.'} />

	return (
		<div className="flex min-h-80 flex-1 flex-col">
			<Table className="flex-1 rounded-none border-0" columns={[{ key: 'favorite', label: <span className="sr-only">Favorite</span> }, 'Name', { key: 'norad', label: 'NORAD', numeric: true }, 'COSPAR', 'Type', 'Elements (epoch)']}>
				{items.map((satellite) => (
					<SatelliteRow key={satellite.noradId} satellite={satellite} favorite={favorites.includes(satellite.noradId)} />
				))}
			</Table>
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

// Catalog tab.
export function SatelliteCatalog() {
	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<SearchForm />
			<Results />
		</div>
	)
}
