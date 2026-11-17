import type { AstronomicalSample, AstroWeatherForecast, AstroWeatherNight, MeteorologySample, SolarTwilightCrossings } from 'api'
import { formatClockTime, formatFixed, formatHours, formatLongDateTime, formatPercent, formatTemperature } from '../../format'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { SEEING_BANDS, TRANSPARENCY_BANDS } from './astroweather'
import { PROVIDER_NAMES } from './ForecastSummary'
import type { OutlookSegment } from './observing'

// Details of the contextual panel: the sky and the weather of the hour chosen, each naming that hour first, the astronomy of
// the night, and where everything comes from, summarized by when the forecast was read. Each value the forecast lacks is left out, and what a value means is said where it could be
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
		<DataRow label={label}>
			{value}
			{unit}
		</DataRow>
	)
}

// Text of an hour, from its start to its end in a time zone.
function hourText(hour: OutlookSegment | undefined, timeZone: string) {
	return hour && `${formatClockTime(hour.start, timeZone)}–${formatClockTime(hour.end, timeZone)}`
}

// Text of the bands the classes of a 7Timer! sample stand for, or none without a class.
function bandsText(seeing: number | undefined, transparency: number | undefined) {
	const bands = [seeing ? `seeing ${SEEING_BANDS[seeing - 1]}` : undefined, transparency ? `transparency ${TRANSPARENCY_BANDS[transparency - 1]} mag per airmass` : undefined].filter(Boolean)
	return bands.length > 0 ? `Classes of the nearest 3-hour sample, not interpolated: ${bands.join(', ')}, the bands of the classes, not measurements.` : undefined
}

export interface SkyConditionsProps {
	// Sample of the hour chosen.
	readonly sample?: MeteorologySample
	// Hour chosen.
	readonly hour?: OutlookSegment
	// IANA time zone of the times.
	readonly timeZone: string
}

// Sky of the hour chosen: cloud layers and the classes of the nearest 7Timer! sample, under the hour they describe.
export function SkyConditions({ sample, hour, timeZone }: SkyConditionsProps) {
	const { seeing, transparency } = hour ?? {}
	const bands = bandsText(seeing, transparency)
	const time = hourText(hour, timeZone)

	return (
		<CollapsibleSection id="astroWeather.sky" title="Sky Conditions" summary={time}>
			{time && <DataRow label="Hour">{time}</DataRow>}
			<Value label="Total cloud" value={sample?.cloudCover} unit="%" />
			<Value label="Low cloud" value={sample?.cloudCoverLow} unit="%" />
			<Value label="Middle cloud" value={sample?.cloudCoverMid} unit="%" />
			<Value label="High cloud" value={sample?.cloudCoverHigh} unit="%" />
			<Value label="Seeing" value={seeing && `class ${seeing}`} />
			<Value label="Transparency" value={transparency && `class ${transparency}`} />
			{bands && <Notice>{bands}</Notice>}
			{!sample && !seeing && !transparency && <Notice>No forecast for this hour.</Notice>}
		</CollapsibleSection>
	)
}

export interface WeatherConditionsProps {
	// Sample of the hour chosen.
	readonly sample?: MeteorologySample
	// Sample ending the hour, which holds its precipitation and gusts.
	readonly ending?: MeteorologySample
	// Hour chosen.
	readonly hour?: OutlookSegment
	// IANA time zone of the times.
	readonly timeZone: string
}

// Weather of the hour chosen, under the hour it describes.
export function WeatherConditions({ sample, ending, hour, timeZone }: WeatherConditionsProps) {
	const margin = sample?.temperature !== undefined && sample.dewPoint !== undefined ? formatTemperature(sample.temperature - sample.dewPoint) : undefined
	const time = hourText(hour, timeZone)

	return (
		<CollapsibleSection id="astroWeather.weather" title="Weather Conditions" summary={time}>
			{time && <DataRow label="Hour">{time}</DataRow>}
			<Value label="Rain chance" value={ending?.precipitationProbability} unit="%" />
			<Value label="Precipitation" value={ending?.precipitation === undefined ? undefined : formatFixed(ending.precipitation, 1)} unit=" mm" />
			<Value label="Temperature" value={sample?.temperature === undefined ? undefined : formatTemperature(sample.temperature)} />
			<Value label="Humidity" value={sample?.relativeHumidity} unit="%" />
			<Value label="Dew point" value={sample?.dewPoint === undefined ? undefined : formatTemperature(sample.dewPoint)} />
			<Value label="Dew margin" value={margin} />
			<Value label="Wind" value={sample?.windSpeed} unit=" km/h" />
			<Value label="Direction" value={sample?.windDirection === undefined ? undefined : `${compassPoint(sample.windDirection)} (${sample.windDirection}°)`} />
			<Value label="Gusts" value={ending?.windGust} unit=" km/h" />
			{!sample && !ending && <Notice>No forecast for this hour.</Notice>}
			<Notice>A chance is not an occurrence, and surfaces cool below the air temperature, so dew can form above the dew point shown.</Notice>
		</CollapsibleSection>
	)
}

// Text of a crossing, or of why there is none.
function crossingText(time: number | undefined, { state }: Pick<SolarTwilightCrossings, 'state'>, timeZone: string) {
	if (time !== undefined) return formatClockTime(time, timeZone)
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
			<DataRow label="Sunset">{crossingText(sun.sunset, { state: sun.daylight }, timeZone)}</DataRow>
			<DataRow label="Civil dusk">{crossingText(sun.civil.dusk, sun.civil, timeZone)}</DataRow>
			<DataRow label="Nautical dusk">{crossingText(sun.nautical.dusk, sun.nautical, timeZone)}</DataRow>
			<DataRow label="Astronomical dusk">{crossingText(sun.astronomical.dusk, sun.astronomical, timeZone)}</DataRow>
			<DataRow label="Astronomical dawn">{crossingText(sun.astronomical.dawn, sun.astronomical, timeZone)}</DataRow>
			<DataRow label="Nautical dawn">{crossingText(sun.nautical.dawn, sun.nautical, timeZone)}</DataRow>
			<DataRow label="Civil dawn">{crossingText(sun.civil.dawn, sun.civil, timeZone)}</DataRow>
			<DataRow label="Sunrise">{crossingText(sun.sunrise, { state: sun.daylight }, timeZone)}</DataRow>
			{sun.darkness.map((span) => (
				<DataRow key={span.start} label="Darkness">
					{formatHours(span.end - span.start)}
				</DataRow>
			))}
			{sun.darkness.length === 0 && <Notice>The Sun does not reach −18° this night, so there is no astronomical darkness.</Notice>}
			<DataRow label="Moon lit">{formatPercent(moon.illuminatedFraction)}</DataRow>
			{moon.above.map((span) => (
				<DataRow key={span.start} label="Moon up">
					{formatClockTime(span.start, timeZone)}–{formatClockTime(span.end, timeZone)}
				</DataRow>
			))}
			{moon.above.length === 0 && <Notice>The Moon stays below the horizon during this night.</Notice>}
			<Notice>How much the Moon matters depends on the target and filter, neither of which is known here. Times are the Sun's and the Moon's, computed locally for this site.</Notice>
		</CollapsibleSection>
	)
}

export interface SourcesProps {
	// Forecast read; absent before the first answer.
	readonly forecast?: AstroWeatherForecast
	// IANA time zone of the times.
	readonly timeZone: string
}

// Text of when a service was last read.
function readAt(source: AstroWeatherForecast['meteorology']['source'], timeZone: string) {
	if (source.fetchedAt === undefined) return 'Unavailable'
	return `${formatClockTime(source.fetchedAt, timeZone, { named: true })}${source.state === 'stale' ? ' (stale)' : ''}`
}

// Last sample of a forecast, as a text.
function lastSample(samples: readonly (MeteorologySample | AstronomicalSample)[], timeZone: string) {
	const last = samples.at(-1)
	return last && formatLongDateTime(last.time, timeZone)
}

// Where the forecast comes from, with the credits the services ask for, summarized by when Open-Meteo was read.
export function Sources({ forecast, timeZone }: SourcesProps) {
	return (
		<CollapsibleSection id="astroWeather.sources" title="Sources" defaultOpen={false} summary={forecast?.meteorology.source.fetchedAt === undefined ? 'No forecast' : `Read ${readAt(forecast.meteorology.source, timeZone)}`}>
			{forecast && (
				<>
					<DataRow label={`${PROVIDER_NAMES.openMeteo} read`}>{readAt(forecast.meteorology.source, timeZone)}</DataRow>
					<Value label="Covers to" value={lastSample(forecast.meteorology.samples, timeZone)} />
					<Value label="Model height" value={forecast.meteorology.grid?.elevation} unit=" m" />
					<DataRow label={`${PROVIDER_NAMES.sevenTimer} read`}>{readAt(forecast.astronomy.source, timeZone)}</DataRow>
					<Value label="Model run" value={forecast.astronomy.source.modelRunAt && formatClockTime(forecast.astronomy.source.modelRunAt, timeZone, { named: true })} />
					<Value label="Covers to" value={lastSample(forecast.astronomy.samples, timeZone)} />
				</>
			)}
			<Notice>
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
			</Notice>
			<Notice>These are forecasts, not measurements of this site. They are planning aids, not a safety system, and they command nothing.</Notice>
		</CollapsibleSection>
	)
}
