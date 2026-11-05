import type { CloseApproach, CloseApproachSortField } from 'api'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { MISSING } from '../../format'
import type { ObservingSite } from '../../location/site'
import { TimeZoneSelect } from '../../location/TimeZoneSelect'
import { profileState, setCloseApproachPreferences } from '../../profile/profile'
import { CLOSE_APPROACH_DISTANCE_DISPLAYS, type CloseApproachPreferences } from '../../profile/schema'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { formatMagnitude } from '../../sky/format'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Cell, Row, Table, type TableColumn } from '../../ui/Table'
import { bodyName, closeApproachesState, formatApproachTime, formatDiameter, formatDistance, formatDistanceRange, formatVelocity, loadCloseApproaches, pageCloseApproaches, pageCount, resizeCloseApproachPages, selectCloseApproach, sortCloseApproaches } from './closeapproaches'

// Table of the Close Approaches tool: one row per encounter of the page JPL answered, so an object appears once per
// encounter. Sorting and paging ask the server again: rows are never sorted or sliced here. Arrow keys, Home, and End move
// between the rows, Enter and Space select one.

// Rows per page offered.
const PAGE_SIZES = ['25', '50', '100'] as const

interface SortButtonProps {
	// Column of JPL the header orders by.
	readonly field: CloseApproachSortField
	// Header text.
	readonly children: ReactNode
}

// Header of a column JPL can order by, which orders by it and shows the direction while it does.
function SortButton({ field, children }: SortButtonProps) {
	const { filters } = useSnapshot(closeApproachesState)
	const sort = filters?.sort
	const active = sort === field || sort === `-${field}`

	return (
		<button
			type="button"
			title="Order all the matches by this column, from the first page"
			onClick={() => void sortCloseApproaches(closeApproachesState, field)}
			className={cn('inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-mono text-xs font-medium whitespace-nowrap hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent', active ? 'text-accent' : 'text-ink-300')}
		>
			{children}
			{active && <Icon name="arrow" className={cn('size-3', sort !== field && 'rotate-180')} />}
		</button>
	)
}

// Columns of the table, in the time zone and distance unit shown.
function encounterColumns(timeZone: string, distanceDisplay: CloseApproachPreferences['distanceDisplay']): readonly TableColumn[] {
	return [
		{ key: 'object', label: <SortButton field="object">Object</SortButton> },
		{ key: 'date', label: <SortButton field="date">{`Close Approach (${timeZone})`}</SortButton> },
		'Target',
		{ key: 'dist', label: <SortButton field="dist">Distance</SortButton>, numeric: true },
		{ key: 'range', label: `3σ Range (${distanceDisplay === 'au' ? 'AU' : distanceDisplay})`, numeric: true },
		{ key: 'v-rel', label: <SortButton field="v-rel">Vrel</SortButton>, numeric: true },
		{ key: 'h', label: <SortButton field="h">H</SortButton>, numeric: true },
		{ key: 'diameter', label: 'Diameter', numeric: true },
		'Orbit',
	]
}

interface EncounterRowProps {
	// Encounter of the row.
	readonly approach: CloseApproach
	// Zone of the time shown.
	readonly timeZone: string
	// Unit of the distances shown.
	readonly distanceDisplay: CloseApproachPreferences['distanceDisplay']
}

// Row of one encounter.
function EncounterRow({ approach, timeZone, distanceDisplay }: EncounterRowProps) {
	const { selected } = useSnapshot(closeApproachesState)
	const { id, fullName, designation, time, calendarDate, body, distance, distanceMin, distanceMax, relativeVelocity, absoluteMagnitude, diameter, diameterSigma, orbitId } = approach

	return (
		<Row title={`${calendarDate} TDB`} selected={selected?.id === id} onSelect={() => void selectCloseApproach(closeApproachesState, approach)}>
			<Cell className="max-w-64 truncate text-ink-100" title={fullName ?? designation}>
				{fullName ?? designation}
			</Cell>
			<Cell>{formatApproachTime(time, timeZone)}</Cell>
			<Cell>{bodyName(body)}</Cell>
			<Cell numeric>{formatDistance(distance, distanceDisplay)}</Cell>
			<Cell numeric>{formatDistanceRange(distanceMin, distanceMax, distanceDisplay) ?? MISSING}</Cell>
			<Cell numeric>{formatVelocity(relativeVelocity)}</Cell>
			<Cell numeric>{absoluteMagnitude === undefined ? MISSING : formatMagnitude(absoluteMagnitude)}</Cell>
			<Cell numeric>{diameter === undefined ? MISSING : formatDiameter(diameter, diameterSigma)}</Cell>
			<Cell>{orbitId}</Cell>
		</Row>
	)
}

interface CloseApproachTableProps {
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Preferences of the tool, its distance unit and zone choice among them.
	readonly preferences: CloseApproachPreferences
	// Active observing site of the profile, whose zone the Site choice takes; absent when it has none.
	readonly site?: ObservingSite
}

// Distance unit and time zone of the table, with where the rows came from and when. Choosing a zone only formats the
// times again: it never reads the page again.
function ResultsBar({ timeZone, preferences, site }: CloseApproachTableProps) {
	const { result, loading, pageSize } = useSnapshot(closeApproachesState)
	const { distanceDisplay, timeDisplay } = preferences
	const origin = result && `${result.total} ${result.total === 1 ? 'encounter' : 'encounters'} · ${result.source} ${result.sourceVersion} · read ${formatApproachTime(result.fetchedAt, timeZone)}`

	return (
		<div className="flex flex-none flex-wrap items-end justify-between gap-2 border-b border-line-100 px-4 py-2">
			<p className="m-0 min-w-0 text-xs leading-5 text-ink-300">{loading ? 'Reading from JPL…' : origin}</p>
			<div className="flex items-end gap-2">
				<SegmentedControl options={CLOSE_APPROACH_DISTANCE_DISPLAYS} value={distanceDisplay} format={(value) => (value === 'au' ? 'AU' : value)} onChange={(value) => setCloseApproachPreferences(profileState, { distanceDisplay: value })} />
				<TimeZoneSelect className="w-64" value={timeDisplay} site={site} onChange={(value) => setCloseApproachPreferences(profileState, { timeDisplay: value })} />
				<Select className="w-20" options={PAGE_SIZES} value={`${pageSize}` as (typeof PAGE_SIZES)[number]} onChange={(value) => void resizeCloseApproachPages(closeApproachesState, +value)} />
			</div>
		</div>
	)
}

// Page controls of the table.
function Pager() {
	const { result, page, pageSize, loading } = useSnapshot(closeApproachesState)
	if (!result) return null
	const pages = pageCount(result.total, pageSize)

	return (
		<div className="flex flex-none items-center justify-center gap-3 border-t border-line-100 px-4 py-2">
			<Button variant="secondary" disabled={loading || page <= 1} title={page <= 1 ? 'This is the first page.' : undefined} onClick={() => void pageCloseApproaches(closeApproachesState, page - 1)}>
				Previous
			</Button>
			<span className="text-xs text-ink-200 tabular-nums">
				Page {page} of {pages}
			</span>
			<Button variant="secondary" disabled={loading || page >= pages} title={page >= pages ? 'This is the last page.' : undefined} onClick={() => void pageCloseApproaches(closeApproachesState, page + 1)}>
				Next
			</Button>
		</div>
	)
}

// Encounters of the page shown, or why there are none.
export function CloseApproachTable({ timeZone, preferences, site }: CloseApproachTableProps) {
	const { result, loading, error } = useSnapshot(closeApproachesState)
	const { distanceDisplay } = preferences
	const rows = result?.rows ?? []

	return (
		<div className="flex min-h-96 flex-1 flex-col lg:min-h-0">
			<ResultsBar timeZone={timeZone} preferences={preferences} site={site} />
			{error && <EmptyState title="JPL did not answer" description={error} action={<Button onClick={() => void loadCloseApproaches(closeApproachesState)}>Retry</Button>} />}
			{!error && !result && <EmptyState title={loading ? 'Reading from JPL' : 'No search yet'} />}
			{!error && result && rows.length === 0 && <EmptyState title="No encounters" description={result.total > 0 ? 'This page is past the last match.' : 'No close approach matches these filters.'} />}
			{rows.length > 0 && (
				<Table className="flex-1 rounded-none border-0" columns={encounterColumns(timeZone, distanceDisplay)}>
					{rows.map((approach) => (
						<EncounterRow key={approach.id} approach={approach} timeZone={timeZone} distanceDisplay={distanceDisplay} />
					))}
				</Table>
			)}
			<Pager />
		</div>
	)
}
