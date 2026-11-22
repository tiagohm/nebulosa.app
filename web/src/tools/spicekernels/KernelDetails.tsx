import type { SpiceKernelDetails, SpiceKernelSegment, SpiceKernelSummary } from 'api'
import { useCallback, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize, formatZonedDateTime } from '../../format'
import { useActiveTimeZone } from '../../location/useLocation'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { VirtualList } from '../../ui/VirtualList'
import { type BodyNames, epochDate, naifName, READINESS, SOURCE_LABELS, USAGE } from './format'
import { LibrarySection } from './LibrarySection'
import { deleteSpiceKernel, fetchSpiceKernelDetails, spiceKernelsState, strandedKernels, updateSpiceKernel, verifySpiceKernel } from './spicekernels'

// One kernel of the SPICE Kernel Library: the panel with its provenance and integrity, why it is or is not usable, its
// place in the load order, and the commands that change it, and the section below the Installed list with every segment
// and its own coverage, so gaps between segments show. Deleting says what cannot come back and which kernels it strands.

// What a missing dependency means for people.
const DEPENDENCY_HINT = 'Some bodies are relative to bodies no enabled kernel provides. Add or enable a planetary kernel, such as de440s.bsp, that has them.'

// Most stranded kernels a delete confirmation names before counting the rest.
const NAMED_STRANDED = 3

// What deleting a kernel means: what is removed, whether and how it can come back, and the small-body kernels that would
// need a planetary kernel again.
function deleteMessage(kernel: SpiceKernelSummary, kernels: readonly SpiceKernelSummary[]) {
	const recovery =
		kernel.sourceKind === 'naif'
			? `Downloading it again from Add Kernel transfers ${formatByteSize(kernel.bytes)}.`
			: kernel.sourceKind === 'import'
				? 'An upload cannot be fetched again: keep a copy of the file to import it later.'
				: kernel.sourceKind === 'elements'
					? 'It can be integrated again from Add Kernel, from newer elements.'
					: 'It can be generated again from Add Kernel, from the current orbit.'
	const stranded = strandedKernels(kernels, kernel.id)
	const named = stranded.slice(0, NAMED_STRANDED).map((e) => e.name)
	const rest = stranded.length - named.length
	const list = rest > 0 ? `${named.join(', ')}, and ${rest} more` : named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0]
	const strands = stranded.length > 0 ? ` It is the only enabled kernel with the Sun, so ${list} will need a planetary kernel.` : ''
	return `${kernel.name} and its file are removed from the server; this cannot be undone. ${recovery}${strands}`
}

interface KernelDetailsProps {
	readonly kernel: SpiceKernelSummary
	// Called once the kernel is deleted.
	readonly onDeleted: () => void
}

// Panel of a kernel.
export function KernelDetails({ kernel, onDeleted }: KernelDetailsProps) {
	const timeZone = useActiveTimeZone()
	const state = useSnapshot(spiceKernelsState)
	const key = `kernel:${kernel.id}`
	const pending = state.pending[key]
	const kernels = state.snapshot?.kernels ?? []
	// Precedence among the enabled kernels, from 1, the highest.
	const enabled = kernels.filter((e) => e.enabled)
	const rank = enabled.length - enabled.findIndex((e) => e.id === kernel.id)
	const first = kernel.priority >= kernels.length - 1
	const last = kernel.priority === 0
	const readiness = READINESS[kernel.readiness]
	const precedence = kernel.enabled ? `${rank} of ${enabled.length} enabled` : 'Disabled'

	async function remove() {
		if (await deleteSpiceKernel(spiceKernelsState, kernel.id)) onDeleted()
	}

	// Moves the kernel to a priority of the load order, from 0, the lowest.
	function move(priority: number) {
		void updateSpiceKernel(spiceKernelsState, kernel.id, { priority })
	}

	return (
		<>
			<CollapsibleSection id="spiceKernels.kernel" title="Details" summary={readiness.label}>
				<div className="flex flex-wrap items-center gap-2">
					<span className="min-w-0 text-sm font-medium wrap-break-word text-ink-100">{kernel.name}</span>
					<StatusBadge tone={readiness.tone} label={readiness.label} />
				</div>
				{kernel.readiness === 'missingDependency' && (
					<Notice>
						{DEPENDENCY_HINT} Missing: {kernel.missingBodies?.map((e) => naifName(e)).join(', ')}.
					</Notice>
				)}
				{kernel.readiness === 'unsupported' && <Notice>No segment of this file can be evaluated: the server reads only J2000 segments of SPK types 2, 3, 9, 17, and 21.</Notice>}
				{kernel.failure && <Notice error>{kernel.failure}</Notice>}
				{state.errors[key] && <Notice error>{state.errors[key]}</Notice>}
				<DataList>
					<DataRow label="Source">
						{SOURCE_LABELS[kernel.sourceKind]}
						{kernel.sourceRef ? ` · ${kernel.sourceRef}` : ''}
					</DataRow>
					{kernel.provenance && <DataRow label="Provenance">{kernel.provenance}</DataRow>}
					{kernel.requestedStart !== undefined && kernel.requestedEnd !== undefined && (
						<DataRow label="Requested">
							{new Date(kernel.requestedStart).toISOString().slice(0, 10)} – {new Date(kernel.requestedEnd).toISOString().slice(0, 10)} UTC
						</DataRow>
					)}
					<DataRow label="Added">{formatZonedDateTime(kernel.createdAt, timeZone, false)}</DataRow>
					<DataRow label="Size">{formatByteSize(kernel.bytes)}</DataRow>
					<DataRow label="Segments">
						{kernel.segmentCount}
						{kernel.unsupportedSegments > 0 ? `, ${kernel.unsupportedSegments} unsupported` : ''}
					</DataRow>
					<DataRow label="SHA-256">
						<span className="font-mono text-xs break-all">{kernel.sha256}</span>
					</DataRow>
				</DataList>
			</CollapsibleSection>
			<CollapsibleSection id="spiceKernels.order" title="Load order" summary={precedence}>
				<DataRow label="Precedence">{precedence}</DataRow>
				<Notice>Precedence 1 provides a body where kernels overlap.</Notice>
				<Actions>
					<Button variant="secondary" disabled={pending || first} title={first ? 'Already first in the load order' : 'Gives this kernel precedence over every other'} onClick={() => move(kernels.length - 1)}>
						Move to first
					</Button>
					<Button variant="secondary" disabled={pending || first} title={first ? 'Already first in the load order' : 'Moves this kernel one place up'} onClick={() => move(kernel.priority + 1)}>
						Raise
					</Button>
					<Button variant="secondary" disabled={pending || last} title={last ? 'Already last in the load order' : 'Moves this kernel one place down'} onClick={() => move(kernel.priority - 1)}>
						Lower
					</Button>
				</Actions>
			</CollapsibleSection>
			<CollapsibleSection id="spiceKernels.file" title="File">
				<Notice>Verify hashes and inspects the file again; nothing is downloaded.</Notice>
				<Actions>
					<Button variant="secondary" disabled={pending} onClick={() => void verifySpiceKernel(spiceKernelsState, kernel.id)}>
						Verify
					</Button>
					<ConfirmButton destructive disabled={pending} title="Delete the kernel?" message={deleteMessage(kernel, kernels)} confirmLabel="Delete" onConfirm={() => void remove()}>
						Delete
					</ConfirmButton>
				</Actions>
			</CollapsibleSection>
		</>
	)
}

interface KernelSegmentsProps {
	readonly kernel: SpiceKernelSummary
	// Names of the library's small bodies.
	readonly names: BodyNames
}

// Segments of a kernel in file order, below the Installed list, each with its own coverage and, while the kernel is
// enabled, how much of it the ephemeris selects: a segment another kernel overrides everywhere is never used. They are
// read again whenever the library changes.
export function KernelSegments({ kernel, names }: KernelSegmentsProps) {
	const state = useSnapshot(spiceKernelsState)
	const [details, setDetails] = useState<SpiceKernelDetails>()

	useEffect(() => {
		const controller = new AbortController()
		void fetchSpiceKernelDetails(kernel.id, controller.signal).then((value) => !controller.signal.aborted && setDetails(value))
		return () => controller.abort()
	}, [kernel.id, state.revision])

	return (
		<LibrarySection
			title={`Segments of ${kernel.name}`}
			className="min-h-0"
			// The list counts the segments beside its search; the heading only says how many the ephemeris cannot evaluate.
			aside={kernel.unsupportedSegments > 0 && <span className="text-xs text-ink-300">{kernel.unsupportedSegments} unsupported</span>}
		>
			{details ? <Segments details={details} names={names} /> : <Notice>Reading the segments of the kernel.</Notice>}
		</LibrarySection>
	)
}

// Index of a segment, its key in the list.
function segmentKey(segment: SpiceKernelSegment) {
	return segment.index
}

// Name of a segment as written in the file, its tooltip.
function segmentName(segment: SpiceKernelSegment) {
	return segment.name || undefined
}

// Caption of the search: how many segments are shown of all of them.
function segmentCount(shown: number, total: number) {
	return shown === total ? `${total} ${total === 1 ? 'segment' : 'segments'}` : `${shown} of ${total} segments`
}

// Text of a search without matches.
function noSegmentMatches(query: string) {
	return `No segment matches “${query}”.`
}

// Whether the ephemeris can evaluate a segment, or why not.
function segmentStatus(segment: SpiceKernelSegment) {
	return segment.supported ? 'supported' : segment.reason === 'frame' ? `frame ${segment.frame}` : 'unsupported type'
}

// Virtual list of the segments of a kernel in file order, however many it has, searched by index, body, or center.
function Segments({ details, names }: { readonly details: SpiceKernelDetails; readonly names: BodyNames }) {
	const searchText = useCallback((segment: SpiceKernelSegment) => `#${segment.index} ${naifName(segment.target, names)} ${naifName(segment.center, names)}`, [names])

	return (
		<VirtualList
			items={details.segments}
			itemKey={segmentKey}
			title={(segment) => `#${segment.index} ${naifName(segment.target, names)}`}
			description={(segment) => `Relative to ${naifName(segment.center, names)} · type ${segment.dataType} · ${segmentStatus(segment)}`}
			meta={(segment) => (
				<>
					<span>
						{epochDate(segment.start)} – {epochDate(segment.end)}
					</span>
					{segment.usage && <StatusBadge tone={USAGE[segment.usage].tone} label={USAGE[segment.usage].label} />}
				</>
			)}
			tooltip={segmentName}
			emptyText="This kernel has no segments."
			search={searchText}
			searchPlaceholder="Index, body, or center…"
			count={segmentCount}
			noMatchText={noSegmentMatches}
		/>
	)
}
