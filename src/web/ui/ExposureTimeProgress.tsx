import { Chip } from '@heroui/react'
import { useState } from 'react'
import type { CameraCaptureEvent, CameraCaptureState } from 'src/shared/types'
import { tw } from '../shared/util'
import { Icons } from './Icon'

export interface ExposureTimeProgressProps extends React.ComponentProps<'div'> {
	readonly progress: CameraCaptureEvent
}

export function ExposureTimeProgress({ progress, className = '', ...props }: ExposureTimeProgressProps) {
	const [showRemainingTime, setShowRemainingTime] = useState(true)

	return (
		<div {...props} className={tw('flex flex-row items-center gap-2', className)}>
			<Chip className='lowercase' color='success' size='sm'>
				{status(progress.state)}
			</Chip>
			<Chip color='warning' size='sm' startContent={<Icons.Counter size={12} />}>
				{progress.elapsedCount}
				{!progress.loop && <span> / {progress.count}</span>}
			</Chip>
			<Chip color='secondary' onPointerUp={() => setShowRemainingTime(!showRemainingTime)} size='sm' startContent={<Icons.TimerSand size={12} />}>
				{progress.loop ? (
					<span>{formatTime(progress.totalProgress.elapsedTime)}</span>
				) : (
					<span>
						{formatTime(showRemainingTime ? progress.totalProgress.remainingTime : progress.totalProgress.elapsedTime)} ({progress.totalProgress.progress.toFixed(2)}%)
					</span>
				)}
			</Chip>
			<Chip color='primary' onPointerUp={() => setShowRemainingTime(!showRemainingTime)} size='sm' startContent={<Icons.TimerSand size={12} />}>
				{formatTime(showRemainingTime ? progress.frameProgress.remainingTime : progress.frameProgress.elapsedTime)} ({progress.frameProgress.progress.toFixed(2)}%)
			</Chip>
		</div>
	)
}

function status(state: CameraCaptureState) {
	switch (state) {
		case 'EXPOSURE_STARTED':
		case 'EXPOSING':
			return 'exposing'
		case 'EXPOSURE_FINISHED':
			return 'downloading'
		default:
			return state
	}
}

function formatTime(us: number) {
	const ms = Math.floor((us / 1000) % 1000)
	const seconds = Math.floor(us / 1000000)
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
	} else if (us > 0) {
		return `${padNumber(us, 3)}μs`
	} else {
		return '0'
	}
}

function padNumber(n: number, size: number): string {
	return n.toFixed(0).padStart(size, '0')
}
