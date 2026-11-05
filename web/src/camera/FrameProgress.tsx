import type { CameraCaptureTime } from 'nebulosa/src/observation/capture/types'
import { formatDuration, MISSING } from '../format'
import { frameProgress } from './capture'

// Progress of the frame a camera operation (Flat Wizard, TPPA, Auto Focus) is exposing, shared by their panels.

// Progress of the frame being exposed, from the driver's countdown (times in microseconds, progress in percent): a bar
// of the exposure completed with the time elapsed and left; before the driver reports any, the bar pulses and the times
// read MISSING instead.
export function FrameProgress({ exposure }: { readonly exposure?: CameraCaptureTime }) {
	const progress = frameProgress(exposure)

	return (
		<div className="flex flex-col gap-1">
			<div className="h-1 overflow-hidden rounded-full bg-base-300">{progress === undefined ? <div className="h-full w-1/3 animate-pulse bg-accent/60" /> : <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progress.fraction * 100}%` }} />}</div>
			<p className="m-0 flex justify-between text-xs leading-4 text-ink-300 tabular-nums">
				<span>{`${progress ? formatDuration(progress.elapsed) : MISSING} elapsed`}</span>
				<span>{`${progress ? formatDuration(progress.remaining) : MISSING} left`}</span>
			</p>
		</div>
	)
}
