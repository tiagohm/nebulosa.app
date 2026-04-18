import type * as React from 'react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type ClassValue, tv } from 'tailwind-variants'
import { assignRef, clamp, tw } from '@/shared/util'

const VIEWPORT_PADDING = 12
const DEFAULT_OFFSET = 10
const DEFAULT_CLOSE_DELAY = 250
const ARROW_SIZE = 8.125
const ARROW_INSET = 12

const tooltipStyles = tv({
	slots: {
		base: 'pointer-events-none fixed left-0 top-0 isolate z-10000001 select-none overflow-visible',
		content: 'relative z-10 max-w-80 leading-inherit rounded-lg bg-neutral-950 px-4 py-2 text-xs font-medium whitespace-pre-wrap text-neutral-100 shadow-lg shadow-black/40',
		arrow: 'absolute z-0 size-2.5 rotate-45 bg-neutral-950 shadow-sm shadow-black/30',
	},
})

export type TooltipPlacement = 'top' | 'bottom' | 'start' | 'end'

export interface TooltipClassNames {
	readonly base?: ClassValue
	readonly content?: ClassValue
	readonly arrow?: ClassValue
}

export interface TooltipProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'content'> {
	readonly children: React.ReactNode
	readonly content?: React.ReactNode
	readonly placement?: TooltipPlacement
	readonly disabled?: boolean
	readonly autoFlip?: boolean
	readonly delay?: number
	readonly closeDelay?: number
	readonly portalContainer?: Element
	readonly classNames?: TooltipClassNames
	readonly offset?: number
	readonly trigger?: 'focus'
}

type TooltipPosition = {
	readonly top: number
	readonly left: number
	readonly placement: TooltipPlacement
	readonly arrowStyle: React.CSSProperties
}

function clearTimer(timerRef: React.RefObject<number | null>) {
	if (timerRef.current !== null) {
		window.clearTimeout(timerRef.current)
		timerRef.current = null
	}
}

function arrowOffset(center: number, size: number) {
	const maxInset = Math.max((size - ARROW_SIZE) / 2, 0)
	const inset = Math.min(ARROW_INSET, maxInset)
	return clamp(center - ARROW_SIZE / 2, inset, size - ARROW_SIZE - inset)
}

function oppositePlacement(placement: TooltipPlacement): TooltipPlacement {
	if (placement === 'top') return 'bottom'
	if (placement === 'bottom') return 'top'
	if (placement === 'start') return 'end'
	return 'start'
}

function placementSpace(triggerRect: DOMRect, placement: TooltipPlacement, viewportWidth: number, viewportHeight: number) {
	if (placement === 'top') return triggerRect.top - VIEWPORT_PADDING
	if (placement === 'bottom') return viewportHeight - triggerRect.bottom - VIEWPORT_PADDING
	if (placement === 'start') return triggerRect.left - VIEWPORT_PADDING
	return viewportWidth - triggerRect.right - VIEWPORT_PADDING
}

function placementSize(tooltipRect: DOMRect, placement: TooltipPlacement, offset: number) {
	if (placement === 'top' || placement === 'bottom') return tooltipRect.height + offset
	return tooltipRect.width + offset
}

function computeTooltipPosition(triggerRect: DOMRect, tooltipRect: DOMRect, placement: TooltipPlacement, shouldFlip: boolean, offset: number): TooltipPosition {
	const viewportWidth = window.innerWidth
	const viewportHeight = window.innerHeight
	const opposite = oppositePlacement(placement)
	const preferredSpace = placementSpace(triggerRect, placement, viewportWidth, viewportHeight)
	const oppositeSpace = placementSpace(triggerRect, opposite, viewportWidth, viewportHeight)
	const preferredFits = preferredSpace >= placementSize(tooltipRect, placement, offset)
	const oppositeFits = oppositeSpace >= placementSize(tooltipRect, opposite, offset)

	let actualPlacement = placement

	if (shouldFlip && !preferredFits) {
		if (oppositeFits || oppositeSpace > preferredSpace) {
			actualPlacement = opposite
		}
	}

	let left = 0
	let top = 0

	if (actualPlacement === 'top') {
		left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
		top = triggerRect.top - tooltipRect.height - offset
	} else if (actualPlacement === 'bottom') {
		left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
		top = triggerRect.bottom + offset
	} else if (actualPlacement === 'start') {
		left = triggerRect.left - tooltipRect.width - offset
		top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2
	} else {
		left = triggerRect.right + offset
		top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2
	}

	left = clamp(left, VIEWPORT_PADDING, viewportWidth - tooltipRect.width - VIEWPORT_PADDING)
	top = clamp(top, VIEWPORT_PADDING, viewportHeight - tooltipRect.height - VIEWPORT_PADDING)

	const centerX = triggerRect.left + triggerRect.width / 2 - left
	const centerY = triggerRect.top + triggerRect.height / 2 - top

	if (actualPlacement === 'top') return { top, left, placement: actualPlacement, arrowStyle: { left: arrowOffset(centerX, tooltipRect.width), bottom: -ARROW_SIZE / 2 } }
	if (actualPlacement === 'bottom') return { top, left, placement: actualPlacement, arrowStyle: { left: arrowOffset(centerX, tooltipRect.width), top: -ARROW_SIZE / 2 } }
	if (actualPlacement === 'start') return { top, left, placement: actualPlacement, arrowStyle: { top: arrowOffset(centerY, tooltipRect.height), right: -ARROW_SIZE / 2 } }
	return { top, left, placement: actualPlacement, arrowStyle: { top: arrowOffset(centerY, tooltipRect.height), left: -ARROW_SIZE / 2 } }
}

function hasTooltipContent(content: React.ReactNode) {
	return content !== undefined && content !== null && content !== false
}

function samePosition(a: TooltipPosition | null, b: TooltipPosition | null) {
	if (a === b) return true
	if (a === null || b === null) return false
	return a.top === b.top && a.left === b.left && a.placement === b.placement && a.arrowStyle.top === b.arrowStyle.top && a.arrowStyle.right === b.arrowStyle.right && a.arrowStyle.bottom === b.arrowStyle.bottom && a.arrowStyle.left === b.arrowStyle.left
}

export function Tooltip({ autoFlip = true, children, className, classNames, closeDelay = DEFAULT_CLOSE_DELAY, content, delay = 0, id, disabled = false, offset = DEFAULT_OFFSET, placement = 'bottom', portalContainer, ref, style, trigger, ...props }: TooltipProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [position, setPosition] = useState<TooltipPosition | null>(null)
	const tooltipRef = useRef<HTMLDivElement | null>(null)
	const triggerElementRef = useRef<HTMLElement | null>(null)
	const showTimerRef = useRef<number | null>(null)
	const hideTimerRef = useRef<number | null>(null)
	const hoveringRef = useRef(false)
	const focusingRef = useRef(false)
	const mounted = typeof document !== 'undefined'
	const tooltipContainer = portalContainer ?? (mounted ? document.body : undefined)
	const visible = hasTooltipContent(content) && !disabled && isOpen
	const styles = tooltipStyles()

	const hideTooltip = useEffectEvent(() => {
		clearTimer(showTimerRef)
		clearTimer(hideTimerRef)
		setIsOpen(false)
		setPosition(null)
	})

	const scheduleOpen = useEffectEvent((element?: EventTarget | null) => {
		if (!mounted || disabled || !hasTooltipContent(content)) return
		if (element instanceof HTMLElement) {
			triggerElementRef.current = element
		}

		clearTimer(hideTimerRef)

		if (isOpen) {
			return
		}

		clearTimer(showTimerRef)

		if (delay <= 0) {
			setIsOpen(true)
			return
		}

		showTimerRef.current = window.setTimeout(() => {
			showTimerRef.current = null
			if ((hoveringRef.current || focusingRef.current) && !disabled) {
				setIsOpen(true)
			}
		}, delay)
	})

	const scheduleClose = useEffectEvent(() => {
		clearTimer(showTimerRef)

		if (hoveringRef.current || focusingRef.current) {
			return
		}

		clearTimer(hideTimerRef)

		if (closeDelay <= 0) {
			setIsOpen(false)
			setPosition(null)
			return
		}

		hideTimerRef.current = window.setTimeout(() => {
			hideTimerRef.current = null
			if (!hoveringRef.current && !focusingRef.current) {
				setIsOpen(false)
				setPosition(null)
			}
		}, closeDelay)
	})

	const updatePosition = useEffectEvent(() => {
		if (!visible || !triggerElementRef.current || !tooltipRef.current) return
		if (!triggerElementRef.current.isConnected) {
			hideTooltip()
			return
		}

		const nextPosition = computeTooltipPosition(triggerElementRef.current.getBoundingClientRect(), tooltipRef.current.getBoundingClientRect(), placement, autoFlip, offset)
		setPosition((currentPosition) => (samePosition(currentPosition, nextPosition) ? currentPosition : nextPosition))
	})

	useEffect(() => {
		return () => {
			clearTimer(showTimerRef)
			clearTimer(hideTimerRef)
		}
	}, [])

	useEffect(() => {
		if (disabled || !hasTooltipContent(content)) {
			hoveringRef.current = false
			focusingRef.current = false
			hideTooltip()
		}
	}, [content, disabled])

	useEffect(() => {
		if (!visible) return

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				hoveringRef.current = false
				focusingRef.current = false
				hideTooltip()
			}
		}

		document.addEventListener('keydown', handleKeyDown)

		return () => {
			document.removeEventListener('keydown', handleKeyDown)
		}
	}, [visible])

	useLayoutEffect(() => {
		if (!visible) return

		updatePosition()

		const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => updatePosition())
		if (triggerElementRef.current) resizeObserver?.observe(triggerElementRef.current)
		if (tooltipRef.current) resizeObserver?.observe(tooltipRef.current)

		function handleViewportChange() {
			updatePosition()
		}

		window.addEventListener('resize', handleViewportChange)
		window.addEventListener('scroll', handleViewportChange, true)

		return () => {
			resizeObserver?.disconnect()
			window.removeEventListener('resize', handleViewportChange)
			window.removeEventListener('scroll', handleViewportChange, true)
		}
	}, [autoFlip, offset, placement, visible])

	function handlePointerEnter(event: React.PointerEvent<HTMLElement>) {
		if (trigger === 'focus' || event.pointerType === 'touch') return
		hoveringRef.current = true
		scheduleOpen(event.currentTarget)
	}

	function handlePointerLeave() {
		hoveringRef.current = false
		scheduleClose()
	}

	function handleFocus(event: React.FocusEvent<HTMLElement>) {
		focusingRef.current = true
		scheduleOpen(event.currentTarget)
	}

	function handleBlur(event: React.FocusEvent<HTMLElement>) {
		if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
		focusingRef.current = false
		scheduleClose()
	}

	return (
		<>
			<span className='w-fit' onBlur={handleBlur} onFocus={handleFocus} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
				{children}
			</span>
			{visible && tooltipContainer
				? createPortal(
						<div
							{...props}
							className={tw(styles.base(), className, classNames?.base)}
							data-placement={position?.placement ?? placement}
							ref={(node) => {
								tooltipRef.current = node
								assignRef(ref, node)
							}}
							role='tooltip'
							style={{
								...style,
								left: position?.left ?? 0,
								top: position?.top ?? 0,
								visibility: position ? 'visible' : 'hidden',
							}}>
							<span aria-hidden className={tw(styles.arrow(), classNames?.arrow)} style={position?.arrowStyle} />
							<div className={tw(styles.content(), classNames?.content, 'pointer-events-none')}>{content}</div>
						</div>,
						tooltipContainer,
					)
				: null}
		</>
	)
}
