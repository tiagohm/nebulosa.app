import { useEffect } from 'react'
import { formatLongDateTime } from '../../format'
import { IconButton } from '../../ui/IconButton'
import { Select } from '../../ui/Select'
import { Slider } from '../../ui/Slider'
import { TextInput } from '../../ui/TextInput'
import { adjacentEvent, FOLLOW_INTERVAL_MS, followedEvening, followNow, inputInstant, localInput, PLANET_PERIODS, PLANET_RATES, type PlanetPeriod, type PlanetRate, type PlannerClock, RATE_LABELS, setTime, STEP_MS } from './planetary'

// Clock of a planetary planner, independent of the Sky clock: the evening the period starts and its length, the instant
// shown, now, steps, the previous and next listed events, and play with its rate. Times are entered and shown in the
// display zone. Now makes the clock follow real now: the button stays pressed and the clock reads real now again every
// FOLLOW_INTERVAL_MS, and as soon as the tab is shown again, moving the period to tonight once real now leaves it, until
// another instant or another first evening is chosen or play starts. Every
// transport button has its own glyph, a media player's: the clock for now, skip for the events, step for ten minutes;
// on a coarse pointer each is a 44 px target.

// The clock and period of a planner.
export interface PlannerTimeState extends PlannerClock {
	// Civil date of the first evening of the period; absent until the tool opens.
	eveningDate?: string
	// Days of the period.
	period: PlanetPeriod
	rate: PlanetRate
}

export interface TimeBarProps {
	// The clock as rendered (a snapshot).
	readonly state: Readonly<PlannerTimeState>
	// The clock to change (the store's proxy).
	readonly store: PlannerTimeState
	// The period, Unix milliseconds.
	readonly range: { readonly start: number; readonly end: number }
	// Maxima of the events listed, for the previous and next jumps.
	readonly events: readonly { readonly maximum: number }[]
	// IANA zone the times are entered and shown in.
	readonly timeZone: string
	// IANA zone that names the evenings, in which a clock that follows real now finds tonight.
	readonly eveningZone: string
	// Real now, Unix milliseconds.
	readonly now: () => number
}

// Milliseconds per hour.
const HOUR_MS = 3_600_000

// Classes of the transport buttons: the 44 px touch target on a coarse pointer.
const BUTTON_CLASS = 'pointer-coarse:size-[44px]'

// Clock of a planner.
export function TimeBar({ state, store, range, events, timeZone, eveningZone, now }: TimeBarProps) {
	const time = state.time ?? range.start
	const previous = adjacentEvent(events, time, -1)
	const next = adjacentEvent(events, time, 1)

	// A clock that follows real now reads it again at intervals and when the tab is shown again.
	useEffect(() => {
		if (!state.following) return undefined
		const refresh = () => {
			if (!document.hidden) followNow(store, now())
		}
		const timer = setInterval(refresh, FOLLOW_INTERVAL_MS)
		document.addEventListener('visibilitychange', refresh)
		return () => {
			clearInterval(timer)
			document.removeEventListener('visibilitychange', refresh)
		}
	}, [state.following, store, now])

	// A clock that follows real now out of the period moves the period to tonight.
	useEffect(() => {
		const evening = followedEvening(state, range, eveningZone)
		if (evening !== undefined) store.eveningDate = evening
	}, [state.following, state.time, range.start, range.end, eveningZone, store])

	return (
		<div className="flex flex-col gap-2 rounded border border-line-100 bg-base-100 p-3">
			<div className="flex flex-wrap items-end gap-2">
				<TextInput
					label="First evening"
					type="date"
					value={state.eveningDate ?? ''}
					onChange={(event) => {
						if (!event.target.value) return
						store.eveningDate = event.target.value
						store.following = false
					}}
				/>
				<Select label="Period" className="w-32 flex-none" options={PLANET_PERIODS.map(String)} value={String(state.period)} format={(days) => (days === '1' ? '1 day' : `${days} days`)} onChange={(days) => (store.period = Number(days) as PlanetPeriod)} />
				<TextInput
					label={`Time (${timeZone})`}
					type="datetime-local"
					value={localInput(time, timeZone)}
					onChange={(event) => {
						const instant = inputInstant(event.target.value, timeZone)
						if (instant !== undefined) setTime(store, instant)
					}}
				/>
				<span className="flex items-center gap-1">
					<IconButton icon="clock" label={state.following ? 'Following now, updated every 30 s' : 'Now'} className={BUTTON_CLASS} pressed={state.following} onClick={() => followNow(store, now())} />
					<IconButton icon="skipToStart" label="Previous event" className={BUTTON_CLASS} disabled={!previous} onClick={() => previous && setTime(store, previous.maximum)} />
					<IconButton icon="stepBack" label="Back 10 minutes" className={BUTTON_CLASS} onClick={() => setTime(store, time - STEP_MS)} />
					<IconButton
						icon={state.playing ? 'pause' : 'play'}
						label={state.playing ? 'Pause' : 'Play'}
						className={BUTTON_CLASS}
						pressed={state.playing}
						onClick={() => {
							store.playing = !state.playing
							store.following = false
						}}
					/>
					<IconButton icon="stepForward" label="Forward 10 minutes" className={BUTTON_CLASS} onClick={() => setTime(store, time + STEP_MS)} />
					<IconButton icon="skipToEnd" label="Next event" className={BUTTON_CLASS} disabled={!next} onClick={() => next && setTime(store, next.maximum)} />
				</span>
				<Select label="Speed" className="w-32 flex-none" options={PLANET_RATES.map(String)} value={String(state.rate)} format={(rate) => RATE_LABELS[Number(rate) as PlanetRate]} onChange={(rate) => (store.rate = Number(rate) as PlanetRate)} />
			</div>
			<Slider
				label={`Hours into the period · ${formatLongDateTime(time, timeZone)}`}
				value={Math.max(0, Math.min(range.end - range.start, time - range.start)) / HOUR_MS}
				min={0}
				max={(range.end - range.start) / HOUR_MS}
				step={0.01}
				onChange={(hours) => setTime(store, range.start + Math.round(hours * 60) * 60_000)}
			/>
		</div>
	)
}
