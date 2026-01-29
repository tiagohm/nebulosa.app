import { Button, type ButtonProps } from '@heroui/react'
import { useRef, useState } from 'react'
import { type Icon, Icons } from './Icon'

export type NudgeDirection = 'upLeft' | 'up' | 'upRight' | 'left' | 'right' | 'downLeft' | 'down' | 'downRight'

export interface NudgeProps extends React.ComponentProps<'div'> {
	readonly isDisabled?: boolean
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

export function Nudge({ onNudge, onCancel, isDisabled, isNudgeDisabled, isUpLeftDisabled, isUpDisabled, isUpRightDisabled, isLeftDisabled, isRightDisabled, isDownLeftDisabled, isDownDisabled, isDownRightDisabled, isCancelDisabled, ...props }: NudgeProps) {
	const [direction, setDirection] = useState<NudgeDirection | null>(null)

	function handleNudgePointer(direction: NudgeDirection, down: boolean) {
		setDirection(down ? direction : null)
		onNudge(direction, down)
	}

	return (
		<div {...props}>
			<div className='grid grid-cols-12 gap-2 justify-items-center items-center'>
				<NudgeButton className='col-span-4' color='secondary' icon={Icons.ArrowUpLeft} isDisabled={isDisabled || isUpLeftDisabled || (isNudgeDisabled && direction !== 'upLeft')} onPointer={(down) => handleNudgePointer('upLeft', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Icons.ArrowUp} isDisabled={isDisabled || isUpDisabled || (isNudgeDisabled && direction !== 'up')} onPointer={(down) => handleNudgePointer('up', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Icons.ArrowUpRight} isDisabled={isDisabled || isUpRightDisabled || (isNudgeDisabled && direction !== 'upRight')} onPointer={(down) => handleNudgePointer('upRight', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Icons.ArrowLeft} isDisabled={isDisabled || isLeftDisabled || (isNudgeDisabled && direction !== 'left')} onPointer={(down) => handleNudgePointer('left', down)} />
				<NudgeButton className='col-span-4' color='danger' icon={Icons.CloseCircle} isDisabled={isDisabled || isCancelDisabled} onPointer={(down) => down && onCancel?.()} />
				<NudgeButton className='col-span-4' color='secondary' icon={Icons.ArrowRight} isDisabled={isDisabled || isRightDisabled || (isNudgeDisabled && direction !== 'right')} onPointer={(down) => handleNudgePointer('right', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Icons.ArrowDownLeft} isDisabled={isDisabled || isDownLeftDisabled || (isNudgeDisabled && direction !== 'downLeft')} onPointer={(down) => handleNudgePointer('downLeft', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Icons.ArrowDown} isDisabled={isDisabled || isDownDisabled || (isNudgeDisabled && direction !== 'down')} onPointer={(down) => handleNudgePointer('down', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Icons.ArrowDownRight} isDisabled={isDisabled || isDownRightDisabled || (isNudgeDisabled && direction !== 'downRight')} onPointer={(down) => handleNudgePointer('downRight', down)} />
			</div>
		</div>
	)
}

export interface NudgeButtonProps extends Omit<ButtonProps, 'isIconOnly' | 'size' | 'variant' | 'onPointerUp' | 'onPointerDown' | 'onPointerLeave' | 'onPointerOut' | 'onPointerCancel'> {
	readonly icon: Icon
	readonly onPointer: (down: boolean, event: React.PointerEvent<HTMLButtonElement>) => void
}

export function NudgeButton({ icon: Icon, onPointer, ...props }: NudgeButtonProps) {
	const entered = useRef(false)

	function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
		if (!entered.current) {
			entered.current = true
			onPointer(true, e)
		}
	}

	function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
		if (entered.current) {
			entered.current = false
			onPointer(false, e)
		}
	}

	return (
		<Button {...props} isIconOnly onPointerCancel={handlePointerUp} onPointerDown={handlePointerDown} onPointerLeave={handlePointerUp} onPointerOut={handlePointerUp} onPointerUp={handlePointerUp} size='md' variant='light'>
			<Icon stroke={4} />
		</Button>
	)
}
