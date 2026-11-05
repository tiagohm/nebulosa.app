import { useEffect, useMemo, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatGeographic } from '../../format'
import { activeProfile, astroWeatherPreferences, profileState, setAstroWeatherPreferences } from '../../profile/profile'
import { ASTRO_WEATHER_MODES, type AstroWeatherMode } from '../../profile/schema'
import { PanelSection } from '../../shell/ContextualPanel'
import { navigate, routeState } from '../../shell/route'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { skyState } from '../../sky/sky'
import { Button } from '../../ui/Button'
import { IconButton } from '../../ui/IconButton'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { type EclipsePlace, observerPlace } from '../eclipse/eclipse'
import { DISPLAY_TIME_ZONES, LocationSection, Note } from '../eclipse/EclipsePanelParts'
import { type AstroWeatherState, astroWeatherState, EMPTY_FORECAST, effectiveSite, firstNight, followProfile, followSite, formatClock, hasNextNight, loadCurrentNight, loadForecast, MODE_LABELS, nightEnded, OUTLOOK_LABELS, siteKey, stepNight } from './astroweather'
import { AstronomicalConditions, SkyConditions, Sources, WeatherConditions } from './ForecastDetails'
import { ForecastSummary, reasonsText } from './ForecastSummary'
import { ForecastTimeline } from './ForecastTimeline'
import { evaluateNight } from './observing'

// Astro Weather tool: whether a night is worth observing, when, and for what, from forecasts and the local astronomy of the
// site. It reads and commands nothing but those: no device, no profile observer, no sequence. The Sky observer is the default
// site, and a site chosen here is held for the tool alone. Everything here is a forecast, and the page says so.

// How often the current time is read again for what depends on it, in milliseconds; nothing is requested for it.
const CLOCK_INTERVAL_MS = 60_000

// Opens the Observer panel of the Sky.
function openObserver() {
	skyState.panel = 'observer'
	navigate(routeState, { workspace: 'sky' })
}

// Takes a place of the Location section: the Sky observer is followed live, any other place is held for the tool alone. The
// zone chosen for the place before does not carry over, since a coordinate does not tell its civil time zone.
function choosePlace(place: EclipsePlace) {
	astroWeatherState.place = place.source === 'observer' ? undefined : place
	astroWeatherState.timeZone = undefined
}

// Returns the name of a zone of the selector.
function zoneName(zone: string) {
	return zone || 'Browser time zone'
}

// Astro Weather tool.
export function AstroWeather() {
	const profiles = useSnapshot(profileState)
	const state = useSnapshot(astroWeatherState) as AstroWeatherState
	const profile = activeProfile(profiles)
	const { observer } = profile.settings.sky
	const { mode } = astroWeatherPreferences(profile.settings)
	const site = effectiveSite(state, observer)
	const key = site && siteKey(site)
	const [now, setNow] = useState(() => Date.now())
	const { forecast, night, cursor, forecastError, forecastLoading, nightError, place } = state

	useEffect(() => followProfile(astroWeatherState, profile.id), [profile.id])

	// Follows the site while the tool is shown; the key holds everything its requests depend on.
	useEffect(() => (site ? followSite(astroWeatherState, site) : undefined), [key])

	// Keeps the current time, which only moves the marks of the timeline and leaves the hours that have passed out of a window.
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS)
		return () => clearInterval(timer)
	}, [])

	// Moves on when the night shown ends with the tool open; asks for no forecast.
	useEffect(() => {
		if (site && night && nightEnded(night, now)) void loadCurrentNight(astroWeatherState, site)
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
	const timeZone = site?.timeZone ?? 'UTC'

	const panel = (
		<>
			<LocationSection place={place ?? (observer && observerPlace(observer))} observer={observer} onSelect={choosePlace} />
			{site && (
				<PanelSection title="Time Zone">
					<Select options={DISPLAY_TIME_ZONES} value={state.timeZone ?? site.timeZone} format={zoneName} onChange={(zone) => (astroWeatherState.timeZone = zone)} />
					{place && !state.timeZone && <Note>Coordinates do not tell a civil time zone, so a place starts in UTC.</Note>}
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

	if (!site) {
		return (
			<WorkspaceLayout workspace="tools" title="Astro Weather" panel={{ title: 'Site', content: panel }}>
				<EmptyState
					title="No site"
					description="Set the Sky observer of this profile, or enter coordinates in the panel."
					action={
						<Button variant="secondary" onClick={openObserver}>
							Set Sky Observer
						</Button>
					}
				/>
			</WorkspaceLayout>
		)
	}

	const coordinates = formatGeographic(site.latitude, site.longitude)
	const back = night && firstNight(night, now, state.currentNightStart)
	const forward = night && hasNextNight(night, forecast)

	return (
		<WorkspaceLayout workspace="tools" title="Astro Weather" panel={{ title: 'Site and Details', content: panel }}>
			<div className="h-full overflow-y-auto">
				<div className="flex flex-col gap-4 p-4">
					<div className="flex flex-wrap items-end gap-x-4 gap-y-3">
						<div className="min-w-0 flex-1 basis-56">
							<p className="m-0 truncate text-sm font-medium text-ink-100">{site.name ?? (place ? 'Site entered' : 'Sky observer')}</p>
							<p className="m-0 truncate text-xs text-ink-300">
								{coordinates} · {timeZone}
							</p>
							<p className="m-0 mt-1 text-xs font-medium text-ink-200">Forecast — not live observations</p>
						</div>
						<div className="flex items-center gap-1">
							<IconButton icon="stepBack" label={back ? 'The previous night has passed' : 'Previous night'} disabled={!night || back} onClick={() => void stepNight(astroWeatherState, site, -1)} />
							<span className="min-w-36 text-center text-sm text-ink-100">{night ? `Night of ${night.sun.localDate}` : 'Computing the night…'}</span>
							<IconButton icon="stepForward" label={forward ? 'Next night' : 'The forecast ends here'} disabled={!forward} onClick={() => void stepNight(astroWeatherState, site, 1)} />
						</div>
						<SegmentedControl options={ASTRO_WEATHER_MODES} value={mode} format={(value: AstroWeatherMode) => MODE_LABELS[value]} onChange={(value) => setAstroWeatherPreferences(profileState, { mode: value })} />
						<Button variant="secondary" disabled={forecastLoading} onClick={() => void loadForecast(astroWeatherState, site)}>
							{forecastLoading ? 'Refreshing…' : 'Refresh'}
						</Button>
					</div>
					{forecastError && <Note danger>{forecastError} The night below is computed locally; Refresh tries again.</Note>}
					{nightError && <Note danger>{nightError}</Note>}
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
