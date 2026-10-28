import type { SkyObjectRef } from 'api'
import { AU_KM } from 'nebulosa/src/core/constants'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import type { SkyObserverSettings } from '../../profile/schema'
import { PanelSection } from '../../shell/ContextualPanel'
import { formatAngularSize, formatMagnitude } from '../format'
import { Datum, Note, ObserverSection, PositionSection } from '../InspectorParts'
import { ObjectActions } from '../ObjectActions'
import type { SkySelection } from '../sky'
import { moonState, refreshMoonAlmanac, refreshMoonEclipse } from './moon'
import { MoonApsidesSection } from './MoonApsidesSection'
import { MoonEclipseSection } from './MoonEclipseSection'
import { MoonImage } from './MoonImage'
import { MoonPhasesSection } from './MoonPhasesSection'
import { MoonPhysicalSection } from './MoonPhysicalSection'

// Moon Inspector, the Object Inspector of the Moon: a drawing of the Moon as it looks at the instant the Sky shows
// right under its name, its position with the apparent angular diameter, its altitude, azimuth, rise, transit, and
// set for the observer, the next principal phases, the next perigee and apogee, the next lunar eclipse, and its
// physical data (age, libration, colongitude, orientation). Everything follows the instant the Sky shows: the almanac
// is asked for each new instant of the selection, the eclipse only when its answer stops holding.

export interface MoonInspectorProps {
	// Selection of the Moon.
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

// Identity of the Moon.
const MOON: SkyObjectRef = { kind: 'body', code: '301' }

// IAU mean radius of the Moon in AU (1737.4 km).
const MOON_RADIUS_AU = 1737.4 / AU_KM

// Apparent angular diameter of the Moon in radians, at a distance in AU from the same center as the position.
export function moonAngularDiameter(distance: number) {
	return 2 * Math.asin(MOON_RADIUS_AU / distance)
}

// Moon Inspector.
export function MoonInspector({ selection, observer, onSetObserver, timeZone, onShowFraming }: MoonInspectorProps) {
	const { almanac } = useSnapshot(moonState)
	const { position, events } = selection
	const time = position?.time ?? selection.requestedTime
	const latitude = observer?.latitude
	const longitude = observer?.longitude
	const elevation = observer?.elevation
	const place = latitude === undefined || longitude === undefined || elevation === undefined ? undefined : { latitude, longitude, elevation }

	// Asks for the almanac and the eclipse of the instant shown; the eclipse asks the API only when its answer stops holding.
	useEffect(() => {
		if (time === undefined) return
		void refreshMoonAlmanac(moonState, time, place)
		void refreshMoonEclipse(moonState, time, place)
	}, [time, latitude, longitude, elevation])

	return (
		<>
			<PanelSection title="Object">
				<p className="m-0 text-base leading-6 font-semibold text-ink-100">{selection.name}</p>
				<p className="m-0 text-ink-300">Natural Satellite</p>
				{position?.magnitude !== undefined && <Datum label="Magnitude">{formatMagnitude(position.magnitude)}</Datum>}
				<MoonImage time={time} observer={place} />
				<ObjectActions target={MOON} targetName={selection.name} observer={observer} onShowFraming={onShowFraming} />
			</PanelSection>
			<PositionSection selection={selection} timeZone={timeZone}>
				{position?.distance !== undefined && <Datum label="Angular diameter">{formatAngularSize(moonAngularDiameter(position.distance))}</Datum>}
			</PositionSection>
			{position && <ObserverSection position={position} events={events} hasObserver={!!observer} onSetObserver={onSetObserver} isSolarSystem timeZone={timeZone} />}
			<MoonPhasesSection phases={almanac.value?.phases} timeZone={timeZone} />
			<MoonApsidesSection apsides={almanac.value?.apsides} timeZone={timeZone} />
			<MoonEclipseSection hasObserver={!!observer} timeZone={timeZone} />
			<MoonPhysicalSection appearance={almanac.value?.appearance} time={almanac.value?.time} timeZone={timeZone} />
			{almanac.error && (
				<div className="px-4 py-3">
					<Note danger>Almanac unavailable: {almanac.error}</Note>
				</div>
			)}
		</>
	)
}
