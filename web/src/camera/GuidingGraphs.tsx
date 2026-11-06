import type { GuidingEventRecord, GuidingSessionSummary, GuidingTelemetrySample } from 'api'
import { useSnapshot } from 'valtio'
import { activeProfile, guidingGraphView, profileState, setGuidingGraphView } from '../profile/profile'
import { GUIDING_TARGET_POINTS, type GuidingGraphView } from '../profile/schema'
import { SegmentedControl } from '../ui/SegmentedControl'
import { GuidingGraph } from './GuidingGraph'
import { GuidingTargetGraph } from './GuidingTargetGraph'

// Guiding graphs of a session under the viewer: the history of the errors along the steps, or the target of the errors
// around the lock, with the number of steps the target draws. Which one and how many are view state of the profile.

// Labels of the graphs.
const MODE_LABELS: Readonly<Record<GuidingGraphView['mode'], string>> = { history: 'History', target: 'Target' }

export interface GuidingGraphsProps {
	// Summary of the session.
	readonly session: GuidingSessionSummary
	// Telemetry samples of the session known, in cursor order.
	readonly telemetry?: readonly GuidingTelemetrySample[]
	// Control events of the session known, in sequence order.
	readonly events?: readonly GuidingEventRecord[]
}

// The graph of a session the profile chose, with the choice.
export function GuidingGraphs({ session, telemetry, events }: GuidingGraphsProps) {
	const profiles = useSnapshot(profileState)
	const view = guidingGraphView(activeProfile(profiles).settings)
	const points = GUIDING_TARGET_POINTS.map(String)

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-end gap-2">
				<SegmentedControl options={['history', 'target'] as const} value={view.mode} format={(mode) => MODE_LABELS[mode]} onChange={(mode) => setGuidingGraphView(profileState, { mode })} />
				{view.mode === 'target' && <SegmentedControl options={points} value={String(view.points)} format={(count) => `${count} steps`} onChange={(count) => setGuidingGraphView(profileState, { points: Number(count) })} />}
			</div>
			{view.mode === 'target' ? <GuidingTargetGraph session={session} telemetry={telemetry} points={view.points} /> : <GuidingGraph session={session} telemetry={telemetry} events={events} />}
		</div>
	)
}
