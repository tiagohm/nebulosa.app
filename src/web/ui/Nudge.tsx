import { Button, type ButtonProps } from '@heroui/react'
import * as Lucide from 'lucide-react'
import { useCallback, useRef } from 'react'

export type NudgeDirection = 'upLeft' | 'up' | 'upRight' | 'left' | 'right' | 'downLeft' | 'down' | 'downRight'

export interface NudgeProps extends React.HTMLAttributes<HTMLDivElement> {
	readonly isDisabled?: boolean
	readonly isCancelDisabled?: boolean
	readonly onNudge: (direction: NudgeDirection, down: boolean) => void
	readonly onCancel?: () => void
}

export function Nudge({ onNudge, onCancel, isDisabled, isCancelDisabled, ...props }: NudgeProps) {
	return (
		<div {...props}>
			<div className='grid grid-cols-12 gap-2 justify-items-center items-center'>
				<NudgeButton className='col-span-4' color='secondary' icon={Lucide.ArrowUpLeft} isDisabled={isDisabled} onPointer={(down) => onNudge('upLeft', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Lucide.ArrowUp} isDisabled={isDisabled} onPointer={(down) => onNudge('up', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Lucide.ArrowUpRight} isDisabled={isDisabled} onPointer={(down) => onNudge('upRight', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Lucide.ArrowLeft} isDisabled={isDisabled} onPointer={(down) => onNudge('left', down)} />
				<NudgeButton className='col-span-4' color='danger' icon={Lucide.X} isDisabled={isDisabled || isCancelDisabled} onPointer={(down) => down && onCancel?.()} />
				<NudgeButton className='col-span-4' color='secondary' icon={Lucide.ArrowRight} isDisabled={isDisabled} onPointer={(down) => onNudge('right', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Lucide.ArrowDownLeft} isDisabled={isDisabled} onPointer={(down) => onNudge('downLeft', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Lucide.ArrowDown} isDisabled={isDisabled} onPointer={(down) => onNudge('down', down)} />
				<NudgeButton className='col-span-4' color='secondary' icon={Lucide.ArrowDownRight} isDisabled={isDisabled} onPointer={(down) => onNudge('downRight', down)} />
			</div>
		</div>
	)
}

export interface NudgeButtonProps extends Omit<ButtonProps, 'isIconOnly' | 'size' | 'variant' | 'onPointerUp' | 'onPointerDown' | 'onPointerLeave' | 'onPointerOut' | 'onPointerCancel'> {
	readonly icon: Lucide.LucideIcon
	readonly onPointer: (down: boolean, event: React.PointerEvent<HTMLButtonElement>) => void
}

export function NudgeButton({ icon: Icon, onPointer, ...props }: NudgeButtonProps) {
	const entered = useRef(false)

	const handlePointerDown = useCallback(
		(e: React.PointerEvent<HTMLButtonElement>) => {
			if (!entered.current) {
				entered.current = true
				onPointer(true, e)
			}
		},
		[onPointer],
	)

	const handlePointerUp = useCallback(
		(e: React.PointerEvent<HTMLButtonElement>) => {
			if (entered.current) {
				entered.current = false
				onPointer(false, e)
			}
		},
		[onPointer],
	)

	return (
		<Button {...props} isIconOnly onPointerCancel={handlePointerUp} onPointerDown={handlePointerDown} onPointerLeave={handlePointerUp} onPointerOut={handlePointerUp} onPointerUp={handlePointerUp} size='md' variant='light'>
			<Icon size={16} strokeWidth={4} />
		</Button>
	)
}
