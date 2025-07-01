import { Chip } from '@heroui/react'
import type { CameraCaptureState, CameraCaptureTaskEvent } from 'src/api/types'
import * as MaterialDesignIcon from './MaterialDesignIcon'

export interface ExposureTimeProgressProps extends React.HTMLAttributes<HTMLDivElement> {
	readonly progress: CameraCaptureTaskEvent
}

export function ExposureTimeProgress({ progress, className = '', ...props }: ExposureTimeProgressProps) {
	return (
		<div {...props} className={`flex flex-row items-center gap-2 ${className}`}>
			<Chip className='lowercase' color='success' size='sm'>
				{status(progress.state)}
			</Chip>
			<Chip color='warning' size='sm' startContent={<MaterialDesignIcon.Counter size={12} />}>
				{progress.elapsedCount} / {progress.count}
			</Chip>
			<Chip color='secondary' size='sm' startContent={<MaterialDesignIcon.TimerSand size={12} />}>
				{formatTime(progress.totalProgress.remainingTime)} ({progress.totalProgress.progress.toFixed(2)}%)
			</Chip>
			<Chip color='primary' size='sm' startContent={<MaterialDesignIcon.TimerSand size={12} />}>
				{formatTime(progress.frameProgress.remainingTime)} ({progress.frameProgress.progress.toFixed(2)}%)
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
		return `${padNumber(us, 6)}μs`
	} else {
		return '0'
	}
}

function padNumber(n: number, size: number): string {
	return n.toFixed(0).padStart(size, '0')
}
