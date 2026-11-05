import { useEffect, useMemo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatGeographic } from '../../format'
import { openObservingSites } from '../../location/site'
import { TimeZoneSelect } from '../../location/TimeZoneSelect'
import { ToolLocationSection } from '../../location/ToolLocationSection'
import { useDisplayZone, useToolLocation } from '../../location/useLocation'
import { describeDisplayZone } from '../../location/zone'
import { activeProfile, astroWeatherPreferences, profileState, setAstroWeatherPreferences } from '../../profile/profile'
import { ASTRO_WEATHER_MODES, type AstroWeatherMode } from '../../profile/schema'
import { PanelSection } from '../../shell/ContextualPanel'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { IconButton } from '../../ui/IconButton'
import { Notice } from '../../ui/Notice'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { type AstroWeatherState, astroWeatherState, EMPTY_FORECAST, firstNight, followProfile, followSite, formatClock, hasNextNight, loadCurrentNight, loadForecast, MODE_LABELS, nightEnded, OUTLOOK_LABELS, siteKey, stepNight } from './astroweather'
import { AstronomicalConditions, SkyConditions, Sources, WeatherConditions } from './ForecastDetails'
import { ForecastSummary, reasonsText } from './ForecastSummary'
import { ForecastTimeline } from './ForecastTimeline'
import { evaluateNight } from './observing'

// Astro Weather tool: whether a night is worth observing, when, and for what, from forecasts and the local astronomy of the
// site. It reads and commands nothing but those: no device, no profile, no site, no sequence. The active profile's observing
// site is the default location, and a saved site or coordinates chosen here are held for the tool alone. Nights are named in
// the location's own zone; the display zone only formats the times. Everything here is a forecast, and the page says so.

// How often the current time is read again for what depends on it, in milliseconds; nothing is requested for it.
const CLOCK_INTERVAL_MS = 60_000

// Astro Weather tool.
export function AstroWeather() {
	const profiles = useSnapshot(profileState)
	const state = useSnapshot(astroWeatherState) as AstroWeatherState
	const profile = activeProfile(profiles)
	const { mode } = astroWeatherPreferences(profile.settings)
	const location = useToolLocation(state.location)
	const displayZone = useDisplayZone(location, state.zone)
	const key = location && siteKey(location)
	const [now, setNow] = useState(() => Date.now())
	const { forecast, night, cursor, forecastError, forecastLoading, nightError } = state

	useEffect(() => followProfile(astroWeatherState, profile.id), [profile.id])

	// Follows the location while the tool is shown; the key holds everything its requests depend on, never the display zone.
	useEffect(() => (location ? followSite(astroWeatherState, location) : undefined), [key])

	// Keeps the current time, which only moves the marks of the timeline and leaves the hours that have passed out of a window.
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS)
		return () => clearInterval(timer)
	}, [])

	// Moves on when the night shown ends with the tool open; asks for no forecast.
	useEffect(() => {
		if (location && night && nightEnded(night, now)) void loadCurrentNight(astroWeatherState, location)
	}, [night, now])

	const shown = forecast ?? EMPTY_FORECAST
	const evaluation = useMemo(() => night && evaluateNight(shown, night, mode, now), [shown, night, mode, now])
	const firstHour = evaluation
		? Math.max(
				0,
				evaluation.segments.findIndex((hour) => hour.end > now),
			)
		: 0
	const index = evaluation ? Math.max(0, cursor === undefined ? firstHour : evaluation.segments.findIndex((hour) => hour.start === cursor)) : 0
	const hour = evaluation?.segments[index]
	const samples = new Map(shown.meteorology.samples.map((sample) => [sample.time, sample]))
	const sample = hour && samples.get(hour.start)
	const ending = hour && samples.get(hour.end)
	const timeZone = displayZone.zone

	const panel = (
		<>
			<ToolLocationSection value={state.location} location={location} onChange={(value) => (astroWeatherState.location = value)} elevation />
			{location && (
				<PanelSection title="Time Zone">
					<TimeZoneSelect label="Times Shown In" value={state.zone} onChange={(value) => (astroWeatherState.zone = value)} site={location} selectedSite={location.source !== 'active'} />
					{timeZone !== location.timeZone && <Notice>Nights are named by the date of their evening in {location.timeZone}, the zone of the location.</Notice>}
				</PanelSection>
			)}
			{night && (
				<>
					<SkyConditions sample={sample} hour={hour} />
					<WeatherConditions sample={sample} ending={ending} />
					<AstronomicalConditions night={night} timeZone={timeZone} />
					<Sources forecast={forecast} localDate={night.sun.localDate} timeZone={timeZone} />
				</>
			)}
		</>
	)

	if (!location) {
		return (
			<WorkspaceLayout workspace="tools" title="Astro Weather" panel={{ title: 'Location', content: panel }}>
				<EmptyState
					title="No location"
					description={state.location.mode === 'active' ? 'Set the observing site of this profile, or choose a location in the panel.' : 'The site chosen was deleted. Choose another location in the panel.'}
					action={
						<Button variant="secondary" onClick={() => openObservingSites()}>
							Set Location
						</Button>
					}
				/>
			</WorkspaceLayout>
		)
	}

	const coordinates = formatGeographic(location.latitude, location.longitude)
	const back = night && firstNight(night, now, state.currentNightStart)
	const forward = night && hasNextNight(night, forecast)

	return (
		<WorkspaceLayout workspace="tools" title="Astro Weather" panel={{ title: 'Location and Details', content: panel }}>
			<div className="h-full overflow-y-auto">
				<div className="flex flex-col gap-4 p-4">
					<div className="flex flex-wrap items-end gap-x-4 gap-y-3">
						<div className="min-w-0 flex-1 basis-56">
							<p className="m-0 truncate text-sm font-medium text-ink-100">{location.name ?? 'Coordinates entered'}</p>
							<p className="m-0 truncate text-xs text-ink-300">
								{coordinates} · {describeDisplayZone(displayZone)}
							</p>
							<p className="m-0 mt-1 text-xs font-medium text-ink-200">Forecast — not live observations</p>
						</div>
						<div className="flex items-center gap-1">
							<IconButton icon="stepBack" label={back ? 'The previous night has passed' : 'Previous night'} disabled={!night || back} onClick={() => void stepNight(astroWeatherState, location, -1)} />
							<span className="min-w-36 text-center text-sm text-ink-100">{night ? `Night of ${night.sun.localDate}` : 'Computing the night…'}</span>
							<IconButton icon="stepForward" label={forward ? 'Next night' : 'The forecast ends here'} disabled={!forward} onClick={() => void stepNight(astroWeatherState, location, 1)} />
						</div>
						<SegmentedControl options={ASTRO_WEATHER_MODES} value={mode} format={(value: AstroWeatherMode) => MODE_LABELS[value]} onChange={(value) => setAstroWeatherPreferences(profileState, { mode: value })} />
						<Button variant="secondary" disabled={forecastLoading} onClick={() => void loadForecast(astroWeatherState, location)}>
							{forecastLoading ? 'Refreshing…' : 'Refresh'}
						</Button>
					</div>
					{forecastError && <Notice error>{forecastError} The night below is computed locally; Refresh tries again.</Notice>}
					{nightError && <Notice error>{nightError}</Notice>}
					{night && evaluation ? (
						<>
							<ForecastSummary forecast={shown} loaded={!!forecast} night={night} evaluation={evaluation} mode={mode} timeZone={timeZone} />
							<div>
								<ForecastTimeline forecast={shown} night={night} evaluation={evaluation} timeZone={timeZone} cursor={index} onCursor={(i) => (astroWeatherState.cursor = evaluation.segments[i].start)} now={now} />
								{hour && (
									<p className="m-0 mt-2 text-sm leading-5 text-ink-200">
										<span className="text-ink-100">
											{formatClock(hour.start, timeZone)}–{formatClock(hour.end, timeZone, true)}: {OUTLOOK_LABELS[hour.outlook]}
										</span>
										{reasonsText(hour) && `. ${reasonsText(hour)}`}
									</p>
								)}
							</div>
						</>
					) : (
						!nightError && <EmptyState title="Computing the night" description="The Sun and Moon of this site are computed locally." />
					)}
				</div>
			</div>
		</WorkspaceLayout>
	)
}
