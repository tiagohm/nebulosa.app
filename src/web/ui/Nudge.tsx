import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button, type ButtonProps } from './components/Button'
import { type Icon, Icons } from './Icon'

export type NudgeDirection = 'upLeft' | 'up' | 'upRight' | 'left' | 'right' | 'downLeft' | 'down' | 'downRight'

type NudgeControl = { readonly type: 'nudge'; readonly direction: NudgeDirection; readonly icon: Icon } | { readonly type: 'cancel'; readonly icon: Icon }

type NudgeButtonReservedProp = 'children' | 'endContent' | 'label' | 'size' | 'startContent' | 'variant' | 'onPointerUp' | 'onPointerDown' | 'onPointerLeave' | 'onPointerOut' | 'onPointerCancel'

const NUDGE_CONTROLS = [
	{ type: 'nudge', direction: 'upLeft', icon: Icons.ArrowUpLeft },
	{ type: 'nudge', direction: 'up', icon: Icons.ArrowUp },
	{ type: 'nudge', direction: 'upRight', icon: Icons.ArrowUpRight },
	{ type: 'nudge', direction: 'left', icon: Icons.ArrowLeft },
	{ type: 'cancel', icon: Icons.CloseCircle },
	{ type: 'nudge', direction: 'right', icon: Icons.ArrowRight },
	{ type: 'nudge', direction: 'downLeft', icon: Icons.ArrowDownLeft },
	{ type: 'nudge', direction: 'down', icon: Icons.ArrowDown },
	{ type: 'nudge', direction: 'downRight', icon: Icons.ArrowDownRight },
] satisfies readonly NudgeControl[]

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
	const activeDirectionRef = useRef<NudgeDirection | null>(null)
	const disabledByDirection = {
		upLeft: isUpLeftDisabled,
		up: isUpDisabled,
		upRight: isUpRightDisabled,
		left: isLeftDisabled,
		right: isRightDisabled,
		downLeft: isDownLeftDisabled,
		down: isDownDisabled,
		downRight: isDownRightDisabled,
	} satisfies Record<NudgeDirection, boolean | undefined>

	const stopActiveNudge = useEffectEvent((updateDirection = true) => {
		const activeDirection = activeDirectionRef.current

		if (activeDirection === null) return

		activeDirectionRef.current = null
		if (updateDirection) setDirection(null)
		onNudge(activeDirection, false)
	})

	const activeDirectionDisabled = direction !== null && disabledByDirection[direction]

	useEffect(() => {
		if (disabled || activeDirectionDisabled) stopActiveNudge()
	}, [disabled, activeDirectionDisabled, stopActiveNudge])

	useEffect(() => () => stopActiveNudge(false), [stopActiveNudge])

	function handleNudgePointer(nextDirection: NudgeDirection, down: boolean) {
		if (down) {
			if (activeDirectionRef.current === nextDirection) return
			if (activeDirectionRef.current !== null) onNudge(activeDirectionRef.current, false)

			activeDirectionRef.current = nextDirection
			setDirection(nextDirection)
			onNudge(nextDirection, true)
		} else if (activeDirectionRef.current === nextDirection) {
			activeDirectionRef.current = null
			setDirection(null)
			onNudge(nextDirection, false)
		}
	}

	function handleCancelPointer(down: boolean) {
		if (down) onCancel?.()
	}

	function isDirectionButtonDisabled(nextDirection: NudgeDirection) {
		return disabled || disabledByDirection[nextDirection] || (isNudgeDisabled && direction !== nextDirection)
	}

	return (
		<div {...props}>
			<div className="grid grid-cols-12 items-center justify-items-center gap-2">
				{NUDGE_CONTROLS.map((control) =>
					control.type === 'cancel' ? (
						<NudgeButton className="col-span-4" color="danger" disabled={disabled || isCancelDisabled || onCancel === undefined} icon={control.icon} key="cancel" onPointer={handleCancelPointer} />
					) : (
						<NudgeButton className="col-span-4" color="secondary" disabled={isDirectionButtonDisabled(control.direction)} icon={control.icon} key={control.direction} onPointer={(down) => handleNudgePointer(control.direction, down)} />
					),
				)}
			</div>
		</div>
	)
}

export interface NudgeButtonProps extends Omit<ButtonProps, NudgeButtonReservedProp> {
	readonly icon: Icon
	readonly onPointer: (down: boolean, event: React.PointerEvent<HTMLElement>) => void
}

export function NudgeButton({ icon: Icon, onPointer, disabled, loading, readOnly, ...props }: NudgeButtonProps) {
	const activePointerIdRef = useRef<number | null>(null)
	const blocked = disabled || loading || readOnly

	useEffect(() => {
		if (blocked) activePointerIdRef.current = null
	}, [blocked])

	function handlePointerDown(e: React.PointerEvent<HTMLElement>) {
		if (activePointerIdRef.current === null) {
			activePointerIdRef.current = e.pointerId
			onPointer(true, e)
		}
	}

	function handlePointerUp(e: React.PointerEvent<HTMLElement>) {
		if (activePointerIdRef.current === e.pointerId) {
			activePointerIdRef.current = null
			onPointer(false, e)
		}
	}

	return <Button disabled={disabled} loading={loading} onPointerCancel={handlePointerUp} onPointerDown={handlePointerDown} onPointerLeave={handlePointerUp} onPointerUp={handlePointerUp} readOnly={readOnly} size="md" startContent={<Icon stroke={4} />} variant="ghost" {...props} />
}
