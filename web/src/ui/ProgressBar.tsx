import { tv } from 'tailwind-variants'

// The thin progress bar of a running exposure, delay, measurement, or calibration step. The share done is shown as a filled
// track; while it is not known yet, such as before a driver reports its countdown, the track pulses instead of showing 0.

// Filled part of the track, by tone: running, or a step that is done.
const fill = tv({
	base: 'h-full transition-[width] duration-200 motion-reduce:transition-none',
	variants: {
		tone: {
			accent: 'bg-accent',
			success: 'bg-success',
		},
	},
	defaultVariants: {
		tone: 'accent',
	},
})

export interface ProgressBarProps {
	// Share done, from 0 to 1 (clamped), or undefined while it is not known.
	readonly fraction?: number
	// Colour of the filled part: accent while running, success once done.
	readonly tone?: 'accent' | 'success'
}

// Progress of one task.
export function ProgressBar({ fraction, tone }: ProgressBarProps) {
	return (
		<div className="h-1 overflow-hidden rounded-full bg-base-300">
			{fraction === undefined || !Number.isFinite(fraction) ? <div className="h-full w-1/3 animate-pulse bg-accent/60 motion-reduce:animate-none" /> : <div className={fill({ tone })} style={{ width: `${Math.min(1, Math.max(0, fraction)) * 100}%` }} />}
		</div>
	)
}
