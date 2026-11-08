import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { IconButton } from '../../ui/IconButton'
import { Select } from '../../ui/Select'
import { advanceClock, FRAME_GAP_LIMIT, formatTdb, nearestRate, type OrbitalMechanicsState, orbitalMechanicsState, rateOptions, selectedOrbit, setPlaying, setTime, timelineOf } from './orbitalmechanics'

// Simulation clock of the Orbital Mechanics Explorer: play, pause, reverse, step, reset to the epoch, a scrubber over the
// selected orbit's timeline, and the rate. The clock is the tool's own and never the Sky's. While it plays, each frame
// advances it by the monotonic time since the previous frame times the rate, at most FRAME_GAP_LIMIT of real time per
// frame, so a hidden tab never makes it jump. A bound orbit's timeline is one period and loops; an open one stops at its
// ends. Exact values are read when the clock stops, steps, or is scrubbed to rest, never on every frame.

// Fraction of the timeline one step moves.
const STEP_FRACTION = 1 / 100

// Positions of the scrubber across the timeline.
const SCRUB_STEPS = 1000

// Runs the clock of the explorer while it plays.
export function usePlayback() {
	const { playing } = useSnapshot(orbitalMechanicsState)

	useEffect(() => {
		if (!playing) return
		const state = orbitalMechanicsState
		let last = performance.now()
		let frame = requestAnimationFrame(function tick(now) {
			const elapsed = Math.min(FRAME_GAP_LIMIT, (now - last) / 1000)
			last = now
			const { time, stop } = advanceClock(state.time, state.rate, elapsed, timelineOf(state))
			state.time = time

			if (stop) {
				setPlaying(state, false)
				return
			}

			frame = requestAnimationFrame(tick)
		})

		return () => cancelAnimationFrame(frame)
	}, [playing])
}

// Clock bar under the scene.
export function OrbitTimeline() {
	const state = useSnapshot(orbitalMechanicsState) as OrbitalMechanicsState
	const timeline = timelineOf(state)
	const orbit = selectedOrbit(state)
	const period = orbit?.solution?.elements.equator.period
	const speed = Math.abs(state.rate)
	const options = rateOptions(period, speed)
	const rateLabel = nearestRate(options, speed).label
	const span = timeline ? timeline.end - timeline.start : 0
	const position = timeline && span > 0 ? Math.round(((state.time - timeline.start) / span) * SCRUB_STEPS) : 0
	const anchor = orbit?.solution?.anchor
	const step = (direction: number) => timeline && setTime(orbitalMechanicsState, Math.min(timeline.end, Math.max(timeline.start, state.time + direction * span * STEP_FRACTION)))

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-100 bg-base-100 px-3 py-2">
			<div className="flex items-center gap-1">
				<IconButton icon="stepBack" label="Step back" disabled={!timeline} onClick={() => step(-1)} />
				<IconButton icon={state.playing ? 'pause' : 'play'} label={state.playing ? 'Pause' : 'Play'} disabled={!timeline} onClick={() => setPlaying(orbitalMechanicsState, !state.playing)} />
				<IconButton icon="stepForward" label="Step forward" disabled={!timeline} onClick={() => step(1)} />
				<IconButton icon="arrow" label="Reverse" pressed={state.rate < 0} disabled={!timeline} onClick={() => (orbitalMechanicsState.rate = -state.rate)} />
				<IconButton icon="skipToEnd" label="Reset to epoch" className="rotate-180" disabled={anchor === undefined} onClick={() => anchor !== undefined && setTime(orbitalMechanicsState, anchor)} />
			</div>
			<input
				type="range"
				min={0}
				max={SCRUB_STEPS}
				step={1}
				value={position}
				disabled={!timeline}
				title="Time"
				className="min-w-40 flex-1 accent-accent"
				onChange={(e) => {
					if (!timeline) return
					orbitalMechanicsState.playing = false
					orbitalMechanicsState.time = timeline.start + (+e.target.value / SCRUB_STEPS) * span
				}}
				onPointerUp={() => setTime(orbitalMechanicsState, orbitalMechanicsState.time)}
				onKeyUp={() => setTime(orbitalMechanicsState, orbitalMechanicsState.time)}
			/>
			<div className="flex min-w-0 flex-col text-xs leading-4 tabular-nums">
				<span className="text-ink-100">{formatTdb(state.time)}</span>
				<span className="text-ink-300">JD {state.time.toFixed(5)} TDB</span>
			</div>
			<Select
				options={options.map((e) => e.label)}
				value={rateLabel}
				onChange={(label) => {
					const rate = options.find((e) => e.label === label)!.rate
					orbitalMechanicsState.rate = state.rate < 0 ? -rate : rate
				}}
				className="w-36"
			/>
		</div>
	)
}
