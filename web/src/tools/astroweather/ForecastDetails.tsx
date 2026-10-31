import type { AstronomicalSample, AstroWeatherForecast, AstroWeatherNight, MeteorologySample, SolarTwilightCrossings } from 'api'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { formatEclipseTime } from '../eclipse/eclipse'
import { Datum, Note } from '../eclipse/EclipsePanelParts'
import { formatClock, formatLength, SEEING_BANDS, TRANSPARENCY_BANDS } from './astroweather'
import { PROVIDER_NAMES } from './ForecastSummary'
import type { OutlookSegment } from './observing'

// Details of the contextual panel: the sky and the weather of the hour chosen, the astronomy of the night, and where
// everything comes from. Each value the forecast lacks is left out, and what a value means is said where it could be
// misread: a class is a band, a chance is not an occurrence, and an air temperature is not the temperature of a surface.

// Compass points of a wind direction, clockwise from north.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

// Returns the compass point a wind comes from.
function compassPoint(degrees: number) {
	return COMPASS[Math.round(degrees / 45) % COMPASS.length]
}

// One value of the forecast, left out when unknown.
function Value({ label, value, unit = '' }: { readonly label: string; readonly value: number | string | undefined; readonly unit?: string }) {
	return value === undefined ? undefined : (
		<Datum label={label}>
			{value}
			{unit}
		</Datum>
	)
}

export interface SkyConditionsProps {
	// Sample of the hour chosen.
	readonly sample?: MeteorologySample
	// Hour chosen.
	readonly hour?: OutlookSegment
}

// Sky of the hour chosen: cloud layers and the classes of the nearest 7Timer! sample.
export function SkyConditions({ sample, hour }: SkyConditionsProps) {
	const { seeing, transparency } = hour ?? {}

	return (
		<CollapsibleSection id="astroWeather.sky" title="Sky Conditions">
			<Value label="Total cloud" value={sample?.cloudCover} unit="%" />
			<Value label="Low cloud" value={sample?.cloudCoverLow} unit="%" />
			<Value label="Middle cloud" value={sample?.cloudCoverMid} unit="%" />
			<Value label="High cloud" value={sample?.cloudCoverHigh} unit="%" />
			<Value label="Seeing" value={seeing && `class ${seeing}`} />
			{seeing && <Note>{SEEING_BANDS[seeing - 1]}, the band of this class, not a measurement.</Note>}
			<Value label="Transparency" value={transparency && `class ${transparency}`} />
			{transparency && <Note>{TRANSPARENCY_BANDS[transparency - 1]} mag per airmass, the band of this class, not a measurement.</Note>}
			{(seeing || transparency) && <Note>Nearest 3 hour forecast sample, not interpolated.</Note>}
			{!sample && !seeing && !transparency && <Note>No forecast for this hour.</Note>}
		</CollapsibleSection>
	)
}

export interface WeatherConditionsProps {
	// Sample of the hour chosen.
	readonly sample?: MeteorologySample
	// Sample ending the hour, which holds its precipitation and gusts.
	readonly ending?: MeteorologySample
}

// Weather of the hour chosen.
export function WeatherConditions({ sample, ending }: WeatherConditionsProps) {
	const margin = sample?.temperature !== undefined && sample.dewPoint !== undefined ? (sample.temperature - sample.dewPoint).toFixed(1) : undefined

	return (
		<CollapsibleSection id="astroWeather.weather" title="Weather Conditions">
			<Value label="Rain chance" value={ending?.precipitationProbability} unit="%" />
			<Value label="Precipitation" value={ending?.precipitation} unit=" mm" />
			<Value label="Temperature" value={sample?.temperature} unit=" °C" />
			<Value label="Humidity" value={sample?.relativeHumidity} unit="%" />
			<Value label="Dew point" value={sample?.dewPoint} unit=" °C" />
			<Value label="Dew margin" value={margin} unit=" °C" />
			<Value label="Wind" value={sample?.windSpeed} unit=" km/h" />
			<Value label="Direction" value={sample?.windDirection === undefined ? undefined : `${compassPoint(sample.windDirection)} (${sample.windDirection}°)`} />
			<Value label="Gusts" value={ending?.windGust} unit=" km/h" />
			{!sample && !ending && <Note>No forecast for this hour.</Note>}
			<Note>A chance is not an occurrence, and surfaces cool below the air temperature, so dew can form above the dew point shown.</Note>
		</CollapsibleSection>
	)
}

// Text of a crossing, or of why there is none.
function crossingText(time: number | undefined, { state }: Pick<SolarTwilightCrossings, 'state'>, timeZone: string) {
	if (time !== undefined) return formatClock(time, timeZone)
	return state === 'continuousAbove' ? 'Sun stays above' : state === 'continuousBelow' ? 'Sun stays below' : 'Not this night'
}

export interface AstronomicalConditionsProps {
	// Night shown.
	readonly night: AstroWeatherNight
	// IANA time zone of the times.
	readonly timeZone: string
}

// Sun and Moon over the night, computed locally.
export function AstronomicalConditions({ night, timeZone }: AstronomicalConditionsProps) {
	const { sun, moon } = night

	return (
		<CollapsibleSection id="astroWeather.astronomy" title="Astronomical Conditions">
			<Datum label="Sunset">{crossingText(sun.sunset, { state: sun.daylight }, timeZone)}</Datum>
			<Datum label="Civil dusk">{crossingText(sun.civil.dusk, sun.civil, timeZone)}</Datum>
			<Datum label="Nautical dusk">{crossingText(sun.nautical.dusk, sun.nautical, timeZone)}</Datum>
			<Datum label="Astronomical dusk">{crossingText(sun.astronomical.dusk, sun.astronomical, timeZone)}</Datum>
			<Datum label="Astronomical dawn">{crossingText(sun.astronomical.dawn, sun.astronomical, timeZone)}</Datum>
			<Datum label="Nautical dawn">{crossingText(sun.nautical.dawn, sun.nautical, timeZone)}</Datum>
			<Datum label="Civil dawn">{crossingText(sun.civil.dawn, sun.civil, timeZone)}</Datum>
			<Datum label="Sunrise">{crossingText(sun.sunrise, { state: sun.daylight }, timeZone)}</Datum>
			{sun.darkness.map((span) => (
				<Datum key={span.start} label="Darkness">
					{formatLength(span)}
				</Datum>
			))}
			{sun.darkness.length === 0 && <Note>The Sun does not reach −18° this night, so there is no astronomical darkness.</Note>}
			<Datum label="Moon lit">{(moon.illuminatedFraction * 100).toFixed(0)}%</Datum>
			{moon.above.map((span) => (
				<Datum key={span.start} label="Moon up">
					{formatClock(span.start, timeZone)}–{formatClock(span.end, timeZone)}
				</Datum>
			))}
			{moon.above.length === 0 && <Note>The Moon stays below the horizon during this night.</Note>}
			<Note>How much the Moon matters depends on the target and filter, neither of which is known here. Times are the Sun's and the Moon's, computed locally for this site.</Note>
		</CollapsibleSection>
	)
}

export interface SourcesProps {
	// Forecast read; absent before the first answer.
	readonly forecast?: AstroWeatherForecast
	// Civil date of the evening shown.
	readonly localDate: string
	// IANA time zone of the times.
	readonly timeZone: string
}

// Text of when a service was last read.
function readAt(source: AstroWeatherForecast['meteorology']['source'], timeZone: string) {
	if (source.fetchedAt === undefined) return 'Unavailable'
	return `${formatClock(source.fetchedAt, timeZone, true)}${source.state === 'stale' ? ' (stale)' : ''}`
}

// Last sample of a forecast, as a text.
function lastSample(samples: readonly (MeteorologySample | AstronomicalSample)[], timeZone: string) {
	const last = samples.at(-1)
	return last && formatEclipseTime(last.time, timeZone)
}

// Where the forecast comes from, with the credits the services ask for.
export function Sources({ forecast, localDate, timeZone }: SourcesProps) {
	return (
		<CollapsibleSection id="astroWeather.sources" title="Sources" defaultOpen={false} summary={localDate}>
			{forecast && (
				<>
					<Datum label={`${PROVIDER_NAMES.openMeteo} read`}>{readAt(forecast.meteorology.source, timeZone)}</Datum>
					<Value label="Covers to" value={lastSample(forecast.meteorology.samples, timeZone)} />
					<Value label="Model height" value={forecast.meteorology.grid?.elevation} unit=" m" />
					<Datum label={`${PROVIDER_NAMES.sevenTimer} read`}>{readAt(forecast.astronomy.source, timeZone)}</Datum>
					<Value label="Model run" value={forecast.astronomy.source.modelRunAt && formatClock(forecast.astronomy.source.modelRunAt, timeZone, true)} />
					<Value label="Covers to" value={lastSample(forecast.astronomy.samples, timeZone)} />
				</>
			)}
			<Note>
				Weather from{' '}
				<a className="text-accent" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
					Open-Meteo
				</a>
				, under{' '}
				<a className="text-accent" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
					CC BY 4.0
				</a>
				. Seeing and transparency from{' '}
				<a className="text-accent" href="https://www.7timer.info/" target="_blank" rel="noreferrer">
					7Timer!
				</a>
				, for a cell of 0.1°. Both are free for non-commercial use.
			</Note>
			<Note>These are forecasts, not measurements of this site. They are planning aids, not a safety system, and they command nothing.</Note>
		</CollapsibleSection>
	)
}
