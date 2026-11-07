import { expect, test } from 'bun:test'
import { diagnoseSchedule, type ScheduleEntry } from './observingplanner.schedule'

const NIGHT = { start: 0, end: 100 }
const WINDOWS = [
	{ start: 10, end: 40, durationMs: 30, bestScore: 80, bestAt: 20 },
	{ start: 50, end: 90, durationMs: 40, bestScore: 90, bestAt: 70 },
]

function entry(id: string, requestedDurationMs: number, scheduledStartAt?: number, overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
	return { id, requestedDurationMs, scheduledStartAt, status: 'observable', windows: WINDOWS, ...overrides }
}

test('a block must fit inside one window, not the union of two', () => {
	const { items } = diagnoseSchedule([entry('inside', 20, 55), entry('across', 20, 35), entry('night', 20, 95)], NIGHT, [NIGHT])
	expect(items.get('inside')).toEqual({ scheduledEndAt: 75, conflicts: [] })
	expect(items.get('across')!.conflicts).toEqual([{ code: 'outsideValidWindow' }])
	expect(items.get('night')!.conflicts).toEqual([{ code: 'outsideNight' }])
})

test('overlaps are reported on both items, even for the same target', () => {
	const { items, totals } = diagnoseSchedule([entry('a', 20, 50), entry('b', 20, 60), entry('c', 10, 70)], NIGHT, [NIGHT])
	expect(items.get('a')!.conflicts).toEqual([{ code: 'overlapsItem', itemId: 'b' }])
	expect(items.get('b')!.conflicts).toEqual([
		{ code: 'overlapsItem', itemId: 'a' },
		{ code: 'overlapsItem', itemId: 'c' },
	])
	expect(items.get('c')!.conflicts).toEqual([{ code: 'overlapsItem', itemId: 'b' }])
	expect(totals.withConflicts).toBe(3)
})

test('unscheduled items are allowed and the target problems are reported', () => {
	const entries = [entry('free', 30), entry('long', 45), entry('never', 10, undefined, { status: 'notObservable', windows: [] }), entry('gone', 10, 20, { status: 'unresolved', windows: [] })]
	const { items, totals } = diagnoseSchedule(entries, NIGHT, [{ start: 20, end: 80 }])
	expect(items.get('free')).toEqual({ scheduledEndAt: undefined, conflicts: [] })
	expect(items.get('long')!.conflicts).toEqual([{ code: 'insufficientContiguousTime' }])
	expect(items.get('never')!.conflicts).toEqual([{ code: 'notObservable' }])
	expect(items.get('gone')!.conflicts).toEqual([{ code: 'unresolvedTarget' }])
	expect(totals).toEqual({ requestedMs: 95, scheduledMs: 10, unscheduled: 3, observable: 1, withConflicts: 3, scopeMs: 60, unallocatedMs: 50 })
})
