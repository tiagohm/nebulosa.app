import { useSnapshot } from 'valtio'
import { controlRuntime } from '../equipment-control/control'
import { formatDegrees } from '../format'
import type { GeographicLocation } from '../location/site'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Button } from '../ui/Button'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { ObjectTitle } from '../ui/ObjectTitle'
import { skyClock } from './clock'
import { formatDeclination, formatRightAscension } from './format'
import { horizontalOf, mountPoint, mountRuntime, mountView } from './mount'
import type { MountRef } from './objects'

// Object Inspector view of the mount marker: the mount's reported pointing (of date) and, for the
// observer, where that is on the sky, with its motion state. It shows only what the mount reports: a
// disconnected mount, another mount, or a simulated instant has no position here.

export interface MountInspectorProps {
	// Identity of the selected mount.
	readonly mountRef: MountRef
	// Observer of the active profile, for altitude and azimuth.
	readonly observer?: GeographicLocation
	// Opens the framing settings, which draw the field of view around the selection.
	readonly onShowFraming: () => void
}

// Motion state of a mount, as one line.
function motionOf(state: { readonly slewing: boolean; readonly parked: boolean; readonly parking: boolean; readonly tracking: boolean }) {
	if (state.parking) return 'Parking'
	if (state.slewing) return 'Slewing'
	if (state.parked) return 'Parked'
	return state.tracking ? 'Tracking' : 'Stopped'
}

// Mount view of the Object Inspector.
export function MountInspector({ mountRef, observer, onShowFraming }: MountInspectorProps) {
	const runtime = mountView(useSnapshot(mountRuntime), useSnapshot(controlRuntime))
	const clock = useSnapshot(skyClock)
	const same = runtime.target?.connectionId === mountRef.connectionId && runtime.target.id === mountRef.id
	const state = same ? runtime.state : undefined
	const point = same ? mountPoint(runtime, clock.mode === 'now') : undefined
	const horizontal = point && observer && horizontalOf(point, Date.now(), observer)

	return (
		<>
			<CollapsibleSection id="sky.object" title="Object" summary={same ? runtime.target?.name || 'Mount' : 'Mount'}>
				<ObjectTitle name={same ? runtime.target?.name || 'Mount' : 'Mount'} kind="Mount position" />
				<div>
					<Button variant="secondary" onClick={onShowFraming}>
						Show Framing
					</Button>
				</div>
			</CollapsibleSection>
			<CollapsibleSection id="sky.position" title="Position" summary={state ? motionOf(state) : undefined}>
				{point && state ? (
					<>
						<DataRow label="State">{motionOf(state)}</DataRow>
						<DataRow label="RA (of date)">{formatRightAscension(point.rightAscension)}</DataRow>
						<DataRow label="Dec (of date)">{formatDeclination(point.declination)}</DataRow>
						{horizontal && (
							<>
								<DataRow label="Altitude">{formatDeclination(horizontal.altitude)}</DataRow>
								<DataRow label="Azimuth">{formatDegrees(horizontal.azimuth)}</DataRow>
							</>
						)}
						<Notice>As reported by the mount now{horizontal ? '; altitude is geometric, for the observing site of the profile' : ''}.</Notice>
					</>
				) : (
					<Notice>{!same ? 'This mount is no longer the profile’s mount.' : clock.mode !== 'now' ? 'The mount position is shown in real time only.' : 'The mount is disconnected; its position is unknown.'}</Notice>
				)}
			</CollapsibleSection>
		</>
	)
}
