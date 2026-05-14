import { useState } from 'react'
import type { CameraCaptureEvent, CameraCaptureState, CameraCaptureTime } from 'src/shared/types'
import { tw } from '@/shared/util'
import { Chip, type ChipProps } from './components/Chip'
import { Icons } from './Icon'

export interface ExposureTimeProgressProps extends React.ComponentProps<'div'> {
	readonly progress: CameraCaptureEvent
}

const CAPTURE_STATE_LABELS = {
	IDLE: 'idle',
	EXPOSURE_STARTED: 'exposing',
	EXPOSING: 'exposing',
	WAITING: 'waiting',
	SETTLING: 'settling',
	DITHERING: 'dithering',
	PAUSING: 'pausing',
	PAUSED: 'paused',
	EXPOSURE_FINISHED: 'downloading',
	ERROR: 'error',
} satisfies Record<CameraCaptureState, string>

const CAPTURE_STATE_COLORS = {
	IDLE: 'default',
	EXPOSURE_STARTED: 'success',
	EXPOSING: 'success',
	WAITING: 'warning',
	SETTLING: 'warning',
	DITHERING: 'secondary',
	PAUSING: 'warning',
	PAUSED: 'warning',
	EXPOSURE_FINISHED: 'primary',
	ERROR: 'danger',
} satisfies Record<CameraCaptureState, NonNullable<ChipProps['color']>>

export function ExposureTimeProgress({ progress, className = '', ...props }: ExposureTimeProgressProps) {
	const [showRemainingTime, setShowRemainingTime] = useState(true)

	function toggleShowRemaining() {
		setShowRemainingTime((show) => !show)
	}

	const countLabel = progress.loop ? progress.elapsedCount.toFixed(0) : `${progress.elapsedCount} / ${progress.count}`

	return (
		<div {...props} className={tw('flex flex-row items-center gap-2 overflow-hidden', className)}>
			<Chip size="sm" className="lowercase" color={CAPTURE_STATE_COLORS[progress.state]} label={CAPTURE_STATE_LABELS[progress.state]} />
			<Chip size="sm" color="warning" label={countLabel} startContent={<Icons.Counter />} />
			<Chip size="sm" color="secondary" label={progress.loop ? formatTime(progress.totalProgress.elapsedTime) : formatProgressTime(progress.totalProgress, showRemainingTime)} onPointerUp={toggleShowRemaining} startContent={<Icons.TimerSand />} />
			<Chip size="sm" color="primary" label={formatProgressTime(progress.frameProgress, showRemainingTime)} onPointerUp={toggleShowRemaining} startContent={<Icons.TimerSand />} />
		</div>
	)
}

function finiteTime(value: number) {
	return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function formattedProgress(value: number) {
	if (!Number.isFinite(value)) return 0
	return Math.min(100, Math.max(0, value)).toFixed(0)
}

function formatProgressTime(time: CameraCaptureTime, showRemainingTime: boolean) {
	return `${formatTime(showRemainingTime ? time.remainingTime : time.elapsedTime)} (${formattedProgress(time.progress)}%)`
}

function formatTime(us: number) {
	const time = finiteTime(us)
	const ms = Math.floor((time / 1000) % 1000)
	const seconds = Math.floor(time / 1000000)
	const s = Math.floor(seconds % 60)
	const m = Math.floor((seconds % 3600) / 60)
	const h = Math.floor(seconds / 3600)

	if (h > 0) {
		return `${padNumber(h, 2)}h ${padNumber(m, 2)}m ${padNumber(s, 2)}s`
	} else if (m > 0) {
		return `${padNumber(m, 2)}m ${padNumber(s, 2)}s`
	} else if (s > 0) {
		return `${padNumber(s, 2)}s`
	} else if (ms > 0) {
		return `${padNumber(ms, 3)}ms`
	} else if (time > 0) {
		return `${padNumber(time, 3)}μs`
	} else {
		return '0'
	}
}

function padNumber(n: number, size: number) {
	return n.toFixed(0).padStart(size, '0')
}
