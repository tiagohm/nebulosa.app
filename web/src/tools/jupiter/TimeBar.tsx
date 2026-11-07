import type { JupiterEvent } from 'api'
import { formatLongDateTime } from '../../format'
import { IconButton } from '../../ui/IconButton'
import { Select } from '../../ui/Select'
import { Slider } from '../../ui/Slider'
import { TextInput } from '../../ui/TextInput'
import { adjacentEvent, inputInstant, type JupiterPeriod, JUPITER_PERIODS, JUPITER_RATES, type JupiterPlannerState, jupiterPlannerState, type JupiterRate, localInput, RATE_LABELS, setTime, STEP_MS } from './jupiter'

// Clock of the tool, independent of the Sky clock: the evening the period starts and its length, the instant shown, now,
// steps, the previous and next listed events, and play with its rate. Times are entered and shown in the display zone.

export interface TimeBarProps {
	readonly state: JupiterPlannerState
	// The period, Unix milliseconds.
	readonly range: { readonly start: number; readonly end: number }
	// Events listed, for the previous and next jumps.
	readonly events: readonly JupiterEvent[]
	// IANA zone the times are entered and shown in.
	readonly timeZone: string
	// Real now, Unix milliseconds.
	readonly now: () => number
}

// Milliseconds per hour.
const HOUR_MS = 3_600_000

// Clock of the tool.
export function TimeBar({ state, range, events, timeZone, now }: TimeBarProps) {
	const time = state.time ?? range.start
	const previous = adjacentEvent(events, time, -1)
	const next = adjacentEvent(events, time, 1)

	return (
		<div className="flex flex-col gap-2 rounded border border-line-100 bg-base-050 p-3">
			<div className="flex flex-wrap items-end gap-2">
				<TextInput label="First evening" type="date" value={state.eveningDate ?? ''} onChange={(event) => event.target.value && (jupiterPlannerState.eveningDate = event.target.value)} />
				<Select label="Period" className="w-32 flex-none" options={JUPITER_PERIODS.map(String)} value={String(state.period)} format={(days) => (days === '1' ? '1 day' : `${days} days`)} onChange={(days) => (jupiterPlannerState.period = Number(days) as JupiterPeriod)} />
				<TextInput
					label={`Time (${timeZone})`}
					type="datetime-local"
					value={localInput(time, timeZone)}
					onChange={(event) => {
						const instant = inputInstant(event.target.value, timeZone)
						if (instant !== undefined) setTime(jupiterPlannerState, instant)
					}}
				/>
				<span className="flex items-center gap-1">
					<IconButton icon="skipToEnd" label="Now" onClick={() => setTime(jupiterPlannerState, now())} />
					<IconButton icon="stepBack" label="Previous event" disabled={!previous} onClick={() => previous && setTime(jupiterPlannerState, previous.maximum)} />
					<IconButton icon="stepBack" label="Back 10 minutes" className="opacity-80" onClick={() => setTime(jupiterPlannerState, time - STEP_MS)} />
					<IconButton icon={state.playing ? 'pause' : 'play'} label={state.playing ? 'Pause' : 'Play'} pressed={state.playing} onClick={() => (jupiterPlannerState.playing = !state.playing)} />
					<IconButton icon="stepForward" label="Forward 10 minutes" className="opacity-80" onClick={() => setTime(jupiterPlannerState, time + STEP_MS)} />
					<IconButton icon="stepForward" label="Next event" disabled={!next} onClick={() => next && setTime(jupiterPlannerState, next.maximum)} />
				</span>
				<Select label="Speed" className="w-32 flex-none" options={JUPITER_RATES.map(String)} value={String(state.rate)} format={(rate) => RATE_LABELS[Number(rate) as JupiterRate]} onChange={(rate) => (jupiterPlannerState.rate = Number(rate) as JupiterRate)} />
			</div>
			<Slider
				label={`Hours into the period · ${formatLongDateTime(time, timeZone)}`}
				value={Math.max(0, Math.min(range.end - range.start, time - range.start)) / HOUR_MS}
				min={0}
				max={(range.end - range.start) / HOUR_MS}
				step={0.01}
				onChange={(hours) => setTime(jupiterPlannerState, range.start + Math.round(hours * 60) * 60_000)}
			/>
		</div>
	)
}
