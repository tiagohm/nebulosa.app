import * as React from 'react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { assignRef } from '@/shared/util'
import { DEFAULT_FLOATING_OFFSET, Floating, type FloatingClassNames, type FloatingPlacement } from './Floating'

const DEFAULT_CLOSE_DELAY = 0

export type TooltipPlacement = FloatingPlacement
export type TooltipClassNames = FloatingClassNames

export interface TooltipProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'content'> {
	readonly children: React.ReactNode
	readonly content?: React.ReactNode
	readonly placement?: TooltipPlacement
	readonly open?: boolean
	readonly onOpenChange?: (open: boolean) => void
	readonly disabled?: boolean
	readonly autoFlip?: boolean
	readonly delay?: number
	readonly closeDelay?: number
	readonly portalContainer?: Element
	readonly classNames?: TooltipClassNames
	readonly offset?: number
	readonly trigger?: 'focus'
}

// Clears a pending tooltip timer before the next visibility change.
function clearTimer(timerRef: React.RefObject<number | null>) {
	if (timerRef.current !== null) {
		window.clearTimeout(timerRef.current)
		timerRef.current = null
	}
}

// Renders the hover and focus driven tooltip wrapper around the shared floating content.
export function Tooltip({ autoFlip = true, children, className, classNames, closeDelay = DEFAULT_CLOSE_DELAY, content, delay = 0, id, open, onOpenChange, disabled = false, offset = DEFAULT_FLOATING_OFFSET, placement = 'bottom', portalContainer, ref, style, trigger, ...props }: TooltipProps) {
	const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false)
	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null)
	const showTimerRef = useRef<number | null>(null)
	const hideTimerRef = useRef<number | null>(null)
	const hoveringRef = useRef(false)
	const focusingRef = useRef(false)
	const mounted = typeof document !== 'undefined'
	const hasContent = content !== undefined && content !== null && content !== false
	const isControlled = open !== undefined
	const isOpen = isControlled ? open : uncontrolledIsOpen
	const visible = hasContent && !disabled && isOpen

	// Updates the tooltip open state in controlled and uncontrolled modes.
	const setOpen = useEffectEvent((nextOpen: boolean) => {
		if (!isControlled) setUncontrolledIsOpen(nextOpen)
		if (nextOpen === isOpen) return
		onOpenChange?.(nextOpen)
	})

	// Keeps the trigger element available for controlled initial-open rendering.
	function handleTriggerRef(element: HTMLElement | null) {
		if (element !== null) setTriggerElement(element)
	}

	// Closes the tooltip immediately and clears any pending timers.
	const hideTooltip = useEffectEvent(() => {
		clearTimer(showTimerRef)
		clearTimer(hideTimerRef)
		setOpen(false)
	})

	// Opens the tooltip after the configured delay when the trigger remains active.
	const scheduleOpen = useEffectEvent((element?: EventTarget | null) => {
		if (!mounted || disabled || !hasContent) return

		if (element instanceof HTMLElement) {
			handleTriggerRef(element)
		}

		clearTimer(hideTimerRef)

		if (isOpen) {
			return
		}

		clearTimer(showTimerRef)

		if (delay <= 0) {
			setOpen(true)
			return
		}

		showTimerRef.current = window.setTimeout(() => {
			showTimerRef.current = null
			if ((hoveringRef.current || focusingRef.current) && !disabled) {
				setOpen(true)
			}
		}, delay)
	})

	// Closes the tooltip after the configured delay once the trigger is no longer active.
	const scheduleClose = useEffectEvent(() => {
		clearTimer(showTimerRef)

		if (hoveringRef.current || focusingRef.current) {
			return
		}

		clearTimer(hideTimerRef)

		if (closeDelay <= 0) {
			setOpen(false)
			return
		}

		hideTimerRef.current = window.setTimeout(() => {
			hideTimerRef.current = null
			if (!hoveringRef.current && !focusingRef.current) {
				setOpen(false)
			}
		}, closeDelay)
	})

	// Clears timers when the tooltip wrapper unmounts.
	useEffect(() => {
		return () => {
			clearTimer(showTimerRef)
			clearTimer(hideTimerRef)
		}
	}, [])

	// Forces the tooltip closed when content disappears or the trigger becomes disabled.
	useEffect(() => {
		if (disabled || !hasContent) {
			hoveringRef.current = false
			focusingRef.current = false
			hideTooltip()
		}
	}, [disabled, hasContent, hideTooltip])

	if (hasContent) {
		// Tracks hover entry on the trigger element.
		function handlePointerEnter(event: React.PointerEvent<HTMLElement>) {
			if (trigger === 'focus' || event.pointerType === 'touch') return
			hoveringRef.current = true
			scheduleOpen(event.currentTarget)
		}

		// Tracks hover exit on the trigger element.
		function handlePointerLeave() {
			hoveringRef.current = false
			scheduleClose()
		}

		// Tracks focus entry on the trigger element.
		function handleFocus(event: React.FocusEvent<HTMLElement>) {
			focusingRef.current = true
			scheduleOpen(event.currentTarget)
		}

		// Tracks focus exit on the trigger element.
		function handleBlur(event: React.FocusEvent<HTMLElement>) {
			if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
			focusingRef.current = false
			scheduleClose()
		}

		if (React.isValidElement(children) && children.type !== React.Fragment) {
			const child = children as React.ReactElement<React.DOMAttributes<HTMLElement> & { readonly ref?: React.Ref<HTMLElement> }>

			children = React.cloneElement(child, {
				ref: (element: HTMLElement | null) => {
					handleTriggerRef(element)
					assignRef(child.props.ref, element)
				},
				onBlur: (event) => {
					handleBlur(event)
					child.props.onBlur?.(event)
				},
				onFocus: (event) => {
					handleFocus(event)
					child.props.onFocus?.(event)
				},
				onPointerEnter: (event) => {
					handlePointerEnter(event)
					child.props.onPointerEnter?.(event)
				},
				onPointerLeave: (event) => {
					handlePointerLeave()
					child.props.onPointerLeave?.(event)
				},
			})
		} else {
			children = (
				<span className="w-fit" onBlur={handleBlur} onFocus={handleFocus} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave} ref={handleTriggerRef}>
					{children}
				</span>
			)
		}
	}

	return (
		<>
			{children}
			{hasContent && (
				<Floating
					{...props}
					autoFlip={autoFlip}
					className={className}
					classNames={classNames}
					closeOnEscape
					content={content}
					id={id}
					offset={offset}
					onOpenChange={setOpen}
					open={visible}
					placement={placement}
					portalContainer={portalContainer}
					ref={ref}
					role="tooltip"
					style={style}
					triggerElement={triggerElement}
				/>
			)}
		</>
	)
}
