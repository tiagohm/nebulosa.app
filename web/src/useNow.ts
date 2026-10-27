import { useEffect, useState } from 'react'

// React clock for elapsed and remaining times shown while something runs on the server: a timer of the component
// that uses it, started and stopped with it, never a global one.

// Interval of the clock, in milliseconds.
const NOW_INTERVAL = 1000

// Returns the current time in Unix milliseconds, refreshed every second while running; the time is refreshed at once
// when running starts, and the timer stops when it ends or the component unmounts.
export function useNow(running: boolean = true): number {
	const [now, setNow] = useState(() => Date.now())

	useEffect(() => {
		if (!running) return
		setNow(Date.now())
		const timer = setInterval(() => setNow(Date.now()), NOW_INTERVAL)
		return () => clearInterval(timer)
	}, [running])

	return now
}
