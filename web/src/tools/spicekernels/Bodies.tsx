import type { SpiceBody, SpiceBodySegment, SpiceKernelSummary } from 'api'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { MISSING } from '../../format'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Notice } from '../../ui/Notice'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { epochDate, epochDateTime, naifName, USAGE } from './format'
import { fetchSpiceBodies, setSpiceBodyPreference, spiceKernelsState, timelinePlacement, timelineSpan } from './spicekernels'

// Bodies section of the SPICE Kernel Library tool: how the enabled kernels provide each body. Every body of the current
// set is listed with the kernels that have it and the one preferred for it; selecting one shows its segments in
// selection order on a timeline, where each is drawn over its coverage and filled where it is the selected one, so a
// segment hidden by another one is visible as such, and lets the operator prefer a kernel for the body.

// Value of the preference control that follows the load order alone.
const LOAD_ORDER = ''

// Bodies section.
export function Bodies() {
	const state = useSnapshot(spiceKernelsState)
	const [bodies, setBodies] = useState<readonly SpiceBody[]>()
	const [selected, setSelected] = useState<number>()
	const kernels = state.snapshot?.kernels ?? []

	useEffect(() => {
		const controller = new AbortController()
		void fetchSpiceBodies(controller.signal).then((value) => !controller.signal.aborted && setBodies(value?.bodies ?? []))
		return () => controller.abort()
	}, [state.revision])

	if (!bodies) return <EmptyState title="Loading" description="Reading the bodies of the enabled kernels." />
	if (bodies.length === 0) return <EmptyState title="No bodies" description="Enable a kernel in Installed, or add one in Add Kernel." />

	const body = bodies.find((e) => e.body === selected)

	return (
		<>
			<Notice>
				For each body, at each instant, the ephemeris takes the segment of the preferred kernel when one covers the instant; otherwise the covering segment of the kernel highest in the load order, and within one kernel the later segment. Each link of a chain, such as Saturn → Saturn barycenter → solar system
				barycenter, is selected on its own, so one position may combine several kernels.
			</Notice>
			<Table columns={['Body', 'Kernels', 'Coverage', 'Selected from', 'Preference']} className="flex-1">
				{bodies.map((e) => (
					<BodyRow key={e.body} body={e} kernels={kernels} selected={e.body === selected} onSelect={() => setSelected(e.body)} />
				))}
			</Table>
			{body && <BodyDetails key={body.body} body={body} kernels={kernels} />}
		</>
	)
}

// Name of a kernel by its id, or the id when the library no longer has it.
function kernelName(kernels: readonly SpiceKernelSummary[], id: string) {
	return kernels.find((e) => e.id === id)?.name ?? id
}

interface BodyRowProps {
	readonly body: SpiceBody
	readonly kernels: readonly SpiceKernelSummary[]
	readonly selected: boolean
	readonly onSelect: () => void
}

// One body: how many kernels have it, its coverage, and the kernels its selection takes.
function BodyRow({ body, kernels, selected, onSelect }: BodyRowProps) {
	const span = timelineSpan(body.segments)
	const used = [...new Set(body.coverage.map((e) => e.kernelId))].map((e) => kernelName(kernels, e))

	return (
		<Row selected={selected} onSelect={onSelect}>
			<Cell>{naifName(body.body)}</Cell>
			<Cell>
				<span className="flex items-center gap-2">
					{body.kernelIds.length}
					{body.kernelIds.length > 1 && <StatusBadge tone="neutral" label="Overlap" />}
				</span>
			</Cell>
			<Cell>{span ? `${epochDate(span.start)} – ${epochDate(span.end)}` : MISSING}</Cell>
			<Cell className="max-w-64 truncate" title={used.join(', ')}>
				{used.join(', ') || MISSING}
			</Cell>
			<Cell className="max-w-48 truncate">{body.preferredKernelId ? kernelName(kernels, body.preferredKernelId) : 'Load order'}</Cell>
		</Row>
	)
}

interface BodyDetailsProps {
	readonly body: SpiceBody
	readonly kernels: readonly SpiceKernelSummary[]
}

// One body: its preference, its timeline, and its segments in selection order.
function BodyDetails({ body, kernels }: BodyDetailsProps) {
	const state = useSnapshot(spiceKernelsState)
	const key = `body:${body.body}`
	// The preferred kernel stays an option while disabled, so the control shows the stored preference.
	const options = [LOAD_ORDER, ...new Set([...(body.preferredKernelId ? [body.preferredKernelId] : []), ...body.kernelIds])]
	const disabledPreference = body.preferredKernelId !== undefined && !body.kernelIds.includes(body.preferredKernelId)

	return (
		<section className="flex flex-1 flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4 max-h-[50vh]">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<h2 className="m-0 text-sm font-semibold text-ink-100">{naifName(body.body)}</h2>
				<Select
					label="Preferred kernel"
					className="w-72 flex-none"
					options={options}
					value={body.preferredKernelId ?? LOAD_ORDER}
					disabled={state.pending[key] || options.length <= 2}
					format={(e) => (e === LOAD_ORDER ? 'None (load order)' : kernelName(kernels, e))}
					onChange={(e) => void setSpiceBodyPreference(spiceKernelsState, body.body, e === LOAD_ORDER ? undefined : e)}
				/>
			</div>
			{options.length <= 2 && <Notice>Only one kernel has this body, so a preference changes nothing.</Notice>}
			{disabledPreference && <Notice>The preferred kernel is disabled; the load order applies until it is enabled again.</Notice>}
			{state.errors[key] && <Notice error>{state.errors[key]}</Notice>}
			<Timeline body={body} kernels={kernels} />
			<Table columns={['Order', 'Kernel', 'Segment', 'Center', 'Type', 'Coverage (UTC)', 'Use']}>
				{body.segments.map((segment, i) => (
					<Row key={`${segment.kernelId}:${segment.segment}`}>
						<Cell>{i + 1}</Cell>
						<Cell className="max-w-56 truncate">
							{kernelName(kernels, segment.kernelId)}
							{segment.preferred ? ' · preferred' : ''}
						</Cell>
						<Cell>{segment.segment}</Cell>
						<Cell>{naifName(segment.center)}</Cell>
						<Cell>{segment.supported ? segment.dataType : `${segment.dataType} (unsupported ${segment.reason === 'frame' ? `frame ${segment.frame}` : 'type'})`}</Cell>
						<Cell>
							{epochDate(segment.start)} – {epochDate(segment.end)}
						</Cell>
						<Cell>
							<StatusBadge tone={USAGE[segment.usage].tone} label={USAGE[segment.usage].label} />
						</Cell>
					</Row>
				))}
			</Table>
		</section>
	)
}

// Segments of a body on a common time line, in selection order: the track of each is its coverage, filled where it is the
// segment selected, in red where that segment cannot be evaluated.
function Timeline({ body, kernels }: BodyDetailsProps) {
	const span = timelineSpan(body.segments)
	if (!span) return null

	return (
		<div className="flex flex-col gap-1.5 text-xs text-ink-300">
			<TimelineRow label="Selected" span={span} segments={[]} intervals={body.coverage} kernels={kernels} />
			{body.segments.map((segment) => (
				<TimelineRow key={`${segment.kernelId}:${segment.segment}`} label={`${kernelName(kernels, segment.kernelId)} #${segment.segment}`} span={span} segments={[segment]} intervals={body.coverage.filter((e) => e.kernelId === segment.kernelId && e.segment === segment.segment)} kernels={kernels} />
			))}
			<div className="flex justify-between pl-44">
				<span>{epochDate(span.start)}</span>
				<span>{epochDate(span.end)}</span>
			</div>
		</div>
	)
}

interface TimelineRowProps {
	readonly label: string
	readonly span: { readonly start: number; readonly end: number }
	// Segments whose coverage is drawn as the track.
	readonly segments: readonly SpiceBodySegment[]
	// Intervals drawn filled.
	readonly intervals: SpiceBody['coverage']
	readonly kernels: readonly SpiceKernelSummary[]
}

// One row of the timeline.
function TimelineRow({ label, span, segments, intervals, kernels }: TimelineRowProps) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-42 flex-none truncate" title={label}>
				{label}
			</span>
			<div className="relative h-3 flex-1 rounded-xs bg-base-200">
				{segments.map((segment) => {
					const { left, width } = timelinePlacement(span, segment.start, segment.end)
					return <div key={segment.segment} className="absolute inset-y-0 rounded-xs bg-line-200" style={{ left: `${left}%`, width: `${width}%` }} title={`${epochDateTime(segment.start)} – ${epochDateTime(segment.end)} UTC`} />
				})}
				{intervals.map((interval) => {
					const { left, width } = timelinePlacement(span, interval.start, interval.end)
					return (
						<div
							key={`${interval.kernelId}:${interval.segment}:${interval.start}`}
							className={cn('absolute inset-y-0 rounded-xs', interval.supported ? 'bg-accent' : 'bg-danger/60')}
							style={{ left: `${left}%`, width: `${width}%` }}
							title={`${kernelName(kernels, interval.kernelId)} #${interval.segment}: ${epochDateTime(interval.start)} – ${epochDateTime(interval.end)} UTC${interval.supported ? '' : ' (unsupported)'}`}
						/>
					)
				})}
			</div>
		</div>
	)
}
