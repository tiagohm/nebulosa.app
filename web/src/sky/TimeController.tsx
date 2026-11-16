import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { type WallTime, wallTimeToInstant, zonedWallTime, zoneShortName } from '../location/zone'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { pauseSkyTime, playSkyTime, SKY_TIME_RATES, setSkyTime, setSkyTimeNow, skyClock, skyTime, stepSkyTime } from './clock'

// Time bar of the Sky workspace, below the star map: shows and edits the simulated instant in the profile's display zone,
// returns to the real time, steps it, and plays it at a chosen speed, forwards or backwards. A date and time typed that
// the clocks of the zone read twice shows the first of the two instants, and one they skip is refused, each saying so;
// changing the zone only reads the same instant again. Only this bar re-renders as the instant advances; the map follows
// the clock on its own.

export interface TimeControllerProps {
	// IANA time zone the instant is shown and entered in.
	readonly timeZone: string
}

// Step sizes, by label, in milliseconds.
const STEPS = { '1 min': 60_000, '1 hour': 3_600_000, '1 day': 86_400_000, '1 week': 604_800_000 } as const

// Label of a step size.
type StepLabel = keyof typeof STEPS

// Step size labels in menu order.
const STEP_LABELS = Object.keys(STEPS) as StepLabel[]

// Speed option: a rate of SKY_TIME_RATES, negative to run backwards, as text.
type RateOption = `${number}`

// Speed options in menu order: backwards from the fastest, then forwards.
const RATE_OPTIONS = [...SKY_TIME_RATES.toReversed().map((rate) => `${-rate}`), ...SKY_TIME_RATES.map((rate) => `${rate}`)] as RateOption[]

// Interval in milliseconds at which the shown instant is redrawn, while playing and otherwise.
const REDRAW_MS = { playing: 250, idle: 1_000 } as const

// Classes of the native date and time inputs.
const inputClass = 'box-border h-9.5 rounded-sm border border-line-200 bg-base-200 px-2 font-mono text-xs text-ink-100 [color-scheme:dark] hover:border-ink-300 focus:border-accent focus:outline-none'

// Classes of the bar's icon buttons: 43.75 px touch targets on phones, where the bar wraps to rows of its own, and the
// compact 28 px toolbar size elsewhere.
const TOUCH_BUTTON = 'max-sm:size-12.5'

// Formats a speed option: "1 min/s", "−1 h/s", "1×".
function formatRate(option: RateOption) {
	const rate = +option
	const sign = rate < 0 ? '−' : ''
	const value = Math.abs(rate)
	if (value === 86400) return `${sign}1 day/s`
	if (value >= 3600) return `${sign}${value / 3600} h/s`
	if (value >= 60) return `${sign}${value / 60} min/s`
	return `${sign}${value}×`
}

// Pads a number to two digits.
function pad(value: number, length = 2) {
	return `${value}`.padStart(length, '0')
}

// Value of a date input for a wall time: "2026-10-18".
function dateValue(wall: WallTime) {
	return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`
}

// Value of a time input for a wall time: "21:30:05".
function timeValue(wall: WallTime) {
	return `${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`
}

// Time bar of the Sky workspace.
export function TimeController({ timeZone }: TimeControllerProps) {
	const clock = useSnapshot(skyClock)
	const [step, setStep] = useState<StepLabel>('1 hour')
	const [, redraw] = useState(0)
	// What the latest edit could not show exactly, until the next one.
	const [notice, setNotice] = useState<string>()
	const time = skyTime(clock, Date.now())
	const wall = zonedWallTime(time, timeZone)
	const playing = clock.mode === 'playing'

	useEffect(() => {
		if (clock.mode === 'fixed') return
		const timer = setInterval(() => redraw((n) => n + 1), playing ? REDRAW_MS.playing : REDRAW_MS.idle)
		return () => clearInterval(timer)
	}, [clock.mode, playing])

	// Shows the instant of an edited date or time; an empty or partial value is ignored. A reading the clocks repeat
	// shows its first instant, and one they skip changes nothing; both say so.
	function edit(next: Partial<WallTime>) {
		if (Object.values(next).some((value) => !Number.isFinite(value))) return
		const target = { ...wall, ...next }
		const instant = wallTimeToInstant(target, timeZone)

		if (instant.kind === 'nonexistent') {
			setNotice(`${timeValue(target)} does not exist on ${dateValue(target)} in ${timeZone}: the clocks skip it.`)
			return
		}

		setNotice(instant.kind === 'ambiguous' ? `${timeValue(target)} happens twice on ${dateValue(target)} in ${timeZone}: showing the first.` : undefined)
		setSkyTime(skyClock, instant.kind === 'exact' ? instant.time : instant.earlier)
	}

	return (
		<div className="flex min-h-12 flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-100 bg-base-100 px-2 py-1.5">
			<div className="flex min-w-0 items-center gap-2">
				<Button variant={clock.mode === 'now' ? 'secondary' : 'primary'} disabled={clock.mode === 'now'} onClick={() => setSkyTimeNow(skyClock)} title={clock.mode === 'now' ? 'The map already shows the real current time' : 'Show the real current time (N)'}>
					Now
				</Button>
				<input
					type="date"
					value={dateValue(wall)}
					onChange={(e) => {
						const [year, month, day] = e.target.value.split('-').map(Number)
						if (e.target.value) edit({ year, month, day })
					}}
					className={cn(inputClass, 'min-w-0')}
				/>
				<input
					type="time"
					step={1}
					value={timeValue(wall)}
					onChange={(e) => {
						const [hour, minute, second = 0] = e.target.value.split(':').map(Number)
						if (e.target.value) edit({ hour, minute, second })
					}}
					className={cn(inputClass, 'min-w-0')}
				/>
				<span className="flex-none font-mono text-xs text-ink-300" title={timeZone}>
					{zoneShortName(timeZone, time)}
				</span>
			</div>
			<div className="flex items-center gap-1">
				<IconButton icon="stepBack" label={`Back ${step}`} onClick={() => stepSkyTime(skyClock, -STEPS[step])} className={TOUCH_BUTTON} />
				<Select options={STEP_LABELS} value={step} onChange={setStep} className="w-28 flex-none" />
				<IconButton icon="stepForward" label={`Forward ${step}`} onClick={() => stepSkyTime(skyClock, STEPS[step])} className={TOUCH_BUTTON} />
			</div>
			<div className="flex items-center gap-1">
				<IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} pressed={playing} onClick={() => (playing ? pauseSkyTime(skyClock) : playSkyTime(skyClock, clock.rate))} className={TOUCH_BUTTON} />
				<Select options={RATE_OPTIONS} value={`${clock.rate}`} format={formatRate} onChange={(option) => (playing ? playSkyTime(skyClock, +option) : (skyClock.rate = +option))} className="w-28 flex-none" />
			</div>
			<span className={cn('ml-auto flex-none rounded-sm px-2 py-0.5 text-xs font-medium', clock.mode === 'now' ? 'text-ink-300' : 'bg-accent-subtle text-accent')}>{clock.mode === 'now' ? 'Real time' : playing ? 'Simulating' : 'Simulated'}</span>
			{notice && <span className="basis-full text-xs text-warning">{notice}</span>}
		</div>
	)
}
