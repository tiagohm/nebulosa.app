import type { MoonAppearance } from 'api'
import { CollapsibleSection } from '../CollapsibleSection'
import { formatAngularSize, formatDegrees, formatLocalTime } from '../format'
import { Datum, Note } from '../InspectorParts'
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
		<CollapsibleSection id="physical" title="Lunar Physical Data" summary={appearance && `Age ${appearance.ageDays.toFixed(1)} d · Lunation ${appearance.lunation}`}>
			{appearance && time !== undefined ? (
				<>
					<Datum label="Age">{appearance.ageDays.toFixed(2)} d</Datum>
					<Datum label="Lunation">{appearance.lunation}</Datum>
					<Datum label="Distance">{formatKilometers(appearance.distanceKm)}</Datum>
					<Datum label="Apparent diameter">{formatAngularSize(appearance.angularDiameter)}</Datum>
					<Datum label="Libration in longitude">{formatSelenographic(appearance.subObserver.longitude, 'E', 'W')}</Datum>
					<Datum label="Libration in latitude">{formatSelenographic(appearance.subObserver.latitude, 'N', 'S')}</Datum>
					<Datum label="Sun's colongitude">{formatDegrees(appearance.colongitude)}</Datum>
					<Datum label="Sub-solar latitude">{formatSelenographic(appearance.subSolar.latitude, 'N', 'S')}</Datum>
					<Datum label="Pole position angle">{formatDegrees(appearance.poleAngle)}</Datum>
					<Datum label="Bright limb angle">{formatDegrees(appearance.brightLimbAngle)}</Datum>
					<Datum label="Horizontal parallax">{formatAngularSize(appearance.horizontalParallax)}</Datum>
					{appearance.parallacticAngle !== undefined && <Datum label="Parallactic angle">{formatDegrees(appearance.parallacticAngle)}</Datum>}
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
