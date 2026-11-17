import type { ObservingConstraints, ObservingPlanDocument, ObservingPlanItem, ObservingPlanItemPreview, ObservingPlanPreview } from 'api'
import { type ReactNode, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatDegrees, formatHours, formatSpan } from '../../format'
import type { SiteLocation } from '../../location/site'
import { useDisplayZone } from '../../location/useLocation'
import { wallTimeToInstant, zonedWallTime } from '../../location/zone'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataList, DataRow } from '../../ui/DataRow'
import { DisclosureSummary } from '../../ui/DisclosureSummary'
import { Icon } from '../../ui/Icon'
import { IconButton } from '../../ui/IconButton'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { StatusBadge, type StatusTone } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { useNow } from '../../useNow'
import { FoldedNote } from './FoldedNote'
import {
	conflictSentence,
	createPlan,
	deletePlan,
	discardDraft,
	duplicatePlan,
	editPlan,
	MODE_LABELS,
	type NamedTarget,
	newPlanDocument,
	type ObservingPlannerState,
	observingPlannerState,
	type ObservingPlansState,
	observingPlansState,
	openPlan,
	overwritePlan,
	type PlanSaveStatus,
	planDocument,
	planLabel,
	planningSite,
	planSaveStatus,
	plain,
	previewPlan,
	showTargetInSky,
	sortedPlans,
	STATUS_LABELS,
} from './observingplanner'
import { PlanTimeline } from './PlanTimeline'

// Night Plan section of the Observing Planner. Without a plan in the route it lists the saved plans; with one, the plan is
// its night: the totals, then the timeline (one lane per item, the main surface), then the editor of the item selected on
// it, then the plan's own details folded away. Every edit is written whole a moment later from the revision it was made
// on; a badge says how far the edits got, and when another tab saved first, the conflict is shown with what the server
// kept and the operator chooses. The preview is computed again for every document shown, and its problems are only
// reported: nothing moves, shortens, drops, or reorders an item. Times are typed and shown in the display zone; the plan's
// night is named in the zone of its own site.

// Milliseconds per minute.
const MINUTE_MS = 60_000

// Interval of the clock that places the current time on the timeline, in milliseconds.
const NOW_INTERVAL_MS = 30_000

// Columns of the list of saved plans.
const PLAN_COLUMNS = ['Plan', 'Night', 'Site', { key: 'items', label: 'Targets', numeric: true }] as const

export interface PlanSectionProps {
	// Id of the plan the route names.
	readonly planId?: string
	// Location of the tool, which a new plan copies; undefined without one.
	readonly location?: SiteLocation
	// Saved site the location is.
	readonly siteId?: string
	// Active observing site of the profile, from which the Sky selects.
	readonly activeSite?: SiteLocation
	// Asks to analyze a target with the tool's location and night.
	readonly onAnalyze: (target: NamedTarget) => void
}

// Item removed from a plan, kept so the removal can be undone: the item whole (with its notes) and where it was.
interface RemovedItem {
	// Item removed.
	readonly item: ObservingPlanItem
	// Its index in the plan's items before the removal.
	readonly index: number
}

// Words and tone of how far a plan's edits got.
const SAVE_STATUS_LABELS: Readonly<Record<PlanSaveStatus, { readonly label: string; readonly tone: StatusTone; readonly title: string }>> = {
	saved: { label: 'Saved', tone: 'neutral', title: 'Every edit of this plan is saved on the server' },
	saving: { label: 'Saving', tone: 'active', title: 'The latest edits are being written to the server' },
	conflict: { label: 'Conflict', tone: 'warning', title: 'Another tab changed this plan; choose which version to keep' },
	failed: { label: 'Not saved', tone: 'danger', title: 'The latest edits could not be written to the server' },
}

// Returns the value of a datetime-local input for an instant in a zone.
function localInput(time: number, timeZone: string) {
	const { year, month, day, hour, minute } = zonedWallTime(time, timeZone)
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

// Reads a datetime-local input in a zone: the instant, the earlier one of a repeated reading, or undefined for a reading the
// clocks skip.
function inputInstant(value: string, timeZone: string) {
	const [date, clock] = value.split('T')
	const [year, month, day] = date.split('-').map(Number)
	const [hour, minute] = clock.split(':').map(Number)
	const instant = wallTimeToInstant({ year, month, day, hour, minute, second: 0 }, timeZone)
	return instant.kind === 'exact' ? instant.time : instant.kind === 'ambiguous' ? instant.earlier : undefined
}

// Summary of a set of constraints.
function constraintsSummary(constraints: ObservingConstraints) {
	const parts = [MODE_LABELS[constraints.mode], `altitude ≥ ${formatDegrees(constraints.minimumAltitude, 0)}`, `Sun ≤ ${formatDegrees(constraints.maximumSunAltitude, 0)}`]
	if (constraints.maximumAirmass !== undefined) parts.push(`airmass ≤ ${constraints.maximumAirmass}`)
	if (constraints.minimumMoonSeparation !== undefined) parts.push(`Moon ≥ ${formatDegrees(constraints.minimumMoonSeparation, 0)} while up`)
	parts.push(`windows ≥ ${formatHours(constraints.minimumContinuousMs)}`)
	return parts.join(' · ')
}

// Returns a count of items in words: "no items", "1 item", "3 items".
function itemCount(count: number) {
	return count === 0 ? 'no items' : count === 1 ? '1 item' : `${count} items`
}

// Start of an unscheduled item scheduled from the plan: its first window, else the start of the displayed night, to the minute.
function firstStart(preview: ObservingPlanItemPreview | undefined, nightStart: number | undefined) {
	const time = preview?.analysis.windows[0]?.start ?? nightStart
	return time === undefined ? undefined : Math.ceil(time / MINUTE_MS) * MINUTE_MS
}

// Night Plan section of the Observing Planner.
export function PlanSection({ planId, location, siteId, activeSite, onAnalyze }: PlanSectionProps) {
	const plans = useSnapshot(observingPlansState) as ObservingPlansState
	const tool = useSnapshot(observingPlannerState) as ObservingPlannerState
	const list = sortedPlans(plans)
	const document = planId ? planDocument(plans, planId) : undefined
	const saved = planId ? plans.plans[planId] : undefined
	const displayZone = useDisplayZone(document?.site)
	const timeZone = displayZone.zone
	const now = useNow(!!document, NOW_INTERVAL_MS)
	const [creating, setCreating] = useState(false)
	const [removed, setRemoved] = useState<RemovedItem>()
	const [selection, setSelection] = useState<string>()

	// A removal can be undone, and a target stays selected, only in the plan it was made in.
	useEffect(() => {
		setRemoved(undefined)
		setSelection(undefined)
	}, [planId])

	// Previews every document shown; an unchanged document is not asked again.
	useEffect(() => {
		if (planId && document) void previewPlan(observingPlannerState, planId, document)
	}, [document])

	// Creates an empty plan for the tool's location, night, and constraints, and opens it.
	async function create() {
		if (!location || !tool.eveningDate || !tool.constraints) return
		setCreating(true)
		const id = await createPlan(observingPlansState, newPlanDocument(`Night of ${tool.eveningDate}`, location, siteId, tool.eveningDate, tool.constraints))
		setCreating(false)
		if (id) openPlan(observingPlannerState, id)
	}

	const newPlan = (
		<Button disabled={!location || !tool.eveningDate || !tool.constraints || creating} title={location ? undefined : 'Set the observing site of this profile first'} onClick={() => void create()}>
			New Plan
		</Button>
	)

	if (!planId) {
		return (
			<div className="flex flex-col gap-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 className="m-0 text-base font-medium text-ink-100">Saved plans</h2>
					{newPlan}
				</div>
				{!plans.loaded ? (
					<p className="m-0 text-sm text-ink-300">Loading the plans…</p>
				) : list.length === 0 ? (
					<Notice>No plans yet. New Plan starts one for the tool's night and constraints, and adding a target from Discover, Analysis, or the Sky starts one too.</Notice>
				) : (
					<Table columns={PLAN_COLUMNS}>
						{list.map((plan) => (
							<Row key={plan.id} onSelect={() => openPlan(observingPlannerState, plan.id)}>
								<Cell className="text-ink-100">{plan.name}</Cell>
								<Cell>{plan.eveningDate}</Cell>
								<Cell>{plan.site.name}</Cell>
								<Cell numeric>{plan.items.length}</Cell>
							</Row>
						))}
					</Table>
				)}
				<Notice>Plans are saved on the server for every profile and tab. A plan keeps a copy of its site and night, so changing a saved site later never changes it.</Notice>
			</div>
		)
	}

	const header = (
		<div className="flex flex-wrap items-end gap-2">
			<Select label="Plan" className="min-w-56 flex-1" options={['', ...list.map((plan) => plan.id)]} value={planId && saved ? planId : ''} onChange={(id) => openPlan(observingPlannerState, id || undefined)} format={(id) => (id && plans.plans[id] ? planLabel(plans.plans[id]) : 'All plans')} />
			{saved && (
				<span className="flex h-[33.25px] items-center">
					<StatusBadge {...SAVE_STATUS_LABELS[planSaveStatus(plans, saved.id)]} />
				</span>
			)}
			{newPlan}
			{saved && (
				<>
					<Button
						variant="secondary"
						onClick={() =>
							void duplicatePlan(observingPlansState, saved.id, `${saved.name} (copy)`).then((id) => {
								if (id) openPlan(observingPlannerState, id)
							})
						}
					>
						Duplicate
					</Button>
					<ConfirmButton
						title="Delete plan?"
						message={`Delete ${saved.name} and its ${itemCount(saved.items.length)}? This cannot be undone.`}
						confirmLabel="Delete"
						destructive
						onConfirm={() =>
							void deletePlan(observingPlansState, saved.id).then(() => {
								if (!observingPlansState.plans[saved.id]) openPlan(observingPlannerState, undefined)
							})
						}
					>
						Delete
					</ConfirmButton>
				</>
			)}
		</div>
	)

	if (!document || !saved) {
		return (
			<div className="flex flex-col gap-4">
				{header}
				<Notice>{plans.loaded ? 'This plan does not exist; it may have been deleted in another tab.' : 'Loading the plans…'}</Notice>
			</div>
		)
	}

	const id = saved.id
	// The preview of an earlier document of the same plan stays shown while the next one is computed.
	const preview = tool.preview?.owner === id ? tool.preview.value : undefined
	const conflict = id in plans.conflicts ? plans.conflicts[id] : undefined
	const items = document.items
	const selectedIndex = Math.max(
		0,
		items.findIndex((item) => item.id === selection),
	)
	const selected = items[selectedIndex]
	const selectedPreview = selected && preview?.items.find((e) => e.itemId === selected.id)
	const nightStart = preview?.night.display.start
	const edit = (change: (current: ObservingPlanDocument) => ObservingPlanDocument) => editPlan(observingPlansState, id, change)
	const editItem = (itemId: string, change: (item: ObservingPlanItem) => ObservingPlanItem) => edit((current) => ({ ...current, items: current.items.map((item) => (item.id === itemId ? change(item) : item)) }))
	// Schedules an item at its first window, else at the start of the night.
	const schedule = (itemId: string) => {
		const start = firstStart(
			preview?.items.find((e) => e.itemId === itemId),
			nightStart,
		)
		if (start !== undefined) editItem(itemId, (item) => ({ ...item, scheduledStartAt: start }))
	}
	const move = (index: number, by: number) =>
		edit((current) => {
			const moved = [...current.items]
			const [item] = moved.splice(index, 1)
			moved.splice(index + by, 0, item)
			return { ...current, items: moved }
		})
	// Removes an item, keeping it so the removal can be undone, and selects the lane that takes its place.
	const remove = (item: ObservingPlanItem, index: number) => {
		setRemoved({ item: plain(item), index })
		setSelection(items[index + 1]?.id ?? items[index - 1]?.id)
		edit((current) => ({ ...current, items: current.items.filter((e) => e.id !== item.id) }))
	}

	return (
		<div className="flex flex-col gap-4">
			{header}
			{id in plans.conflicts && (
				<Notice error>
					<span className="block">{conflict ? `Another tab saved this plan (revision ${conflict.revision}) after you started editing.` : 'Another tab deleted this plan.'}</span>
					<span className="mt-2 flex flex-wrap gap-2">
						<Button variant="secondary" onClick={() => discardDraft(observingPlansState, id)}>
							Keep Theirs
						</Button>
						<Button variant="secondary" onClick={() => void overwritePlan(observingPlansState, id)}>
							Save Mine
						</Button>
					</span>
				</Notice>
			)}
			{plans.errors[id] && <Notice error>{plans.errors[id]}</Notice>}
			{tool.previewError && <Notice error>{tool.previewError}</Notice>}
			{preview && items.length > 0 && <PlanTotals preview={preview} count={items.length} />}
			{items.length === 0 ? (
				<div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-line-200 p-4">
					<p className="m-0 text-sm text-ink-200">This plan has no targets yet. Add them from Discover or Analysis, or from an object selected in the Sky.</p>
					<Button variant="secondary" onClick={() => (observingPlannerState.section = 'discover')}>
						Find Targets
					</Button>
				</div>
			) : preview ? (
				<div className="flex flex-col gap-2">
					<PlanTimeline plan={document} preview={preview} timeZone={timeZone} now={now} selected={selected?.id} onSelect={setSelection} onMove={(itemId, start) => editItem(itemId, (item) => ({ ...item, scheduledStartAt: start }))} onSchedule={schedule} />
					<FoldedNote summary="Choose a target by its lane, and drag its block to schedule it.">With the timeline focused, the up and down arrows choose a target, the left and right arrows move its block 5 min (1 min with Shift), and Enter schedules an unscheduled one at its first window.</FoldedNote>
				</div>
			) : (
				<p className="m-0 text-sm text-ink-300">{tool.previewLoading ? 'Computing the plan…' : 'The plan could not be computed.'}</p>
			)}
			{removed && (
				<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-100 px-3 py-2">
					<span className="min-w-0 text-sm wrap-break-word text-ink-200">Removed {removed.item.targetName} from the plan.</span>
					<Button
						variant="secondary"
						onClick={() => {
							edit((current) => ({ ...current, items: current.items.some((e) => e.id === removed.item.id) ? current.items : current.items.toSpliced(Math.min(removed.index, current.items.length), 0, removed.item) }))
							setSelection(removed.item.id)
							setRemoved(undefined)
						}}
					>
						Undo
					</Button>
				</div>
			)}
			{selected && (
				<ItemEditor
					key={selected.id}
					item={selected}
					preview={selectedPreview}
					timeZone={timeZone}
					first={selectedIndex === 0}
					last={selectedIndex === items.length - 1}
					names={items}
					canSchedule={firstStart(selectedPreview, nightStart) !== undefined}
					onChange={(change) => editItem(selected.id, change)}
					onSchedule={() => schedule(selected.id)}
					onMove={(by) => move(selectedIndex, by)}
					onRemove={() => remove(selected, selectedIndex)}
					onShow={() => showTargetInSky({ target: selected.target, name: selected.targetName }, activeSite)}
					onAnalyze={() => onAnalyze({ target: selected.target, name: selected.targetName })}
				/>
			)}
			<details className="rounded-md border border-line-100 bg-base-100">
				<DisclosureSummary title="Plan" className="px-4">
					<span className="min-w-0 truncate text-xs text-ink-300">
						{document.eveningDate} · {document.site.name}
					</span>
				</DisclosureSummary>
				<div className="-mt-1 flex flex-col gap-3 px-4 pb-4">
					<div className="flex flex-wrap items-end gap-3">
						<TextInput key={`name-${saved.revision}`} label="Name" className="min-w-48 flex-1" defaultValue={document.name} onBlur={(event) => event.target.value.trim() && event.target.value !== document.name && edit((current) => ({ ...current, name: event.target.value.trim() }))} />
						<TextInput label="Evening" type="date" className="w-44" value={document.eveningDate} onChange={(event) => event.target.value && edit((current) => ({ ...current, eveningDate: event.target.value }))} />
					</div>
					<DataList>
						<DataRow label="Site">{document.site.name}</DataRow>
						<DataRow label="Constraints">{constraintsSummary(document.constraints)}</DataRow>
					</DataList>
					<div className="flex flex-wrap gap-2">
						<Button variant="secondary" disabled={!location} title={location ? undefined : 'Set the observing site of this profile first'} onClick={() => location && edit((current) => ({ ...current, site: planningSite(location), observingSiteId: siteId }))}>
							Use Active Site
						</Button>
						<Button variant="secondary" disabled={!tool.constraints} onClick={() => tool.constraints && edit((current) => ({ ...current, constraints: plain(tool.constraints!) }))}>
							Use Tool Constraints
						</Button>
					</div>
					<Notice>One target at a time: blocks of different items must not overlap. Dark time is where the Sun is below the plan's limit.</Notice>
				</div>
			</details>
		</div>
	)
}

// One total of a plan: a muted label and its value.
function Total({ label, danger = false, children }: { readonly label: string; readonly danger?: boolean; readonly children: ReactNode }) {
	return (
		<span className="flex items-baseline gap-1.5">
			<span className="text-xs text-ink-300">{label}</span>
			<span className={danger ? 'text-sm text-danger tabular-nums' : 'text-sm text-ink-100 tabular-nums'}>{children}</span>
		</span>
	)
}

// Totals of a plan's preview on one wrapping line.
function PlanTotals({ preview, count }: { readonly preview: ObservingPlanPreview; readonly count: number }) {
	const { totals } = preview
	return (
		<div className="flex flex-wrap gap-x-5 gap-y-1">
			<Total label="Scheduled">
				{formatHours(totals.scheduledMs)} of {formatHours(totals.requestedMs)}
			</Total>
			<Total label="Observable">
				{totals.observable} of {count}
			</Total>
			<Total label="Unscheduled">{itemCount(totals.unscheduled)}</Total>
			<Total label="With problems" danger={totals.withConflicts > 0}>
				{itemCount(totals.withConflicts)}
			</Total>
			<Total label="Free dark time">
				{formatHours(totals.unallocatedMs)} of {formatHours(totals.scopeMs)}
			</Total>
		</div>
	)
}

// Properties of the editor of an item.
interface ItemEditorProps {
	// Item.
	readonly item: ObservingPlanItem
	// Its preview, once computed.
	readonly preview?: ObservingPlanItemPreview
	// IANA zone of its times.
	readonly timeZone: string
	// Whether it is the first and the last item.
	readonly first: boolean
	readonly last: boolean
	// Items of the plan, which name the blocks it overlaps.
	readonly names: readonly Pick<ObservingPlanItem, 'id' | 'targetName'>[]
	// Whether it can be scheduled from the plan (a window or the night is known).
	readonly canSchedule: boolean
	// Changes the item.
	readonly onChange: (change: (item: ObservingPlanItem) => ObservingPlanItem) => void
	// Schedules it at its first window.
	readonly onSchedule: () => void
	// Moves the item up (−1) or down (1) in the plan.
	readonly onMove: (by: number) => void
	// Removes the item.
	readonly onRemove: () => void
	// Shows the target in the Sky.
	readonly onShow: () => void
	// Analyzes the target.
	readonly onAnalyze: () => void
}

// Editor of the item selected on the timeline: its target and status, its windows, its request and start, its problems in
// words, and its actions.
function ItemEditor({ item, preview, timeZone, first, last, names, canSchedule, onChange, onSchedule, onMove, onRemove, onShow, onAnalyze }: ItemEditorProps) {
	const [startError, setStartError] = useState<string>()
	const status = preview?.analysis.status
	const windows = preview?.analysis.windows ?? []

	return (
		<section className="flex flex-col gap-3 rounded-md border border-line-100 bg-base-100 p-4">
			<div className="flex flex-wrap items-start gap-2">
				<div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
					<h2 className="m-0 text-base font-medium wrap-break-word text-ink-100">{item.targetName}</h2>
					<Notice>{windows.length === 0 ? 'No window this night' : `${windows.length === 1 ? 'Window' : 'Windows'} ${windows.map((window) => formatSpan(window.start, window.end, timeZone)).join(', ')}`}</Notice>
				</div>
				{status && <StatusBadge tone={STATUS_LABELS[status].tone} label={STATUS_LABELS[status].label} />}
				<span className="flex">
					<IconButton icon="arrow" label="Move up in the plan" disabled={first} onClick={() => onMove(-1)} />
					<IconButton icon="arrow" className="rotate-180" label="Move down in the plan" disabled={last} onClick={() => onMove(1)} />
				</span>
			</div>
			<div className="flex flex-wrap items-end gap-3">
				<NumberInput label="Requested" className="w-40" suffix="min" value={Math.round(item.requestedDurationMs / MINUTE_MS)} min={1} max={1440} step={5} onChange={(minutes) => onChange((current) => ({ ...current, requestedDurationMs: minutes * MINUTE_MS }))} />
				{item.scheduledStartAt === undefined ? (
					<Button variant="secondary" disabled={!canSchedule} onClick={onSchedule}>
						Schedule
					</Button>
				) : (
					<>
						<TextInput
							key={`${item.scheduledStartAt}-${timeZone}`}
							label="Start"
							type="datetime-local"
							className="w-56"
							defaultValue={localInput(item.scheduledStartAt, timeZone)}
							onBlur={(event) => {
								if (!event.target.value) return
								const start = inputInstant(event.target.value, timeZone)
								if (start === undefined) setStartError('The clocks skip that time in this zone.')
								else {
									setStartError(undefined)
									if (start !== item.scheduledStartAt) onChange((current) => ({ ...current, scheduledStartAt: start }))
								}
							}}
						/>
						<Button variant="secondary" onClick={() => onChange(({ scheduledStartAt: _, ...current }) => current)}>
							Unschedule
						</Button>
					</>
				)}
				<NumberInput label="Priority" className="w-32" value={item.priority} min={1} max={5} onChange={(priority) => onChange((current) => ({ ...current, priority }))} />
			</div>
			<TextInput key={`notes-${item.notes}`} label="Notes" defaultValue={item.notes} onBlur={(event) => event.target.value !== item.notes && onChange((current) => ({ ...current, notes: event.target.value }))} />
			<Notice>The priority (1 to 5) is a note for you: it never reorders or schedules anything.</Notice>
			{startError && <Notice error>{startError}</Notice>}
			{preview && preview.conflicts.length > 0 && (
				<ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-danger">
					{preview.conflicts.map((conflict) => (
						<li key={`${conflict.code}-${conflict.itemId ?? ''}`} className="flex items-start gap-1.5">
							<Icon name="warning" className="mt-0.5 size-3.5 flex-none" />
							{conflictSentence(conflict, names)}
						</li>
					))}
				</ul>
			)}
			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" disabled={status === 'unresolved'} onClick={onShow}>
					Show in Sky
				</Button>
				<Button variant="secondary" onClick={onAnalyze}>
					Analyze
				</Button>
				<Button variant="secondary" onClick={onRemove}>
					Remove
				</Button>
			</div>
		</section>
	)
}
