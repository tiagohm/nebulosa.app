import type { SpiceBody, SpiceBodySegment, SpiceKernelSummary } from 'api'
import { cn } from 'cn'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { MISSING } from '../../format'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Notice } from '../../ui/Notice'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { type BodyNames, epochDate, epochDateTime, epochOf, naifName, USAGE } from './format'
import { LibrarySection } from './LibrarySection'
import { setSpiceBodyPreference, spiceKernelsState, timelinePlacement, timelineSpan } from './spicekernels'

// Bodies section of the SPICE Kernel Library tool: how the enabled kernels provide each body. Every body of the current
// set is listed, filtered by its name or NAIF code, in a frame that scrolls itself and fills the height of the workspace,
// with the kernels that have it and the one preferred for it; a selected body opens in the panel the control that prefers
// a kernel for it and its segments in selection order on a timeline, where each is drawn over its coverage and filled
// where it is the selected one, so a segment hidden by another one is visible as such.

// Value of the preference control that follows the load order alone.
const LOAD_ORDER = ''

// Name of a kernel by its id, or the id when the library no longer has it.
function kernelName(kernels: readonly SpiceKernelSummary[], id: string) {
	return kernels.find((e) => e.id === id)?.name ?? id
}

// Bodies whose name or NAIF code contains every word of `query`, case-insensitive, in their order.
function filterBodies(bodies: readonly SpiceBody[], query: string, names: BodyNames) {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean)
	if (words.length === 0) return bodies
	return bodies.filter((e) => {
		const text = naifName(e.body, names).toLowerCase()
		return words.every((word) => text.includes(word))
	})
}

interface BodiesProps {
	// Bodies of the current set; undefined while they are read.
	readonly bodies?: readonly SpiceBody[]
	readonly kernels: readonly SpiceKernelSummary[]
	// Names of the library's small bodies.
	readonly names: BodyNames
	// Body shown in the panel, by NAIF code.
	readonly selected?: number
	readonly onSelect: (body: number) => void
}

// Bodies section.
export function Bodies({ bodies, kernels, names, selected, onSelect }: BodiesProps) {
	const [query, setQuery] = useState('')

	if (!bodies) return <EmptyState title="Loading" description="Reading the bodies of the enabled kernels." />
	if (bodies.length === 0) return <EmptyState title="No bodies" description="Enable a kernel in Installed, or add one in Add Kernel." />

	const shown = filterBodies(bodies, query, names)

	return (
		<LibrarySection
			title="Bodies"
			className="min-h-0"
			aside={
				<div className="flex flex-wrap items-end gap-3">
					<span className="pb-2 text-xs text-ink-300">{shown.length === bodies.length ? `${bodies.length} bodies` : `${shown.length} of ${bodies.length} bodies`}</span>
					<TextInput label="Search" className="w-60" value={query} placeholder="Name or NAIF code…" onChange={(e) => setQuery(e.target.value)} />
				</div>
			}
		>
			<Notice className="max-w-3xl">At each instant a body takes the segment of its preferred kernel where one covers it, otherwise the covering segment highest in the load order. Each link of a chain, such as Saturn → Saturn barycenter, is selected on its own. Select a body to see its segments.</Notice>
			{shown.length > 0 ? (
				<Table columns={['Body', { key: 'kernels', label: 'Kernels', className: 'max-sm:hidden' }, { key: 'coverage', label: 'Coverage', className: 'max-sm:hidden' }, 'Selected from', { key: 'preference', label: 'Preference', className: 'max-md:hidden' }]}>
					{shown.map((e) => (
						<BodyRow key={e.body} body={e} kernels={kernels} names={names} selected={e.body === selected} onSelect={() => onSelect(e.body)} />
					))}
				</Table>
			) : (
				<Notice>No body matches “{query.trim()}”.</Notice>
			)}
		</LibrarySection>
	)
}

interface BodyRowProps {
	readonly body: SpiceBody
	readonly kernels: readonly SpiceKernelSummary[]
	readonly names: BodyNames
	readonly selected: boolean
	readonly onSelect: () => void
}

// One body: how many kernels have it, its coverage, and the kernels its selection takes.
function BodyRow({ body, kernels, names, selected, onSelect }: BodyRowProps) {
	const span = timelineSpan(body.segments)
	const used = [...new Set(body.coverage.map((e) => e.kernelId))].map((e) => kernelName(kernels, e))

	return (
		<Row selected={selected} onSelect={onSelect}>
			<Cell className="text-ink-100">{naifName(body.body, names)}</Cell>
			<Cell className="max-sm:hidden">
				<span className="flex items-center gap-2">
					{body.kernelIds.length}
					{body.kernelIds.length > 1 && <StatusBadge tone="neutral" label="Overlap" />}
				</span>
			</Cell>
			<Cell className="max-sm:hidden">{span ? `${epochDate(span.start)} – ${epochDate(span.end)}` : MISSING}</Cell>
			<Cell className="max-w-64 truncate" title={used.join(', ')}>
				{used.join(', ') || MISSING}
			</Cell>
			<Cell className="max-w-48 truncate max-md:hidden">{body.preferredKernelId ? kernelName(kernels, body.preferredKernelId) : 'Load order'}</Cell>
		</Row>
	)
}

interface BodyDetailsProps {
	readonly body: SpiceBody
	readonly kernels: readonly SpiceKernelSummary[]
	// Names of the library's small bodies.
	readonly names: BodyNames
}

// Panel of a body: its preferred kernel, then its segments in selection order on a timeline.
export function BodyDetails({ body, kernels, names }: BodyDetailsProps) {
	const state = useSnapshot(spiceKernelsState)
	const key = `body:${body.body}`
	// The preferred kernel stays an option while disabled, so the control shows the stored preference.
	const options = [LOAD_ORDER, ...new Set([...(body.preferredKernelId ? [body.preferredKernelId] : []), ...body.kernelIds])]
	const disabledPreference = body.preferredKernelId !== undefined && !body.kernelIds.includes(body.preferredKernelId)
	const single = options.length <= 2

	return (
		<>
			<CollapsibleSection id="spiceKernels.body" title="Preference" summary={body.preferredKernelId ? kernelName(kernels, body.preferredKernelId) : 'Load order'}>
				<span className="min-w-0 text-sm font-medium wrap-break-word text-ink-100">{naifName(body.body, names)}</span>
				<Select
					label="Preferred kernel"
					className="w-full"
					options={options}
					value={body.preferredKernelId ?? LOAD_ORDER}
					disabled={state.pending[key] || single}
					format={(e) => (e === LOAD_ORDER ? 'None (load order)' : kernelName(kernels, e))}
					onChange={(e) => void setSpiceBodyPreference(spiceKernelsState, body.body, e === LOAD_ORDER ? undefined : e)}
				/>
				{single && <Notice>Only one kernel has this body, so a preference changes nothing.</Notice>}
				{disabledPreference && <Notice>The preferred kernel is disabled; the load order applies until it is enabled again.</Notice>}
				{state.errors[key] && <Notice error>{state.errors[key]}</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="spiceKernels.segments" title="Segments" summary={`${body.segments.length}`}>
				<Timeline body={body} kernels={kernels} names={names} />
			</CollapsibleSection>
		</>
	)
}

// Span of a timeline, TDB seconds past J2000.
type Span = NonNullable<ReturnType<typeof timelineSpan>>

// The selected coverage of a body, then each of its segments in selection order over the same span: its use, its track
// (its coverage, filled where it is the one selected, in red where it cannot be evaluated), and its center, type, and
// dates. A thin line marks today when it falls within the span.
function Timeline({ body, kernels, names }: BodyDetailsProps) {
	const span = timelineSpan(body.segments)
	if (!span) return null
	const now = epochOf(Date.now())
	const today = now > span.start && now < span.end ? timelinePlacement(span, now, now, 0).left : undefined

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<span className="text-xs leading-4 text-ink-200">Selected</span>
				<Track span={span} segments={[]} intervals={body.coverage} kernels={kernels} today={today} />
			</div>
			<ol className="m-0 flex list-none flex-col gap-3 p-0">
				{body.segments.map((segment, i) => (
					<li key={`${segment.kernelId}:${segment.segment}`} className="flex flex-col gap-1">
						<div className="flex items-center justify-between gap-2">
							<span className="min-w-0 truncate text-sm text-ink-100" title={kernelName(kernels, segment.kernelId)}>
								{i + 1}. {kernelName(kernels, segment.kernelId)} #{segment.segment}
								{segment.preferred ? ' · preferred' : ''}
							</span>
							<StatusBadge tone={USAGE[segment.usage].tone} label={USAGE[segment.usage].label} />
						</div>
						<Track span={span} segments={[segment]} intervals={body.coverage.filter((e) => e.kernelId === segment.kernelId && e.segment === segment.segment)} kernels={kernels} today={today} />
						<span className="text-xs leading-4 text-ink-300">
							Center {naifName(segment.center, names)} · type {segment.dataType}
							{segment.supported ? '' : ` (unsupported ${segment.reason === 'frame' ? `frame ${segment.frame}` : 'type'})`} · {epochDate(segment.start)} – {epochDate(segment.end)}
						</span>
					</li>
				))}
			</ol>
			<div className="flex justify-between text-xs leading-4 text-ink-300">
				<span>{epochDate(span.start)}</span>
				{today !== undefined && <span>Line: today</span>}
				<span>{epochDate(span.end)}</span>
			</div>
		</div>
	)
}

interface TrackProps {
	readonly span: Span
	// Segments whose coverage is drawn as the track.
	readonly segments: readonly SpiceBodySegment[]
	// Intervals drawn filled.
	readonly intervals: SpiceBody['coverage']
	readonly kernels: readonly SpiceKernelSummary[]
	// Position of today, in percent of the span; absent when it falls outside.
	readonly today?: number
}

// One track of the timeline: coverage in Graticule, the selected intervals in Moonlight, and the unsupported ones in a
// translucent red, so the panel never glows.
function Track({ span, segments, intervals, kernels, today }: TrackProps) {
	return (
		<div className="relative h-2.5 rounded-xs bg-base-200">
			{segments.map((segment) => {
				const { left, width } = timelinePlacement(span, segment.start, segment.end)
				return <div key={segment.segment} className="absolute inset-y-0 rounded-xs bg-line-200" style={{ left: `${left}%`, width: `${width}%` }} title={`${epochDateTime(segment.start)} – ${epochDateTime(segment.end)} UTC`} />
			})}
			{intervals.map((interval) => {
				const { left, width } = timelinePlacement(span, interval.start, interval.end)
				return (
					<div
						key={`${interval.kernelId}:${interval.segment}:${interval.start}`}
						className={cn('absolute inset-y-0 rounded-xs', interval.supported ? 'bg-ink-200' : 'bg-danger/60')}
						style={{ left: `${left}%`, width: `${width}%` }}
						title={`${kernelName(kernels, interval.kernelId)} #${interval.segment}: ${epochDateTime(interval.start)} – ${epochDateTime(interval.end)} UTC${interval.supported ? '' : ' (unsupported)'}`}
					/>
				)
			})}
			{today !== undefined && <div className="pointer-events-none absolute -inset-y-0.5 w-px bg-ink-100" style={{ left: `${today}%` }} />}
		</div>
	)
}
