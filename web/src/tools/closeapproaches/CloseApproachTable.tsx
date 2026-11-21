import type { CloseApproach, CloseApproachSortField } from 'api'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { formatDateTime, MISSING } from '../../format'
import { profileState, setCloseApproachPreferences } from '../../profile/profile'
import { CLOSE_APPROACH_DISTANCE_DISPLAYS, type CloseApproachPreferences } from '../../profile/schema'
import { navigate, routeState } from '../../shell/route'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { formatMagnitude } from '../../sky/format'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { Pager } from '../../ui/Pager'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Cell, Row, SortHeader, Table, type TableColumn } from '../../ui/Table'
import { bodyName, type CloseApproachFailureNotice, closeApproachesState, closeApproachFailureNotice, formatDiameter, formatDistance, formatDistanceRange, formatVelocity, loadCloseApproaches, pageCloseApproaches, resizeCloseApproachPages, selectCloseApproach, sortCloseApproaches } from './closeapproaches'

// Table of the Close Approaches tool: one row per encounter of the page JPL answered, so an object appears once per
// encounter, its distance next to its name. Sorting and paging ask the server again: rows are never sorted or sliced
// here. Arrow keys, Home, and End move between the rows, Enter and Space select one. A failure keeps the rows of the
// page shown, under a notice naming it; only without rows does it take the place of the table.

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
	const direction = sort === field ? 'up' : sort === `-${field}` ? 'down' : undefined

	return (
		<SortHeader direction={direction} title="Order all the matches by this column, from the first page" onClick={() => void sortCloseApproaches(closeApproachesState, field)}>
			{children}
		</SortHeader>
	)
}

// Columns of the table, in the time zone shown.
function encounterColumns(timeZone: string): readonly TableColumn[] {
	return [
		{ key: 'object', label: <SortButton field="object">Object</SortButton> },
		{ key: 'dist', label: <SortButton field="dist">Distance</SortButton>, numeric: true },
		{ key: 'date', label: <SortButton field="date">{`Close Approach (${timeZone})`}</SortButton> },
		'Target',
		{ key: 'range', label: '3σ Range', numeric: true },
		{ key: 'v-rel', label: <SortButton field="v-rel">Vrel</SortButton>, numeric: true },
		{ key: 'h', label: <SortButton field="h">H</SortButton>, numeric: true },
		{ key: 'diameter', label: 'Diameter', numeric: true },
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
	const { id, fullName, designation, time, calendarDate, body, distance, distanceMin, distanceMax, relativeVelocity, absoluteMagnitude, diameter, diameterSigma } = approach

	return (
		<Row title={`${calendarDate} TDB`} selected={selected?.id === id} onSelect={() => void selectCloseApproach(closeApproachesState, approach)}>
			<Cell className="max-w-64 truncate text-ink-100" title={fullName ?? designation}>
				{fullName ?? designation}
			</Cell>
			<Cell numeric className="whitespace-nowrap text-ink-100">
				{formatDistance(distance, distanceDisplay)}
			</Cell>
			<Cell className="whitespace-nowrap">{formatDateTime(time, timeZone)}</Cell>
			<Cell>{bodyName(body)}</Cell>
			<Cell numeric className="whitespace-nowrap">
				{formatDistanceRange(distanceMin, distanceMax, distanceDisplay) ?? MISSING}
			</Cell>
			<Cell numeric className="whitespace-nowrap">
				{formatVelocity(relativeVelocity)}
			</Cell>
			<Cell numeric>{absoluteMagnitude === undefined ? MISSING : formatMagnitude(absoluteMagnitude)}</Cell>
			<Cell numeric className="whitespace-nowrap">
				{diameter === undefined ? MISSING : formatDiameter(diameter, diameterSigma)}
			</Cell>
		</Row>
	)
}

interface CloseApproachTableProps {
	// IANA zone the times are shown in.
	readonly timeZone: string
	// Preferences of the tool, its distance unit among them.
	readonly preferences: CloseApproachPreferences
}

// Distance unit of the table and rows per page, with where the rows came from and when. Choosing a unit only formats the
// distances again: it never reads the page again.
function ResultsBar({ timeZone, preferences }: CloseApproachTableProps) {
	const { result, loading, pageSize } = useSnapshot(closeApproachesState)
	const { distanceDisplay } = preferences
	const origin = result && `${result.total} ${result.total === 1 ? 'encounter' : 'encounters'} · ${result.source} ${result.sourceVersion} · read ${formatDateTime(result.fetchedAt, timeZone)}`
	const rows = `${result?.pageSize ?? pageSize}` as (typeof PAGE_SIZES)[number]

	return (
		<div className="flex flex-none flex-wrap items-end justify-between gap-2 border-b border-line-100 px-4 py-2">
			<p className="m-0 min-w-0 text-xs leading-5 text-ink-300">{loading ? 'Reading from JPL…' : origin}</p>
			<div className="flex items-end gap-2">
				<SegmentedControl label="Show in" options={CLOSE_APPROACH_DISTANCE_DISPLAYS} value={distanceDisplay} format={(value) => (value === 'au' ? 'AU' : value)} onChange={(value) => setCloseApproachPreferences(profileState, { distanceDisplay: value })} />
				<Select label="Rows" className="w-20 flex-none" options={PAGE_SIZES} value={rows} onChange={(value) => void resizeCloseApproachPages(closeApproachesState, +value)} />
			</div>
		</div>
	)
}

// Action of a failure: Retry when reading again can help, or the way to the offline switch.
function FailureAction({ notice }: { readonly notice: CloseApproachFailureNotice }) {
	if (notice.offline) {
		return (
			<Button variant="secondary" onClick={() => navigate(routeState, { workspace: 'settings', section: 'ephemeris-sources' })}>
				Open Ephemeris Sources
			</Button>
		)
	}

	return notice.retry ? <Button onClick={() => void loadCloseApproaches(closeApproachesState)}>Retry</Button> : undefined
}

// Encounters of the page shown, or why there are none.
export function CloseApproachTable({ timeZone, preferences }: CloseApproachTableProps) {
	const { result, loading, error } = useSnapshot(closeApproachesState)
	const { distanceDisplay } = preferences
	const rows = result?.rows ?? []
	const notice = error && closeApproachFailureNotice(error)

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ResultsBar timeZone={timeZone} preferences={preferences} />
			{notice && rows.length > 0 && (
				<div className="flex flex-none flex-wrap items-center gap-2 border-b border-line-100 px-4 py-2">
					<div className="min-w-64 flex-1">
						<Notice error>
							{notice.title}: {notice.description}
						</Notice>
					</div>
					<FailureAction notice={notice} />
				</div>
			)}
			{notice && rows.length === 0 && <EmptyState title={notice.title} description={notice.description} action={<FailureAction notice={notice} />} />}
			{!error && !result && <EmptyState title={loading ? 'Reading from JPL' : 'No search yet'} />}
			{!error && result && rows.length === 0 && <EmptyState title="No encounters" description={result.total > 0 ? 'This page is past the last match.' : 'No close approach matches these filters. Widen the period or the largest distance, or clear the object filters.'} />}
			{rows.length > 0 && (
				<Table className="flex-1 rounded-none border-0" columns={encounterColumns(timeZone)}>
					{rows.map((approach) => (
						<EncounterRow key={approach.id} approach={approach} timeZone={timeZone} distanceDisplay={distanceDisplay} />
					))}
				</Table>
			)}
			{result && (
				<div className="flex flex-none justify-center border-t border-line-100 px-4 py-2 empty:hidden">
					<Pager page={result.page - 1} total={result.total} pageSize={result.pageSize} noun="encounters" loading={loading} onPage={(index) => void pageCloseApproaches(closeApproachesState, index + 1)} />
				</div>
			)}
		</div>
	)
}
