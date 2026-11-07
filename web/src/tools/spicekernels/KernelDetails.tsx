import type { SpiceKernelDetails, SpiceKernelSummary } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { DataList, DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { SectionHeading } from '../../ui/SectionHeading'
import { StatusBadge } from '../../ui/StatusBadge'
import { Cell, Row, Table } from '../../ui/Table'
import { epochDate, formatBytes, naifName, READINESS, SOURCE_LABELS } from './format'
import { deleteSpiceKernel, fetchSpiceKernelDetails, spiceKernelsState, updateSpiceKernel, verifySpiceKernel } from './spicekernels'

// Panel of one kernel of the SPICE Kernel Library: its provenance and integrity, why it is or is not usable, the
// commands that change it, and every segment with its own coverage, so gaps between segments show.

// What a missing dependency means for people.
const DEPENDENCY_HINT = 'Some bodies are relative to bodies no enabled kernel provides. Add or enable a planetary kernel, such as de440s.bsp, that has them.'

interface KernelDetailsProps {
	readonly kernel: SpiceKernelSummary
	// Called once the kernel is deleted.
	readonly onDeleted: () => void
}

// Details of a kernel; its segments are read again whenever the library changes.
export function KernelDetails({ kernel, onDeleted }: KernelDetailsProps) {
	const state = useSnapshot(spiceKernelsState)
	const [details, setDetails] = useState<SpiceKernelDetails>()
	const key = `kernel:${kernel.id}`
	const pending = state.pending[key]
	const count = state.snapshot?.kernels.length ?? 0
	const readiness = READINESS[kernel.readiness]

	useEffect(() => {
		const controller = new AbortController()
		void fetchSpiceKernelDetails(kernel.id, controller.signal).then((value) => !controller.signal.aborted && setDetails(value))
		return () => controller.abort()
	}, [kernel.id, state.revision])

	async function remove() {
		if (await deleteSpiceKernel(spiceKernelsState, kernel.id)) onDeleted()
	}

	return (
		<div className="flex min-w-0 flex-col gap-4 p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 wrap-break-word text-sm font-medium text-ink-100">{kernel.name}</span>
				<StatusBadge tone={readiness.tone} label={readiness.label} />
			</div>
			{kernel.readiness === 'missingDependency' && (
				<Notice>
					{DEPENDENCY_HINT} Missing: {kernel.missingBodies?.map(naifName).join(', ')}.
				</Notice>
			)}
			{kernel.readiness === 'unsupported' && <Notice>No segment of this file can be evaluated: the server reads only J2000 segments of SPK types 2, 3, 9, and 21.</Notice>}
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
				<DataRow label="Added">{new Date(kernel.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</DataRow>
				<DataRow label="Size">{formatBytes(kernel.bytes)}</DataRow>
				<DataRow label="Segments">
					{kernel.segmentCount}
					{kernel.unsupportedSegments > 0 ? `, ${kernel.unsupportedSegments} unsupported` : ''}
				</DataRow>
				<DataRow label="Load order">
					{kernel.priority + 1} of {count}
				</DataRow>
				<DataRow label="SHA-256">
					<span className="font-mono text-xs break-all">{kernel.sha256}</span>
				</DataRow>
			</DataList>
			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" disabled={pending || kernel.priority >= count - 1} onClick={() => void updateSpiceKernel(spiceKernelsState, kernel.id, { priority: kernel.priority + 1 })}>
					Raise
				</Button>
				<Button variant="secondary" disabled={pending || kernel.priority === 0} onClick={() => void updateSpiceKernel(spiceKernelsState, kernel.id, { priority: kernel.priority - 1 })}>
					Lower
				</Button>
				<Button variant="secondary" disabled={pending} onClick={() => void verifySpiceKernel(spiceKernelsState, kernel.id)}>
					Verify
				</Button>
				<ConfirmButton disabled={pending} title="Delete the kernel?" message={`${kernel.name} and its file are removed from the server. Positions it provided come from the other sources of the ephemeris policy.`} confirmLabel="Delete" onConfirm={() => void remove()}>
					Delete
				</ConfirmButton>
			</div>
			<SectionHeading>Segments</SectionHeading>
			{details ? <Segments details={details} /> : <p className="m-0 text-sm text-ink-300">Loading…</p>}
		</div>
	)
}

// Segments of a kernel in file order, each with its own coverage.
function Segments({ details }: { readonly details: SpiceKernelDetails }) {
	return (
		<Table columns={['Body', 'Center', 'Type', 'Coverage (UTC)', 'Status']}>
			{details.segments.map((segment) => (
				<Row key={segment.index} title={segment.name}>
					<Cell>{naifName(segment.target)}</Cell>
					<Cell>{naifName(segment.center)}</Cell>
					<Cell>{segment.dataType}</Cell>
					<Cell>
						{epochDate(segment.start)} – {epochDate(segment.end)}
					</Cell>
					<Cell>{segment.supported ? 'Supported' : segment.reason === 'frame' ? `Frame ${segment.frame}` : 'Unsupported type'}</Cell>
				</Row>
			))}
		</Table>
	)
}
