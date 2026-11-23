import type { SpiceKernelLibrarySnapshot } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize } from '../format'
import { navigate, routeState } from '../shell/route'
import { EmptyState } from '../shell/WorkspaceLayout'
import { epochDate, epochOf, READINESS } from '../tools/spicekernels/format'
import { activeJobs, refreshSpiceKernels, setEphemerisOffline, spiceKernelsState } from '../tools/spicekernels/spicekernels'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { SectionHeading } from '../ui/SectionHeading'
import { ephemerisCoverage } from './ephemeris'

// Ephemeris Sources section of the Settings page: whether the server may work without JPL. Network holds the offline
// switch of the server's ephemeris chain, which applies to the whole server and every profile at once (the status bar
// says while it is on); Source Order shows the order each kind of computation tries its sources in, as the switch leaves
// it; Kernels shows what the SPICE kernels cover now and which enabled ones are not ready. The kernels themselves are
// managed in the SPICE Kernel Library.

// Change of the offline switch sent by this tab, held until the server publishes a newer snapshot.
interface RequestedSwitch {
	// Value asked for.
	readonly offline: boolean
	// Server process and revision of the snapshot the change was asked from.
	readonly epoch: string
	readonly revision: number
}

// Content of the Ephemeris Sources section.
export function EphemerisSettings() {
	const state = useSnapshot(spiceKernelsState)
	const snapshot = state.snapshot

	if (!snapshot) {
		return state.loadFailed ? (
			<EmptyState
				title="Ephemeris sources not read"
				description="The server is unreachable. They are read again when the connection returns."
				action={
					<Button variant="secondary" onClick={() => void refreshSpiceKernels(spiceKernelsState)}>
						Try Again
					</Button>
				}
			/>
		) : (
			<EmptyState title="Reading the ephemeris sources…" />
		)
	}

	return <EphemerisSources snapshot={snapshot} error={state.errors.settings} />
}

interface EphemerisSourcesProps {
	// Latest snapshot of the library.
	readonly snapshot: SpiceKernelLibrarySnapshot
	// Why the last change of the switch from this tab failed; absent when it did not.
	readonly error?: string
}

// The three groups of the section, read from a snapshot of the library.
function EphemerisSources({ snapshot, error }: EphemerisSourcesProps) {
	const [requested, setRequested] = useState<RequestedSwitch>()
	const saving = requested !== undefined && requested.epoch === snapshot.epoch && requested.revision === snapshot.revision
	const offline = saving ? requested.offline : snapshot.offline
	const coverage = ephemerisCoverage(snapshot.kernels, epochOf(Date.now()))
	const jobs = activeJobs(snapshot).length

	async function change(value: boolean) {
		setRequested({ offline: value, epoch: snapshot.epoch, revision: snapshot.revision })
		if (!(await setEphemerisOffline(spiceKernelsState, value))) setRequested(undefined)
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
			<section className="flex max-w-md flex-col gap-3">
				<SectionHeading as="h2">Network</SectionHeading>
				<div className="flex items-center justify-between gap-3">
					<Checkbox label="Ephemeris offline" title="Never send an automatic request to JPL" checked={offline} disabled={saving} onChange={(value) => void change(value)} />
					{saving && <span className="text-xs text-ink-300">Saving…</span>}
				</div>
				{error && <Notice error>{error}</Notice>}
				<Notice>Applies to the whole server and every profile. While offline, nothing asks JPL on its own: an asteroid or comet no kernel covers, an orbit lookup, or a close approach is answered only if it was read before. Downloading or generating a kernel still uses the network.</Notice>
			</section>
			<section className="flex max-w-md flex-col gap-3">
				<SectionHeading as="h2">Source Order</SectionHeading>
				<DataList>
					<DataRow label="Map, planners, events">{offline ? 'Kernels → Theories' : 'Kernels → Theories → Horizons'}</DataRow>
					<DataRow label="Selected object, slews">{offline ? 'Kernels → Theories' : 'Kernels → Horizons → Theories'}</DataRow>
				</DataList>
				<Notice>Each position comes whole from the first source that covers it. Theories are the analytical models built into Nebulosa; Horizons is the online ephemeris service of JPL.</Notice>
			</section>
			<section className="flex max-w-md flex-col gap-3">
				<SectionHeading as="h2">Kernels</SectionHeading>
				{snapshot.loading && <Notice>Opening the kernels of the previous run…</Notice>}
				<DataList>
					<DataRow label="Sun, Moon, and planets">{coverage.majorBodiesUntil === undefined ? 'Not covered' : `Until ${epochDate(coverage.majorBodiesUntil)}`}</DataRow>
					<DataRow label="Moons covered">{coverage.moons || 'None'}</DataRow>
					<DataRow label="Asteroids and comets covered">{coverage.smallBodies || 'None'}</DataRow>
					<DataRow label="Kernels">
						{coverage.enabled} enabled of {snapshot.kernels.length} · {formatByteSize(snapshot.bytes)}
					</DataRow>
					{coverage.notReady.map((kernel) => {
						const { label, tone } = READINESS[kernel.readiness]
						return (
							<DataRow key={kernel.id} label={kernel.name} tone={tone === 'danger' || tone === 'warning' ? tone : 'default'}>
								{label}
							</DataRow>
						)
					})}
					{jobs > 0 && <DataRow label="Downloads and generations">{jobs} in progress</DataRow>}
				</DataList>
				<Button variant="secondary" className="self-start" onClick={() => navigate(routeState, { workspace: 'tools', tool: 'spice-kernel-library' })}>
					Open SPICE Kernel Library
				</Button>
			</section>
		</div>
	)
}
