import type { SkyObjectRef, SkyPosition, SunLocalDay } from 'api'
import { SUN_RADIUS_AU } from 'nebulosa/src/core/constants'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import type { SkyObserverSettings } from '../../profile/schema'
import { PanelSection } from '../../shell/ContextualPanel'
import { formatDuration } from '../../tools/eclipse/eclipse'
import { Button } from '../../ui/Button'
import { BROWSER_TIME_ZONE } from '../clock'
import { CollapsibleSection } from '../CollapsibleSection'
import { formatAngularSize, formatDeclination, formatDegrees, formatLocalTime, formatMagnitude } from '../format'
import { Datum, Note, PositionSection } from '../InspectorParts'
import { ObjectActions } from '../ObjectActions'
import type { SkySelection } from '../sky'
import { ActiveRegionsSection } from './ActiveRegionsSection'
import { SeasonsSection } from './SeasonsSection'
import { SolarImage } from './SolarImage'
import { SolarPhysicalSection } from './SolarPhysicalSection'
import { loadActiveRegions, loadSunImage, refreshSunAlmanac, refreshSunEclipse, SUN_OBSERVATION_REFRESH_MS, sunState } from './sun'
import { SunEclipseSection } from './SunEclipseSection'
import { TwilightSection } from './TwilightSection'

// Sun Inspector, the Object Inspector of the Sun: the latest SDO image right under its name, the NOAA active regions,
// its position with the apparent angular diameter, its day for the observer (sunrise, transit, sunset, daylight) and
// twilight, the next solar eclipse, the next seasons, and the equation of time and Carrington rotation. Three times are
// kept apart: the position and the almanac follow the instant the Sky shows, the day is the observer's civil date of
// that instant in its time zone, and the image and the regions are the latest real observations, dated by their
// sources. The almanac and the eclipse are asked again only when their answers stop holding, never on every tick; the
// image and the report every 15 minutes while shown. No lunar data belongs here.

export interface SunInspectorProps {
	// Selection of the Sun.
	readonly selection: SkySelection
	// Observer of the active profile; absent when none is set.
	readonly observer?: SkyObserverSettings
	// Opens the observer settings.
	readonly onSetObserver: () => void
	// IANA time zone times are shown in; the browser's when absent.
	readonly timeZone?: string
	// Opens the framing settings.
	readonly onShowFraming: () => void
}

// Identity of the Sun.
const SUN: SkyObjectRef = { kind: 'body', code: '10' }

// Apparent angular diameter of the Sun in radians, at a distance in AU from the same center as the position.
export function sunAngularDiameter(distance: number) {
	return 2 * Math.asin(SUN_RADIUS_AU / distance)
}

// Says how the Sun's day went when it has no sunrise or sunset.
function daylightState(day: SunLocalDay) {
	if (day.daylight === 'continuousAbove') return 'The Sun stays above the horizon all day'
	if (day.daylight === 'continuousBelow') return 'The Sun stays below the horizon all day'
	return undefined
}

// Altitude, azimuth, and the observer's day; without an observer, an invitation to set one.
function VisibilitySection({ position, day, hasObserver, onSetObserver, timeZone }: { readonly position?: SkyPosition; readonly day?: SunLocalDay; readonly hasObserver: boolean; readonly onSetObserver: () => void; readonly timeZone?: string }) {
	const summary = day?.daylightSeconds !== undefined ? `Daylight ${formatDuration(day.daylightSeconds)}` : day && daylightState(day)

	return (
		<CollapsibleSection id="visibility" title="Visibility" summary={summary}>
			{!hasObserver ? (
				<>
					<p className="m-0 text-ink-300">Altitude, azimuth, sunrise, and sunset need the observer&apos;s location.</p>
					<div>
						<Button variant="secondary" onClick={onSetObserver}>
							Set Location
						</Button>
					</div>
				</>
			) : (
				<>
					{position?.altitude !== undefined && <Datum label="Altitude">{formatDeclination(position.altitude)}</Datum>}
					{position?.azimuth !== undefined && <Datum label="Azimuth">{formatDegrees(position.azimuth)}</Datum>}
					{day ? (
						<>
							{daylightState(day) && <Datum label="Day">{daylightState(day)}</Datum>}
							{(day.sunrise !== undefined || day.daylight === 'partial') && <Datum label="Sunrise">{day.sunrise !== undefined ? formatLocalTime(day.sunrise, day.start, undefined, timeZone) : 'None this day'}</Datum>}
							{day.transit !== undefined && (
								<Datum label="Transit">
									{formatLocalTime(day.transit, day.start, undefined, timeZone)}
									{day.transitAltitude !== undefined && ` · ${formatDeclination(day.transitAltitude)}`}
								</Datum>
							)}
							{(day.sunset !== undefined || day.daylight === 'partial') && <Datum label="Sunset">{day.sunset !== undefined ? formatLocalTime(day.sunset, day.start, undefined, timeZone) : 'None this day'}</Datum>}
							{day.daylightSeconds !== undefined && <Datum label="Daylight">{formatDuration(day.daylightSeconds)}</Datum>}
							<Note>Refracted altitude at the instant. Sunrise, transit, and sunset of {day.localDate}: the upper limb at the horizon with standard refraction (the center at −50′, geometric), from the local model.</Note>
						</>
					) : (
						<p className="m-0 text-ink-300">Computing the day…</p>
					)}
				</>
			)}
		</CollapsibleSection>
	)
}

// Sun Inspector.
export function SunInspector({ selection, observer, onSetObserver, timeZone, onShowFraming }: SunInspectorProps) {
	const { almanac } = useSnapshot(sunState)
	const { position } = selection
	const time = position?.time ?? selection.requestedTime
	const zone = timeZone || BROWSER_TIME_ZONE
	const latitude = observer?.latitude
	const longitude = observer?.longitude
	const elevation = observer?.elevation
	const day = observer ? almanac.value?.localDay : undefined

	// Asks for the almanac and the eclipse of the instant shown; each asks the API only when its answer stops holding.
	useEffect(() => {
		if (time === undefined) return
		const place = latitude === undefined || longitude === undefined || elevation === undefined ? undefined : { latitude, longitude, elevation }
		void refreshSunAlmanac(sunState, time, place, zone)
		void refreshSunEclipse(sunState, time, place)
	}, [time, latitude, longitude, elevation, zone])

	// Downloads the latest image and active region report now and every 15 minutes while shown.
	useEffect(() => {
		function load() {
			void loadSunImage(sunState, 'image', sunState.channel)
			void loadActiveRegions(sunState)
		}

		load()
		const timer = setInterval(load, SUN_OBSERVATION_REFRESH_MS)
		return () => clearInterval(timer)
	}, [])

	return (
		<>
			<PanelSection title="Object">
				<p className="m-0 text-base leading-6 font-semibold text-ink-100">{selection.name}</p>
				<p className="m-0 text-ink-300">Star</p>
				{position?.magnitude !== undefined && <Datum label="Magnitude">{formatMagnitude(position.magnitude)}</Datum>}
				<SolarImage />
				<ObjectActions target={SUN} targetName={selection.name} observer={observer} onShowFraming={onShowFraming} />
			</PanelSection>
			<ActiveRegionsSection />
			<PositionSection selection={selection} timeZone={timeZone}>
				{position?.distance !== undefined && <Datum label="Angular diameter">{formatAngularSize(sunAngularDiameter(position.distance))}</Datum>}
			</PositionSection>
			<VisibilitySection position={position} day={day} hasObserver={!!observer} onSetObserver={onSetObserver} timeZone={timeZone} />
			<TwilightSection day={day} hasObserver={!!observer} timeZone={timeZone} />
			<SunEclipseSection hasObserver={!!observer} timeZone={timeZone} />
			<SeasonsSection seasons={almanac.value?.seasons} latitude={latitude} timeZone={timeZone} />
			<SolarPhysicalSection physical={almanac.value?.physical} time={almanac.value?.time} timeZone={timeZone} />
			{almanac.error && (
				<div className="px-4 py-3">
					<Note danger>Almanac unavailable: {almanac.error}</Note>
				</div>
			)}
		</>
	)
}
