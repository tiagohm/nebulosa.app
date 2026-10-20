import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { pauseSkyTime, playSkyTime, SKY_TIME_RATES, setSkyTime, setSkyTimeNow, skyClock, skyTime, stepSkyTime, type WallTime, zonedWallTime, zonedWallTimeToUtc } from './clock'

// Time bar of the Sky workspace, below the star map: shows and edits the simulated instant in the
// observer's time zone (or the browser's), returns to the real time, steps it, and plays it at a chosen
// speed, forwards or backwards. Only this bar re-renders as the instant advances; the map follows the
// clock on its own.

export interface TimeControllerProps {
	// IANA time zone the instant is shown and entered in; the browser's when absent.
	readonly timeZone?: string
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
const inputClass = 'box-border h-8 rounded-sm border border-line-200 bg-base-200 px-2 font-mono text-xs text-ink-100 [color-scheme:dark] hover:border-ink-300 focus:border-accent focus:outline-none'

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

// Short name of a time zone at an instant, such as "GMT-3".
function zoneName(time: number, timeZone?: string) {
	return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(time).find((part) => part.type === 'timeZoneName')?.value ?? ''
}

// Time bar of the Sky workspace.
export function TimeController({ timeZone }: TimeControllerProps) {
	const clock = useSnapshot(skyClock)
	const [step, setStep] = useState<StepLabel>('1 hour')
	const [, redraw] = useState(0)
	const time = skyTime(clock, Date.now())
	const wall = zonedWallTime(time, timeZone)
	const playing = clock.mode === 'playing'

	useEffect(() => {
		if (clock.mode === 'fixed') return
		const timer = setInterval(() => redraw((n) => n + 1), playing ? REDRAW_MS.playing : REDRAW_MS.idle)
		return () => clearInterval(timer)
	}, [clock.mode, playing])

	// Shows the instant of an edited date or time; an empty or partial value is ignored.
	function edit(next: Partial<WallTime>) {
		if (Object.values(next).some((value) => !Number.isFinite(value))) return
		setSkyTime(skyClock, zonedWallTimeToUtc({ ...wall, ...next }, timeZone))
	}

	return (
		<div className="flex min-h-12 flex-none flex-wrap items-center gap-2 border-t border-line-100 bg-base-100 px-2 py-1.5">
			<Button variant={clock.mode === 'now' ? 'primary' : 'secondary'} onClick={() => setSkyTimeNow(skyClock)} title="Show the real current time">
				Now
			</Button>
			<IconButton icon="stepBack" label={`Back ${step}`} onClick={() => stepSkyTime(skyClock, -STEPS[step])} />
			<input
				type="date"
				value={dateValue(wall)}
				onChange={(e) => {
					const [year, month, day] = e.target.value.split('-').map(Number)
					if (e.target.value) edit({ year, month, day })
				}}
				className={inputClass}
			/>
			<input
				type="time"
				step={1}
				value={timeValue(wall)}
				onChange={(e) => {
					const [hour, minute, second = 0] = e.target.value.split(':').map(Number)
					if (e.target.value) edit({ hour, minute, second })
				}}
				className={inputClass}
			/>
			<span className="font-mono text-xs text-ink-300">{zoneName(time, timeZone)}</span>
			<IconButton icon="stepForward" label={`Forward ${step}`} onClick={() => stepSkyTime(skyClock, STEPS[step])} />
			<Select options={STEP_LABELS} value={step} onChange={setStep} className="w-28" />
			<IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} pressed={playing} onClick={() => (playing ? pauseSkyTime(skyClock) : playSkyTime(skyClock, clock.rate))} />
			<Select options={RATE_OPTIONS} value={`${clock.rate}`} format={formatRate} onChange={(option) => (playing ? playSkyTime(skyClock, +option) : (skyClock.rate = +option))} className="w-32" />
			<span className={cn('ml-auto rounded-sm px-2 py-0.5 text-xs font-medium', clock.mode === 'now' ? 'text-ink-300' : 'bg-accent-subtle text-accent')}>{clock.mode === 'now' ? 'Real time' : playing ? 'Simulating' : 'Simulated'}</span>
		</div>
	)
}
