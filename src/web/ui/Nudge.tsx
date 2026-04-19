import { useRef, useState } from 'react'
import { Button, type ButtonProps } from './components/Button'
import { type Icon, Icons } from './Icon'

export type NudgeDirection = 'upLeft' | 'up' | 'upRight' | 'left' | 'right' | 'downLeft' | 'down' | 'downRight'

export interface NudgeProps extends React.ComponentProps<'div'> {
	readonly disabled?: boolean
	readonly isNudgeDisabled?: boolean
	readonly isUpLeftDisabled?: boolean
	readonly isUpDisabled?: boolean
	readonly isUpRightDisabled?: boolean
	readonly isLeftDisabled?: boolean
	readonly isRightDisabled?: boolean
	readonly isDownLeftDisabled?: boolean
	readonly isDownDisabled?: boolean
	readonly isDownRightDisabled?: boolean
	readonly isCancelDisabled?: boolean
	readonly onNudge: (direction: NudgeDirection, down: boolean) => void
	readonly onCancel?: () => void
}

export function Nudge({ onNudge, onCancel, disabled, isNudgeDisabled, isUpLeftDisabled, isUpDisabled, isUpRightDisabled, isLeftDisabled, isRightDisabled, isDownLeftDisabled, isDownDisabled, isDownRightDisabled, isCancelDisabled, ...props }: NudgeProps) {
	const [direction, setDirection] = useState<NudgeDirection | null>(null)

	function handleNudgePointer(direction: NudgeDirection, down: boolean) {
		setDirection(down ? direction : null)
		onNudge(direction, down)
	}

	return (
		<div {...props}>
			<div className='grid grid-cols-12 gap-2 justify-items-center items-center'>
				<NudgeButton className='col-span-4' color='secondary' disabled={disabled || isUpLeftDisabled || (isNudgeDisabled && direction !== 'upLeft')} icon={Icons.ArrowUpLeft} onPointer={(down) => handleNudgePointer('upLeft', down)} />
				<NudgeButton className='col-span-4' color='secondary' disabled={disabled || isUpDisabled || (isNudgeDisabled && direction !== 'up')} icon={Icons.ArrowUp} onPointer={(down) => handleNudgePointer('up', down)} />
				<NudgeButton className='col-span-4' color='secondary' disabled={disabled || isUpRightDisabled || (isNudgeDisabled && direction !== 'upRight')} icon={Icons.ArrowUpRight} onPointer={(down) => handleNudgePointer('upRight', down)} />
				<NudgeButton className='col-span-4' color='secondary' disabled={disabled || isLeftDisabled || (isNudgeDisabled && direction !== 'left')} icon={Icons.ArrowLeft} onPointer={(down) => handleNudgePointer('left', down)} />
				<NudgeButton className='col-span-4' color='danger' disabled={disabled || isCancelDisabled} icon={Icons.CloseCircle} onPointer={(down) => down && onCancel?.()} />
				<NudgeButton className='col-span-4' color='secondary' disabled={disabled || isRightDisabled || (isNudgeDisabled && direction !== 'right')} icon={Icons.ArrowRight} onPointer={(down) => handleNudgePointer('right', down)} />
				<NudgeButton className='col-span-4' color='secondary' disabled={disabled || isDownLeftDisabled || (isNudgeDisabled && direction !== 'downLeft')} icon={Icons.ArrowDownLeft} onPointer={(down) => handleNudgePointer('downLeft', down)} />
				<NudgeButton className='col-span-4' color='secondary' disabled={disabled || isDownDisabled || (isNudgeDisabled && direction !== 'down')} icon={Icons.ArrowDown} onPointer={(down) => handleNudgePointer('down', down)} />
				<NudgeButton className='col-span-4' color='secondary' disabled={disabled || isDownRightDisabled || (isNudgeDisabled && direction !== 'downRight')} icon={Icons.ArrowDownRight} onPointer={(down) => handleNudgePointer('downRight', down)} />
			</div>
		</div>
	)
}

export interface NudgeButtonProps extends Omit<ButtonProps, 'isIconOnly' | 'size' | 'variant' | 'onPointerUp' | 'onPointerDown' | 'onPointerLeave' | 'onPointerOut' | 'onPointerCancel'> {
	readonly icon: Icon
	readonly onPointer: (down: boolean, event: React.PointerEvent<HTMLElement>) => void
}

export function NudgeButton({ icon: Icon, onPointer, ...props }: NudgeButtonProps) {
	const entered = useRef(false)

	function handlePointerDown(e: React.PointerEvent<HTMLElement>) {
		if (!entered.current) {
			entered.current = true
			onPointer(true, e)
		}
	}

	function handlePointerUp(e: React.PointerEvent<HTMLElement>) {
		if (entered.current) {
			entered.current = false
			onPointer(false, e)
		}
	}

	return <Button children={<Icon stroke={4} />} onPointerCancel={handlePointerUp} onPointerDown={handlePointerDown} onPointerLeave={handlePointerUp} onPointerOut={handlePointerUp} onPointerUp={handlePointerUp} size='md' variant='ghost' {...props} />
}
