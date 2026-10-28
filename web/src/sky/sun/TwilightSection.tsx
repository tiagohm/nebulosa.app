import type { SolarDailyState, SolarTwilightCrossings, SunLocalDay } from 'api'
import { formatDuration } from '../../tools/eclipse/eclipse'
import { CollapsibleSection } from '../CollapsibleSection'
import { formatLocalTime } from '../format'
import { Datum, Note } from '../InspectorParts'

// Twilight section of the Sun Inspector: the dawn and dusk of civil, nautical, and astronomical twilight on the
// observer's civil date, and the astronomical night that begins that evening. A limit the Sun never reaches that day
// is said in words, never as a time or a zero.

// Twilight limits shown, with the depression of the Sun's center.
const LIMITS = [
	['civil', 'Civil', '−6°'],
	['nautical', 'Nautical', '−12°'],
	['astronomical', 'Astronomical', '−18°'],
] as const

// Says why a twilight limit has no crossing that day.
function stateText(state: SolarDailyState, depression: string) {
	return state === 'continuousAbove' ? `Sun above ${depression} all day` : state === 'continuousBelow' ? `Sun below ${depression} all day` : 'None this day'
}

// Dawn and dusk cells of a twilight limit.
function Crossings({ crossings, depression, day, timeZone }: { readonly crossings: SolarTwilightCrossings; readonly depression: string; readonly day: SunLocalDay; readonly timeZone?: string }) {
	if (crossings.dawn === undefined && crossings.dusk === undefined) return <span className="col-span-2 text-right text-ink-300">{stateText(crossings.state, depression)}</span>

	return (
		<>
			<span className="text-right font-mono text-ink-100">{crossings.dawn !== undefined ? formatLocalTime(crossings.dawn, day.start, undefined, timeZone) : 'none'}</span>
			<span className="text-right font-mono text-ink-100">{crossings.dusk !== undefined ? formatLocalTime(crossings.dusk, day.start, undefined, timeZone) : 'none'}</span>
		</>
	)
}

// Says when the astronomical night of a day is, or why there is none.
function astronomicalNight(day: SunLocalDay) {
	const { durationSeconds, start, state } = day.astronomicalNight
	if (durationSeconds !== undefined) return formatDuration(durationSeconds)
	if (state === 'continuousAbove') return 'None, the Sun stays above −18°'
	if (state === 'continuousBelow') return 'All day'
	return start !== undefined ? 'Lasts beyond 36 hours' : 'None this evening'
}

// Says from when to when the astronomical night of a day lasts; undefined without a start.
function astronomicalNightSpan(day: SunLocalDay, timeZone?: string) {
	const { start, end } = day.astronomicalNight
	if (start === undefined) return undefined
	const from = formatLocalTime(start, day.start, undefined, timeZone)
	return end === undefined ? `From ${from}` : `${from} → ${formatLocalTime(end, day.start, undefined, timeZone)}`
}

// Twilight section of the Sun Inspector; without an observer it asks for the location.
export function TwilightSection({ day, hasObserver, timeZone }: { readonly day?: SunLocalDay; readonly hasObserver: boolean; readonly timeZone?: string }) {
	const dusk = day?.astronomical.dusk
	const summary = dusk !== undefined && day ? `Astronomical dusk ${formatLocalTime(dusk, day.start, undefined, timeZone)}` : undefined

	return (
		<CollapsibleSection id="twilight" title="Twilight" summary={summary}>
			{!hasObserver ? (
				<p className="m-0 text-ink-300">Twilight needs the observer&apos;s location.</p>
			) : !day ? (
				<p className="m-0 text-ink-300">Computing the twilight…</p>
			) : (
				<>
					<div className="grid grid-cols-[auto_1fr_1fr] items-baseline gap-x-3 gap-y-1">
						<span />
						<span className="text-right text-xs text-ink-300">Dawn</span>
						<span className="text-right text-xs text-ink-300">Dusk</span>
						{LIMITS.map(([key, label, depression]) => (
							<div key={key} className="contents">
								<span className="text-ink-300">{label}</span>
								<Crossings crossings={day[key]} depression={depression} day={day} timeZone={timeZone} />
							</div>
						))}
					</div>
					<Datum label="Astronomical night">{astronomicalNight(day)}</Datum>
					{astronomicalNightSpan(day, timeZone) && <p className="m-0 text-right font-mono text-xs text-ink-200">{astronomicalNightSpan(day, timeZone)}</p>}
					<Note>Geometric altitude of the Sun&apos;s center at −6°, −12°, and −18° on {day.localDate}, from the local model.</Note>
				</>
			)}
		</CollapsibleSection>
	)
}
