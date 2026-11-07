import type { ObservingStatus, ObservingWindow } from './observingplanner.astronomy'
import type { TimeSpan } from './sky/sun'

// Diagnostics of the manual schedule of a night plan: conflicts of each item and totals of the plan. The plan is one
// sequential lane (one target at a time); nothing here moves, shortens, drops, or reorders an item, so a conflict is only
// reported. Times are Unix milliseconds (UTC).

// Problem of an item of a schedule.
export type ObservingScheduleConflictCode =
	// The catalog or SBDB does not know the target.
	| 'unresolvedTarget'
	// No ephemeris source gives the trajectory of the minor body over the night, so nothing is known of its windows.
	| 'ephemerisUnavailable'
	// The target has no window the whole night.
	| 'notObservable'
	// No window is as long as the requested duration.
	| 'insufficientContiguousTime'
	// The scheduled block starts before or ends after the night.
	| 'outsideNight'
	// The scheduled block does not fit inside one window.
	| 'outsideValidWindow'
	// The scheduled block overlaps another item's.
	| 'overlapsItem'

// Problem of an item, with the other item of an overlap.
export interface ObservingScheduleConflict {
	// Problem.
	readonly code: ObservingScheduleConflictCode
	// Id of the overlapping item, for overlapsItem.
	readonly itemId?: string
}

// Item of a schedule as the diagnostics see it.
export interface ScheduleEntry {
	// Id of the item.
	readonly id: string
	// Continuous time requested, in milliseconds.
	readonly requestedDurationMs: number
	// Start the operator chose; absent while unscheduled.
	readonly scheduledStartAt?: number
	// Status of the target with the item's constraints.
	readonly status: ObservingStatus
	// Windows of the target with the item's constraints.
	readonly windows: readonly ObservingWindow[]
}

// Diagnostics of one item.
export interface ScheduleItemDiagnostics {
	// End of the scheduled block (start plus the requested duration); absent while unscheduled.
	readonly scheduledEndAt?: number
	// Problems, in the order of ObservingScheduleConflictCode.
	readonly conflicts: readonly ObservingScheduleConflict[]
}

// Totals of a schedule.
export interface ScheduleTotals {
	// Requested time of every item, in milliseconds.
	readonly requestedMs: number
	// Requested time of the scheduled items, in milliseconds.
	readonly scheduledMs: number
	// Items without a start.
	readonly unscheduled: number
	// Items with a window long enough for their request.
	readonly observable: number
	// Items with at least one problem.
	readonly withConflicts: number
	// Length of the planning scope (where the Sun is below the plan's limit), in milliseconds.
	readonly scopeMs: number
	// Part of the planning scope no scheduled block covers, in milliseconds.
	readonly unallocatedMs: number
}

// Length of the union of intervals clipped to a scope, in milliseconds.
function coveredLength(intervals: readonly TimeSpan[], scope: readonly TimeSpan[]) {
	let total = 0

	for (const span of scope) {
		const clipped = intervals
			.map((e) => ({ start: Math.max(e.start, span.start), end: Math.min(e.end, span.end) }))
			.filter((e) => e.end > e.start)
			.sort((a, b) => a.start - b.start)
		let end = span.start

		for (const interval of clipped) {
			const start = Math.max(interval.start, end)
			if (interval.end > start) total += interval.end - start
			end = Math.max(end, interval.end)
		}
	}

	return total
}

// Diagnoses a schedule over a night (TimeSpan of its two solar transits) and the planning scope, the stretches where the
// Sun is below the plan's limit. Returns the diagnostics of each item, by id, and the totals.
export function diagnoseSchedule(entries: readonly ScheduleEntry[], night: TimeSpan, scope: readonly TimeSpan[]) {
	const items = new Map<string, ScheduleItemDiagnostics>()
	const blocks = entries.filter((e) => e.scheduledStartAt !== undefined).map((e) => ({ id: e.id, start: e.scheduledStartAt!, end: e.scheduledStartAt! + e.requestedDurationMs }))

	for (const entry of entries) {
		const conflicts: ObservingScheduleConflict[] = []
		const block = blocks.find((e) => e.id === entry.id)
		// Whether nothing is known of the target's windows, so its block cannot be judged against them.
		const unknown = entry.status === 'unresolved' || entry.status === 'ephemerisUnavailable'

		if (entry.status === 'unresolved') conflicts.push({ code: 'unresolvedTarget' })
		else if (entry.status === 'ephemerisUnavailable') conflicts.push({ code: 'ephemerisUnavailable' })
		else if (entry.status === 'notObservable') conflicts.push({ code: 'notObservable' })
		else if (!entry.windows.some((e) => e.durationMs >= entry.requestedDurationMs)) conflicts.push({ code: 'insufficientContiguousTime' })

		if (block) {
			if (block.start < night.start || block.end > night.end) conflicts.push({ code: 'outsideNight' })
			else if (!unknown && !entry.windows.some((e) => e.start <= block.start && block.end <= e.end)) conflicts.push({ code: 'outsideValidWindow' })
			for (const other of blocks) if (other.id !== block.id && other.start < block.end && block.start < other.end) conflicts.push({ code: 'overlapsItem', itemId: other.id })
		}

		items.set(entry.id, { scheduledEndAt: block?.end, conflicts })
	}

	let requestedMs = 0
	let scheduledMs = 0
	let observable = 0
	let withConflicts = 0

	for (const entry of entries) {
		requestedMs += entry.requestedDurationMs
		if (entry.scheduledStartAt !== undefined) scheduledMs += entry.requestedDurationMs
		if (entry.windows.some((e) => e.durationMs >= entry.requestedDurationMs)) observable++
		if (items.get(entry.id)!.conflicts.length > 0) withConflicts++
	}

	const scopeMs = coveredLength(scope, [night])
	const totals: ScheduleTotals = { requestedMs, scheduledMs, unscheduled: entries.length - blocks.length, observable, withConflicts, scopeMs, unallocatedMs: scopeMs - coveredLength(blocks, scope) }
	return { items, totals }
}
