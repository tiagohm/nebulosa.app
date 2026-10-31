import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import type { AstronomicalClockReading } from '../../profile/schema'
import { openAstronomicalTimeConverter, qualityNotes } from '../../tools/astronomicaltime/astronomicaltime'
import { astronomicalClockRuntime, clockApproximate, clockFreshness, clockReadingText, clockTitle, liveClock } from './astronomicalclock'

// Readings of the status bar clock: a chip per reading that opens the Astronomical Time Converter and nothing else, with
// the full readout in its title. Each one keeps its own one-second timer, so the bar and its equipment selectors are not
// rendered again for the clock.

// Interval at which the readings are refreshed, in milliseconds.
const CLOCK_INTERVAL_MS = 1000

// Note of a reading that is not current.
const FRESHNESS_NOTES = { fresh: [], stale: ['Not updated recently: the server is not answering.'], expired: ['Not available: the server is not answering.'], none: ['Not available yet.'] } as const

// Returns the monotonic clock in milliseconds, refreshed every second while the component lives.
export function useMonotonicNow() {
	const [now, setNow] = useState(() => performance.now())

	useEffect(() => {
		const timer = setInterval(() => setNow(performance.now()), CLOCK_INTERVAL_MS)
		return () => clearInterval(timer)
	}, [])

	return now
}

interface AstronomicalClockChipProps {
	// Reading shown.
	readonly reading: AstronomicalClockReading
	// Time zone of the local time, an IANA name.
	readonly timeZone: string
	// Whether times of day show seconds.
	readonly showSeconds: boolean
	// Name or coordinates of the observer; absent without one.
	readonly site?: string
	// Whether this is the hidden copy the bar measures, which cannot be used.
	readonly measure?: boolean
}

// One reading of the clock.
export function AstronomicalClockChip({ reading, timeZone, showSeconds, site, measure = false }: AstronomicalClockChipProps) {
	const now = useMonotonicNow()
	const { sample } = useSnapshot(astronomicalClockRuntime)
	const freshness = clockFreshness(sample, now)
	const live = sample && freshness !== 'expired' ? liveClock(sample, now) : undefined
	const approximate = clockApproximate(sample)
	const { label, value } = clockReadingText(reading, live, timeZone, showSeconds, approximate)
	const notes = [...FRESHNESS_NOTES[freshness], ...(sample ? qualityNotes(sample.reference.quality) : [])]

	return (
		<button
			type="button"
			tabIndex={measure ? -1 : undefined}
			title={clockTitle(live, timeZone, site, notes, approximate)}
			onClick={() => openAstronomicalTimeConverter()}
			className={cn('flex flex-none cursor-pointer items-center gap-1 tabular-nums hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent', freshness === 'fresh' ? 'text-ink-200' : 'text-ink-300')}
		>
			<span className="text-ink-300">{label}</span>
			{value}
		</button>
	)
}
