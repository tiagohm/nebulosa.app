import { useSnapshot } from 'valtio'
import { formatByteSize } from '../format'
import { navigate, routeState } from '../shell/route'
import { setEphemerisOffline, spiceKernelsState } from '../tools/spicekernels/spicekernels'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { SectionHeading } from '../ui/SectionHeading'

// Ephemeris Sources section of the Settings page: where positions come from, and the offline switch of the server's
// ephemeris chain, which applies to the whole server and every profile. A change applies at once; the status bar says
// while the switch is on. The kernels themselves are managed in the SPICE Kernel Library.

// Content of the Ephemeris Sources section.
export function EphemerisSettings() {
	const state = useSnapshot(spiceKernelsState)
	const snapshot = state.snapshot

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
			<section className="flex max-w-xl flex-col gap-3">
				<SectionHeading as="h2">Ephemeris Sources</SectionHeading>
				<Notice>Positions come from the SPICE kernels when they cover the object, the Earth, and the Sun. Otherwise the map, the planners, and the events use the analytical theories, then JPL Horizons; the selected object and mount targets use JPL Horizons, then the analytical theories.</Notice>
				{snapshot ? (
					<>
						<Checkbox label="Offline" checked={snapshot.offline} disabled={state.pending.settings} onChange={(offline) => void setEphemerisOffline(spiceKernelsState, offline)} />
						<Notice>While offline, no position, event, plan, orbit lookup, or close approach asks JPL (Horizons, SBDB, or CAD): only what was already read is answered, and an object only the network can give is reported as unavailable. Downloading or generating a kernel still uses the network.</Notice>
						{state.errors.settings && <Notice error>{state.errors.settings}</Notice>}
						<DataRow label="Kernels">
							{snapshot.kernels.length} · {formatByteSize(snapshot.bytes)}
						</DataRow>
					</>
				) : (
					<Notice>Reading the ephemeris sources of the server.</Notice>
				)}
				<Button variant="secondary" className="self-start" onClick={() => navigate(routeState, { workspace: 'tools', tool: 'spice-kernel-library' })}>
					Open SPICE Kernel Library
				</Button>
			</section>
		</div>
	)
}
