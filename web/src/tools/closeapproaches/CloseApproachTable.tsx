import type { CloseApproach, CloseApproachSortField } from 'api'
import { cn } from 'cn'
import type { KeyboardEvent, ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { moveIndex } from '../../ui/navigation'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { bodyName, closeApproachesState, DISTANCE_DISPLAYS, formatApproachTime, formatDiameter, formatDistance, formatDistanceRange, formatVelocity, loadCloseApproaches, pageCloseApproaches, pageCount, resizeCloseApproachPages, selectCloseApproach, sortCloseApproaches, TIME_DISPLAYS } from './closeapproaches'

// Table of the Close Approaches tool: one row per encounter of the page JPL answered, so an object appears once per
// encounter. Sorting and paging ask the server again: rows are never sorted or sliced here. Arrow keys, Home, and End move
// between the rows, Enter and Space select one.

// Rows per page offered.
const PAGE_SIZES = ['25', '50', '100'] as const

// Text of an absent value.
const NOT_PUBLISHED = '—'

interface SortHeaderProps {
	// Column of JPL the header orders by.
	readonly field: CloseApproachSortField
	// Header text.
	readonly children: ReactNode
	// Whether the column is right-aligned.
	readonly numeric?: boolean
}

// Header of a column JPL can order by.
function SortHeader({ field, children, numeric }: SortHeaderProps) {
	const { filters } = useSnapshot(closeApproachesState)
	const sort = filters?.sort
	const active = sort === field || sort === `-${field}`

	return (
		<th className={cn('p-0 font-normal', numeric ? 'text-right' : 'text-left')}>
			<button
				type="button"
				title="Order all the matches by this column, from the first page"
				onClick={() => void sortCloseApproaches(closeApproachesState, field)}
				className={cn('inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent px-2 py-2 font-mono text-xs whitespace-nowrap hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent', active ? 'text-accent' : 'text-ink-300')}
			>
				{children}
				{active && <Icon name="arrow" className={cn('size-3', sort !== field && 'rotate-180')} />}
			</button>
		</th>
	)
}

// Header of a column JPL cannot order by.
function PlainHeader({ children, numeric }: { readonly children: ReactNode; readonly numeric?: boolean }) {
	return <th className={cn('px-2 py-2 text-xs font-normal whitespace-nowrap text-ink-300', numeric ? 'text-right' : 'text-left')}>{children}</th>
}

interface EncounterRowProps {
	// Encounter of the row.
	readonly approach: CloseApproach
	// Zone of the time shown.
	readonly timeZone: string
	// Position of the row, for the keyboard.
	readonly index: number
	// Rows of the page.
	readonly count: number
}

// Row of one encounter.
function EncounterRow({ approach, timeZone, index, count }: EncounterRowProps) {
	const { selected, distanceDisplay } = useSnapshot(closeApproachesState)
	const { id, fullName, designation, time, calendarDate, body, distance, distanceMin, distanceMax, relativeVelocity, absoluteMagnitude, diameter, diameterSigma, orbitId } = approach

	function press(event: KeyboardEvent<HTMLTableRowElement>) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault()
			void selectCloseApproach(closeApproachesState, approach)
			return
		}

		const next = moveIndex(index, count, event.key)
		if (next === undefined) return
		event.preventDefault()
		;(event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
	}

	return (
		<tr
			tabIndex={0}
			title={`${calendarDate} TDB`}
			onClick={() => void selectCloseApproach(closeApproachesState, approach)}
			onKeyDown={press}
			className={cn('cursor-pointer border-b border-line-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', selected?.id === id ? 'bg-accent-subtle' : 'hover:bg-base-200')}
		>
			<td className="max-w-64 truncate px-2 py-1.5 text-ink-100" title={fullName ?? designation}>
				{fullName ?? designation}
			</td>
			<td className="px-2 py-1.5 whitespace-nowrap">{formatApproachTime(time, timeZone)}</td>
			<td className="px-2 py-1.5 whitespace-nowrap">{bodyName(body)}</td>
			<td className="px-2 py-1.5 text-right whitespace-nowrap">{formatDistance(distance, distanceDisplay)}</td>
			<td className="px-2 py-1.5 text-right whitespace-nowrap">{formatDistanceRange(distanceMin, distanceMax, distanceDisplay) ?? NOT_PUBLISHED}</td>
			<td className="px-2 py-1.5 text-right whitespace-nowrap">{formatVelocity(relativeVelocity)}</td>
			<td className="px-2 py-1.5 text-right">{absoluteMagnitude?.toFixed(2) ?? NOT_PUBLISHED}</td>
			<td className="px-2 py-1.5 text-right whitespace-nowrap">{diameter === undefined ? NOT_PUBLISHED : formatDiameter(diameter, diameterSigma)}</td>
			<td className="px-2 py-1.5 whitespace-nowrap">{orbitId}</td>
		</tr>
	)
}

// Distance unit and time zone of the table, with where the rows came from and when.
function ResultsBar({ timeZone }: { readonly timeZone: string }) {
	const { result, loading, pageSize, distanceDisplay, timeDisplay } = useSnapshot(closeApproachesState)
	const origin = result && `${result.total} ${result.total === 1 ? 'encounter' : 'encounters'} · ${result.source} ${result.sourceVersion} · read ${formatApproachTime(result.fetchedAt, timeZone)}`

	return (
		<div className="flex flex-none flex-wrap items-end justify-between gap-2 border-b border-line-100 px-4 py-2">
			<p className="m-0 min-w-0 text-xs leading-5 text-ink-300">{loading ? 'Reading from JPL…' : origin}</p>
			<div className="flex items-end gap-2">
				<SegmentedControl options={DISTANCE_DISPLAYS} value={distanceDisplay} format={(value) => (value === 'au' ? 'AU' : value)} onChange={(value) => (closeApproachesState.distanceDisplay = value)} />
				<SegmentedControl options={TIME_DISPLAYS} value={timeDisplay} format={(value) => (value === 'utc' ? 'UTC' : 'Observer')} onChange={(value) => (closeApproachesState.timeDisplay = value)} />
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
export function CloseApproachTable({ timeZone }: { readonly timeZone: string }) {
	const { result, loading, error, distanceDisplay } = useSnapshot(closeApproachesState)
	const rows = result?.rows ?? []

	return (
		<div className="flex min-h-96 flex-1 flex-col lg:min-h-0">
			<ResultsBar timeZone={timeZone} />
			{error && <EmptyState title="JPL did not answer" description={error} action={<Button onClick={() => void loadCloseApproaches(closeApproachesState)}>Retry</Button>} />}
			{!error && !result && <EmptyState title={loading ? 'Reading from JPL' : 'No search yet'} />}
			{!error && result && rows.length === 0 && <EmptyState title="No encounters" description={result.total > 0 ? 'This page is past the last match.' : 'No close approach matches these filters.'} />}
			{rows.length > 0 && (
				<div className="min-h-0 flex-1 overflow-auto">
					<table className="w-full border-collapse font-mono text-xs text-ink-200 tabular-nums">
						<thead className="sticky top-0 z-1 bg-base-100">
							<tr className="border-b border-line-100">
								<SortHeader field="object">Object</SortHeader>
								<SortHeader field="date">{`Close Approach (${timeZone})`}</SortHeader>
								<PlainHeader>Target</PlainHeader>
								<SortHeader field="dist" numeric>
									Distance
								</SortHeader>
								<PlainHeader numeric>{`3σ Range (${distanceDisplay === 'au' ? 'AU' : distanceDisplay})`}</PlainHeader>
								<SortHeader field="v-rel" numeric>
									Vrel
								</SortHeader>
								<SortHeader field="h" numeric>
									H
								</SortHeader>
								<PlainHeader numeric>Diameter</PlainHeader>
								<PlainHeader>Orbit</PlainHeader>
							</tr>
						</thead>
						<tbody>
							{rows.map((approach, index) => (
								<EncounterRow key={approach.id} approach={approach} timeZone={timeZone} index={index} count={rows.length} />
							))}
						</tbody>
					</table>
				</div>
			)}
			<Pager />
		</div>
	)
}
