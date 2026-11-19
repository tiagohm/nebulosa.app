import type { SpiceKernelDetails, SpiceKernelSummary } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize, formatZonedDateTime, MISSING } from '../../format'
import { useActiveTimeZone } from '../../location/useLocation'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { epochDate, naifName, READINESS, SOURCE_LABELS, USAGE } from './format'
import { deleteSpiceKernel, fetchSpiceKernelDetails, spiceKernelsState, updateSpiceKernel, verifySpiceKernel } from './spicekernels'

// One kernel of the SPICE Kernel Library: the panel with its provenance and integrity, why it is or is not usable, and
// the commands that change it, and the section below the Installed list with every segment and its own coverage, so gaps
// between segments show.

// What a missing dependency means for people.
const DEPENDENCY_HINT = 'Some bodies are relative to bodies no enabled kernel provides. Add or enable a planetary kernel, such as de440s.bsp, that has them.'

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
	const count = state.snapshot?.kernels.length ?? 0
	// Precedence among the enabled kernels, from 1, the highest.
	const enabled = state.snapshot?.kernels.filter((e) => e.enabled) ?? []
	const rank = enabled.length - enabled.findIndex((e) => e.id === kernel.id)
	const readiness = READINESS[kernel.readiness]

	async function remove() {
		if (await deleteSpiceKernel(spiceKernelsState, kernel.id)) onDeleted()
	}

	return (
		<CollapsibleSection id="spiceKernels.kernel" title="Kernel" summary={kernel.name}>
			<div className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 wrap-break-word text-sm font-medium text-ink-100">{kernel.name}</span>
				<StatusBadge tone={readiness.tone} label={readiness.label} />
			</div>
			{kernel.readiness === 'missingDependency' && (
				<Notice>
					{DEPENDENCY_HINT} Missing: {kernel.missingBodies?.map(naifName).join(', ')}.
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
				<DataRow label="Precedence">{kernel.enabled ? `${rank} of ${enabled.length} enabled (1 wins)` : 'Disabled'}</DataRow>
				<DataRow label="SHA-256">
					<span className="font-mono text-xs break-all">{kernel.sha256}</span>
				</DataRow>
			</DataList>
			<Actions>
				<Button variant="secondary" disabled={pending || kernel.priority >= count - 1} onClick={() => void updateSpiceKernel(spiceKernelsState, kernel.id, { priority: kernel.priority + 1 })}>
					Raise
				</Button>
				<Button variant="secondary" disabled={pending || kernel.priority === 0} onClick={() => void updateSpiceKernel(spiceKernelsState, kernel.id, { priority: kernel.priority - 1 })}>
					Lower
				</Button>
				<Button variant="secondary" disabled={pending} onClick={() => void verifySpiceKernel(spiceKernelsState, kernel.id)}>
					Verify
				</Button>
				<ConfirmButton disabled={pending} title="Delete the kernel?" message={`${kernel.name} and its file are removed from the server. Positions it provided come from the other sources of the ephemeris chain.`} confirmLabel="Delete" onConfirm={() => void remove()}>
					Delete
				</ConfirmButton>
			</Actions>
		</CollapsibleSection>
	)
}

// Segments of a kernel in file order, below the Installed list, each with its own coverage and, while the kernel is
// enabled, how much of it the ephemeris selects: a segment another kernel overrides everywhere is never used. They are
// read again whenever the library changes.
export function KernelSegments({ kernel }: { readonly kernel: SpiceKernelSummary }) {
	const state = useSnapshot(spiceKernelsState)
	const [details, setDetails] = useState<SpiceKernelDetails>()

	useEffect(() => {
		const controller = new AbortController()
		void fetchSpiceKernelDetails(kernel.id, controller.signal).then((value) => !controller.signal.aborted && setDetails(value))
		return () => controller.abort()
	}, [kernel.id, state.revision])

	return (
		<section className="flex flex-1 flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4 min-h-0">
			<div className="flex flex-wrap items-baseline justify-between gap-3">
				<h2 className="m-0 min-w-0 text-sm font-semibold wrap-break-word text-ink-100">{kernel.name}</h2>
				<span className="text-xs text-ink-300">
					{kernel.segmentCount} {kernel.segmentCount === 1 ? 'segment' : 'segments'}
					{kernel.unsupportedSegments > 0 ? `, ${kernel.unsupportedSegments} unsupported` : ''}
				</span>
			</div>
			{details ? <Segments details={details} /> : <Notice>Loading…</Notice>}
		</section>
	)
}

// Table of the segments of a kernel in file order.
function Segments({ details }: { readonly details: SpiceKernelDetails }) {
	return (
		<Table columns={['Segment', 'Body', 'Center', 'Type', 'Coverage (UTC)', 'Status', 'Use']}>
			{details.segments.map((segment) => (
				<Row key={segment.index} title={segment.name}>
					<Cell>{segment.index}</Cell>
					<Cell>{naifName(segment.target)}</Cell>
					<Cell>{naifName(segment.center)}</Cell>
					<Cell>{segment.dataType}</Cell>
					<Cell>
						{epochDate(segment.start)} – {epochDate(segment.end)}
					</Cell>
					<Cell>{segment.supported ? 'Supported' : segment.reason === 'frame' ? `Frame ${segment.frame}` : 'Unsupported type'}</Cell>
					<Cell>{segment.usage ? <StatusBadge tone={USAGE[segment.usage].tone} label={USAGE[segment.usage].label} /> : MISSING}</Cell>
				</Row>
			))}
		</Table>
	)
}
