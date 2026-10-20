import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import type { SkyObserverSettings } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { skyClock } from './clock'
import { formatDeclination, formatDegrees, formatRightAscension } from './format'
import { horizontalOf, mountPoint, mountRuntime } from './mount'
import type { MountRef } from './objects'

// Object Inspector view of the mount marker: the mount's reported pointing (of date) and, for the
// observer, where that is on the sky, with its motion state. It shows only what the mount reports: a
// disconnected mount, another mount, or a simulated instant has no position here.

export interface MountInspectorProps {
	// Identity of the selected mount.
	readonly mountRef: MountRef
	// Observer of the active profile, for altitude and azimuth.
	readonly observer?: SkyObserverSettings
	// Opens the framing settings, which draw the field of view around the selection.
	readonly onShowFraming: () => void
}

// Label and value of one datum.
function Datum({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-ink-300">{label}</span>
			<span className="min-w-0 text-right font-mono text-[13px] text-ink-100">{children}</span>
		</div>
	)
}

// Motion state of a mount, as one line.
function motionOf(state: { readonly slewing: boolean; readonly parked: boolean; readonly parking: boolean; readonly tracking: boolean }) {
	if (state.slewing) return 'Slewing'
	if (state.parking) return 'Parking'
	if (state.parked) return 'Parked'
	return state.tracking ? 'Tracking' : 'Stopped'
}

// Mount view of the Object Inspector.
export function MountInspector({ mountRef, observer, onShowFraming }: MountInspectorProps) {
	const runtime = useSnapshot(mountRuntime)
	const clock = useSnapshot(skyClock)
	const same = runtime.target?.connectionId === mountRef.connectionId && runtime.target.id === mountRef.id
	const state = same ? runtime.state : undefined
	const point = same ? mountPoint(runtime, clock.mode === 'now') : undefined
	const horizontal = point && observer && horizontalOf(point, Date.now(), observer)

	return (
		<>
			<PanelSection title="Object">
				<p className="m-0 text-base leading-6 font-semibold text-ink-100">{same ? runtime.target?.name || 'Mount' : 'Mount'}</p>
				<p className="m-0 text-ink-300">Mount position</p>
				<div>
					<Button variant="secondary" onClick={onShowFraming}>
						Show Framing
					</Button>
				</div>
			</PanelSection>
			<PanelSection title="Position">
				{point && state ? (
					<>
						<Datum label="State">{motionOf(state)}</Datum>
						<Datum label="RA (of date)">{formatRightAscension(point.rightAscension)}</Datum>
						<Datum label="Dec (of date)">{formatDeclination(point.declination)}</Datum>
						{horizontal && (
							<>
								<Datum label="Altitude">{formatDeclination(horizontal.altitude)}</Datum>
								<Datum label="Azimuth">{formatDegrees(horizontal.azimuth)}</Datum>
							</>
						)}
						<p className="m-0 text-xs leading-4 text-ink-300">As reported by the mount now{horizontal ? '; altitude is geometric, for the profile observer' : ''}.</p>
					</>
				) : (
					<p className="m-0 text-ink-300">{!same ? 'This mount is no longer the profile’s mount.' : clock.mode !== 'now' ? 'The mount position is shown in real time only.' : 'The mount is disconnected; its position is unknown.'}</p>
				)}
			</PanelSection>
		</>
	)
}
