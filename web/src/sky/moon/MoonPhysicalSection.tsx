import type { MoonAppearance } from 'api'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { DataRow } from '../../ui/DataRow'
import { formatAngularSize, formatDegrees, formatLocalTime } from '../format'
import { Note } from '../InspectorParts'
import { formatKilometers } from './MoonApsidesSection'

// Lunar Physical Data section of the Moon Inspector: the Moon's age and lunation, distance, libration, the Sun's
// colongitude, the orientation of its pole and bright limb, and its parallax at the instant the almanac was computed
// for, from the observer or the Earth's center like the drawing.

// Formats a signed selenographic angle in radians with the hemisphere it points to: "3.21° E".
export function formatSelenographic(angle: number, positive: string, negative: string) {
	return `${formatDegrees(Math.abs(angle))} ${angle >= 0 ? positive : negative}`
}

// Lunar Physical Data section of the Moon Inspector; `time` is the instant of the data, Unix milliseconds.
export function MoonPhysicalSection({ appearance, time, timeZone }: { readonly appearance?: MoonAppearance; readonly time?: number; readonly timeZone?: string }) {
	return (
		<CollapsibleSection id="sky.physical" title="Lunar Physical Data" summary={appearance && `Age ${appearance.ageDays.toFixed(1)} d · Lunation ${appearance.lunation}`} defaultOpen={false}>
			{appearance && time !== undefined ? (
				<>
					<DataRow label="Age">{appearance.ageDays.toFixed(2)} d</DataRow>
					<DataRow label="Lunation">{appearance.lunation}</DataRow>
					<DataRow label="Distance">{formatKilometers(appearance.distanceKm)}</DataRow>
					<DataRow label="Apparent diameter">{formatAngularSize(appearance.angularDiameter)}</DataRow>
					<DataRow label="Libration in longitude">{formatSelenographic(appearance.subObserver.longitude, 'E', 'W')}</DataRow>
					<DataRow label="Libration in latitude">{formatSelenographic(appearance.subObserver.latitude, 'N', 'S')}</DataRow>
					<DataRow label="Sun's colongitude">{formatDegrees(appearance.colongitude)}</DataRow>
					<DataRow label="Sub-solar latitude">{formatSelenographic(appearance.subSolar.latitude, 'N', 'S')}</DataRow>
					<DataRow label="Pole position angle">{formatDegrees(appearance.poleAngle)}</DataRow>
					<DataRow label="Bright limb angle">{formatDegrees(appearance.brightLimbAngle)}</DataRow>
					<DataRow label="Horizontal parallax">{formatAngularSize(appearance.horizontalParallax)}</DataRow>
					{appearance.parallacticAngle !== undefined && <DataRow label="Parallactic angle">{formatDegrees(appearance.parallacticAngle)}</DataRow>}
					<Note>
						At {formatLocalTime(time, Date.now(), undefined, timeZone)}, {appearance.center === 'topocentric' ? 'from the observer' : "from the Earth's center"}, from the local model. The libration is the selenographic point at the disk&apos;s center; position angles are from celestial north through east.
						The age counts from the previous geocentric new Moon.
					</Note>
				</>
			) : (
				<p className="m-0 text-ink-300">Computing…</p>
			)}
		</CollapsibleSection>
	)
}
