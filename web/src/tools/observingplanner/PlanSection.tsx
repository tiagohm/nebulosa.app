import type { ObservingConstraints, ObservingPlanDocument, ObservingPlanItem, ObservingPlanItemPreview } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatDegrees, formatGeographic, formatHours } from '../../format'
import type { SiteLocation } from '../../location/site'
import { useDisplayZone } from '../../location/useLocation'
import { describeDisplayZone, wallTimeToInstant, zonedWallTime } from '../../location/zone'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataList, DataRow } from '../../ui/DataRow'
import { IconButton } from '../../ui/IconButton'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { TextInput } from '../../ui/TextInput'
import {
	CONFLICT_LABELS,
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
	planDocument,
	planningSite,
	plain,
	previewPlan,
	showTargetInSky,
	sortedPlans,
	STATUS_LABELS,
} from './observingplanner'
import { PlanTimeline } from './PlanTimeline'

// Night Plan section of the Observing Planner: the saved plans, and the one the route names as a document to edit. Every
// edit is written whole a moment later from the revision it was made on; when another tab saved first, the conflict is
// shown with what the server kept and the operator chooses. The preview is computed again for every document shown, and
// its problems are only reported: nothing moves, shortens, drops, or reorders an item. Times are typed and shown in the
// display zone; the plan's night is named in the zone of its own site.

// Milliseconds per minute.
const MINUTE_MS = 60_000

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

// Night Plan section of the Observing Planner.
export function PlanSection({ planId, location, siteId, activeSite, onAnalyze }: PlanSectionProps) {
	const plans = useSnapshot(observingPlansState) as ObservingPlansState
	const tool = useSnapshot(observingPlannerState) as ObservingPlannerState
	const list = sortedPlans(plans)
	const document = planId ? planDocument(plans, planId) : undefined
	const saved = planId ? plans.plans[planId] : undefined
	const displayZone = useDisplayZone(document?.site, tool.zone)
	const timeZone = displayZone.zone
	const [creating, setCreating] = useState(false)

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

	const header = (
		<div className="flex flex-wrap items-end gap-2">
			<Select
				label="Plan"
				className="min-w-56 flex-1"
				options={['', ...list.map((plan) => plan.id)]}
				value={planId && saved ? planId : ''}
				onChange={(id) => openPlan(observingPlannerState, id || undefined)}
				format={(id) => (id ? `${plans.plans[id]?.name} · ${plans.plans[id]?.eveningDate}` : list.length > 0 ? 'Choose a plan…' : 'No plans yet')}
			/>
			<Button disabled={!location || !tool.eveningDate || !tool.constraints || creating} title={location ? undefined : 'Choose a location first'} onClick={() => void create()}>
				New Plan
			</Button>
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
						message={`Delete ${saved.name} and its ${saved.items.length} items? This cannot be undone.`}
						confirmLabel="Delete"
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

	if (!planId) {
		return (
			<div className="flex flex-col gap-4">
				{header}
				<Notice>Plans are saved on the server for every profile and tab. A plan keeps a copy of its location and night, so changing a saved site later never changes it.</Notice>
			</div>
		)
	}

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
	const edit = (change: (current: ObservingPlanDocument) => ObservingPlanDocument) => editPlan(observingPlansState, id, change)
	const editItem = (itemId: string, change: (item: ObservingPlanItem) => ObservingPlanItem) => edit((current) => ({ ...current, items: current.items.map((item) => (item.id === itemId ? change(item) : item)) }))
	const move = (index: number, by: number) =>
		edit((current) => {
			const items = [...current.items]
			const [item] = items.splice(index, 1)
			items.splice(index + by, 0, item)
			return { ...current, items }
		})

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
			<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
				<div className="flex flex-wrap items-end gap-3">
					<TextInput key={`name-${saved.revision}`} label="Name" className="min-w-48 flex-1" defaultValue={document.name} onBlur={(event) => event.target.value.trim() && event.target.value !== document.name && edit((current) => ({ ...current, name: event.target.value.trim() }))} />
					<TextInput label="Evening" type="date" className="w-44" value={document.eveningDate} onChange={(event) => event.target.value && edit((current) => ({ ...current, eveningDate: event.target.value }))} />
				</div>
				<DataList>
					<DataRow label="Location">
						{document.site.name} · {formatGeographic(document.site.latitude, document.site.longitude)} · {document.site.timeZone}
					</DataRow>
					<DataRow label="Constraints">{constraintsSummary(document.constraints)}</DataRow>
					<DataRow label="Times Shown In">{describeDisplayZone(displayZone)}</DataRow>
				</DataList>
				<div className="flex flex-wrap gap-2">
					<Button variant="secondary" disabled={!location} onClick={() => location && edit((current) => ({ ...current, site: planningSite(location), observingSiteId: siteId }))}>
						Use Tool Location
					</Button>
					<Button variant="secondary" disabled={!tool.constraints} onClick={() => tool.constraints && edit((current) => ({ ...current, constraints: plain(tool.constraints!) }))}>
						Use Tool Constraints
					</Button>
				</div>
			</section>
			{tool.previewError && <Notice error>{tool.previewError}</Notice>}
			{preview && (
				<>
					<DataList>
						<DataRow label="Requested">{formatHours(preview.totals.requestedMs)}</DataRow>
						<DataRow label="Scheduled">{formatHours(preview.totals.scheduledMs)}</DataRow>
						<DataRow label="Unscheduled">{preview.totals.unscheduled}</DataRow>
						<DataRow label="Observable">
							{preview.totals.observable} of {document.items.length}
						</DataRow>
						<DataRow label="With Problems" tone={preview.totals.withConflicts > 0 ? 'danger' : undefined}>
							{preview.totals.withConflicts}
						</DataRow>
						<DataRow label="Unallocated Dark Time">
							{formatHours(preview.totals.unallocatedMs)} of {formatHours(preview.totals.scopeMs)}
						</DataRow>
					</DataList>
					<p className="m-0 text-xs text-ink-300">One target at a time: blocks of different items must not overlap. Dark time is where the Sun is below the plan's limit.</p>
					{document.items.length > 0 && <PlanTimeline plan={document} preview={preview} timeZone={timeZone} onMove={(itemId, start) => editItem(itemId, (item) => ({ ...item, scheduledStartAt: start }))} />}
				</>
			)}
			{tool.previewLoading && !preview && <p className="m-0 text-sm text-ink-300">Computing the plan…</p>}
			{document.items.length === 0 ? (
				<Notice>Add targets from Discover or Analysis, or from an object selected in the Sky.</Notice>
			) : (
				<div className="flex flex-col gap-3">
					{document.items.map((item, index) => (
						<PlanItemRow
							key={item.id}
							item={item}
							preview={preview?.items.find((e) => e.itemId === item.id)}
							timeZone={timeZone}
							first={index === 0}
							last={index === document.items.length - 1}
							nightStart={preview?.night.display.start}
							onChange={(change) => editItem(item.id, change)}
							onMove={(by) => move(index, by)}
							onRemove={() => edit((current) => ({ ...current, items: current.items.filter((e) => e.id !== item.id) }))}
							onShow={() => showTargetInSky({ target: item.target, name: item.targetName }, activeSite)}
							onAnalyze={() => onAnalyze({ target: item.target, name: item.targetName })}
						/>
					))}
				</div>
			)}
		</div>
	)
}

// Properties of the row of an item.
interface PlanItemRowProps {
	// Item.
	readonly item: ObservingPlanItem
	// Its preview, once computed.
	readonly preview?: ObservingPlanItemPreview
	// IANA zone of its times.
	readonly timeZone: string
	// Whether it is the first and the last item.
	readonly first: boolean
	readonly last: boolean
	// Start of the displayed night, which an item scheduled from its row starts at when it has no window.
	readonly nightStart?: number
	// Changes the item.
	readonly onChange: (change: (item: ObservingPlanItem) => ObservingPlanItem) => void
	// Moves the item up (−1) or down (1).
	readonly onMove: (by: number) => void
	// Removes the item.
	readonly onRemove: () => void
	// Shows the target in the Sky.
	readonly onShow: () => void
	// Analyzes the target.
	readonly onAnalyze: () => void
}

// Row of an item of a plan: its target and status, its request, its start, its problems, and its actions.
function PlanItemRow({ item, preview, timeZone, first, last, nightStart, onChange, onMove, onRemove, onShow, onAnalyze }: PlanItemRowProps) {
	const [startError, setStartError] = useState<string>()
	const status = preview?.analysis.status
	const firstWindow = preview?.analysis.windows[0]

	return (
		<section className="flex flex-col gap-2 rounded-sm border border-line-100 bg-base-100 p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-100">{item.targetName}</span>
				{status && <StatusBadge tone={STATUS_LABELS[status].tone} label={STATUS_LABELS[status].label} />}
				<IconButton icon="stepBack" className="rotate-90" label="Move up" disabled={first} onClick={() => onMove(-1)} />
				<IconButton icon="stepForward" className="rotate-90" label="Move down" disabled={last} onClick={() => onMove(1)} />
				<IconButton icon="sky" label="Show in Sky" disabled={status === 'unresolved'} onClick={onShow} />
				<IconButton icon="compass" label="Analyze" onClick={onAnalyze} />
				<IconButton icon="trash" label="Remove from the plan" onClick={onRemove} />
			</div>
			<div className="flex flex-wrap items-end gap-3">
				<NumberInput label="Priority" className="w-32" value={item.priority} min={1} max={5} onChange={(priority) => onChange((current) => ({ ...current, priority }))} />
				<NumberInput label="Requested" className="w-40" suffix="min" value={Math.round(item.requestedDurationMs / MINUTE_MS)} min={1} max={1440} step={5} onChange={(minutes) => onChange((current) => ({ ...current, requestedDurationMs: minutes * MINUTE_MS }))} />
				{item.scheduledStartAt === undefined ? (
					<Button variant="secondary" disabled={!firstWindow && nightStart === undefined} onClick={() => onChange((current) => ({ ...current, scheduledStartAt: Math.ceil((firstWindow?.start ?? nightStart!) / MINUTE_MS) * MINUTE_MS }))}>
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
				<TextInput key={`notes-${item.notes}`} label="Notes" className="min-w-40 flex-1" defaultValue={item.notes} onBlur={(event) => event.target.value !== item.notes && onChange((current) => ({ ...current, notes: event.target.value }))} />
			</div>
			{startError && <Notice error>{startError}</Notice>}
			{preview && preview.conflicts.length > 0 && (
				<ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-warning">
					{preview.conflicts.map((conflict) => (
						<li key={`${conflict.code}-${conflict.itemId ?? ''}`}>⚠ {CONFLICT_LABELS[conflict.code]}</li>
					))}
				</ul>
			)}
		</section>
	)
}
