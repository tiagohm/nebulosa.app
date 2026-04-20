import type * as React from 'react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type ClassValue, tv } from 'tailwind-variants'
import { assignRef, clamp, tw } from '@/shared/util'

const VIEWPORT_PADDING = 12
const ARROW_SIZE = 8.125
const ARROW_INSET = 12

const floatingContentStyles = tv({
	slots: {
		base: 'fixed left-0 top-0 isolate z-10000001 overflow-visible',
		content: 'relative z-10 max-w-80 leading-inherit rounded-lg bg-neutral-950 p-3 text-xs font-medium whitespace-pre-wrap text-neutral-100 shadow-lg shadow-black/40',
		arrow: 'pointer-events-none absolute z-0 size-2.5 rotate-45 bg-neutral-950 shadow-sm shadow-black/30',
	},
	variants: {
		interactive: {
			true: {
				base: 'pointer-events-none',
				content: 'pointer-events-auto select-auto',
			},
			false: {
				base: 'pointer-events-none select-none',
				content: 'pointer-events-none select-none',
			},
		},
	},
	defaultVariants: {
		interactive: false,
	},
})

export const DEFAULT_FLOATING_OFFSET = 10

export type FloatingPlacement = 'top' | 'bottom' | 'start' | 'end'

export interface FloatingClassNames {
	readonly base?: ClassValue
	readonly content?: ClassValue
	readonly arrow?: ClassValue
}

type FloatingPosition = {
	readonly top: number
	readonly left: number
	readonly placement: FloatingPlacement
	readonly arrowStyle: React.CSSProperties
}

export interface FloatingProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'content'> {
	readonly content?: React.ReactNode
	readonly open?: boolean
	readonly placement?: FloatingPlacement
	readonly triggerElement?: HTMLElement | null
	readonly autoFlip?: boolean
	readonly portalContainer?: Element
	readonly classNames?: FloatingClassNames
	readonly offset?: number
	readonly interactive?: boolean
	readonly closeOnEscape?: boolean
	readonly closeOnPointerDownOutside?: boolean
	readonly onOpenChange?: (open: boolean) => void
}

// Clamps the arrow so it stays inset from the overlay edges.
function arrowOffset(center: number, size: number) {
	const maxInset = Math.max((size - ARROW_SIZE) / 2, 0)
	const inset = Math.min(ARROW_INSET, maxInset)
	return clamp(center - ARROW_SIZE / 2, inset, size - ARROW_SIZE - inset)
}

// Resolves the opposite placement for auto-flipping.
function oppositePlacement(placement: FloatingPlacement): FloatingPlacement {
	if (placement === 'top') return 'bottom'
	if (placement === 'bottom') return 'top'
	if (placement === 'start') return 'end'
	return 'start'
}

// Measures the free viewport space for a specific placement.
function placementSpace(triggerRect: DOMRect, placement: FloatingPlacement, viewportWidth: number, viewportHeight: number) {
	if (placement === 'top') return triggerRect.top - VIEWPORT_PADDING
	if (placement === 'bottom') return viewportHeight - triggerRect.bottom - VIEWPORT_PADDING
	if (placement === 'start') return triggerRect.left - VIEWPORT_PADDING
	return viewportWidth - triggerRect.right - VIEWPORT_PADDING
}

// Measures how much space an overlay needs for a specific placement.
function placementSize(contentRect: DOMRect, placement: FloatingPlacement, offset: number) {
	if (placement === 'top' || placement === 'bottom') return contentRect.height + offset
	return contentRect.width + offset
}

// Computes the fixed-position coordinates and arrow placement for the overlay.
function computeFloatingPosition(triggerRect: DOMRect, contentRect: DOMRect, placement: FloatingPlacement, shouldFlip: boolean, offset: number): FloatingPosition {
	const viewportWidth = window.innerWidth
	const viewportHeight = window.innerHeight
	const opposite = oppositePlacement(placement)
	const preferredSpace = placementSpace(triggerRect, placement, viewportWidth, viewportHeight)
	const oppositeSpace = placementSpace(triggerRect, opposite, viewportWidth, viewportHeight)
	const preferredFits = preferredSpace >= placementSize(contentRect, placement, offset)
	const oppositeFits = oppositeSpace >= placementSize(contentRect, opposite, offset)

	let actualPlacement = placement

	if (shouldFlip && !preferredFits && (oppositeFits || oppositeSpace > preferredSpace)) {
		actualPlacement = opposite
	}

	let left = 0
	let top = 0

	if (actualPlacement === 'top') {
		left = triggerRect.left + triggerRect.width / 2 - contentRect.width / 2
		top = triggerRect.top - contentRect.height - offset
	} else if (actualPlacement === 'bottom') {
		left = triggerRect.left + triggerRect.width / 2 - contentRect.width / 2
		top = triggerRect.bottom + offset
	} else if (actualPlacement === 'start') {
		left = triggerRect.left - contentRect.width - offset
		top = triggerRect.top + triggerRect.height / 2 - contentRect.height / 2
	} else {
		left = triggerRect.right + offset
		top = triggerRect.top + triggerRect.height / 2 - contentRect.height / 2
	}

	left = clamp(left, VIEWPORT_PADDING, viewportWidth - contentRect.width - VIEWPORT_PADDING)
	top = clamp(top, VIEWPORT_PADDING, viewportHeight - contentRect.height - VIEWPORT_PADDING)

	const centerX = triggerRect.left + triggerRect.width / 2 - left
	const centerY = triggerRect.top + triggerRect.height / 2 - top

	if (actualPlacement === 'top') return { top, left, placement: actualPlacement, arrowStyle: { left: arrowOffset(centerX, contentRect.width), bottom: -ARROW_SIZE / 2 } }
	if (actualPlacement === 'bottom') return { top, left, placement: actualPlacement, arrowStyle: { left: arrowOffset(centerX, contentRect.width), top: -ARROW_SIZE / 2 } }
	if (actualPlacement === 'start') return { top, left, placement: actualPlacement, arrowStyle: { top: arrowOffset(centerY, contentRect.height), right: -ARROW_SIZE / 2 } }
	return { top, left, placement: actualPlacement, arrowStyle: { top: arrowOffset(centerY, contentRect.height), left: -ARROW_SIZE / 2 } }
}

// Avoids unnecessary position state updates while the overlay stays stable.
function samePosition(left: FloatingPosition | null, right: FloatingPosition | null) {
	if (left === right) return true
	if (left === null || right === null) return false
	return left.top === right.top && left.left === right.left && left.placement === right.placement && left.arrowStyle.top === right.arrowStyle.top && left.arrowStyle.right === right.arrowStyle.right && left.arrowStyle.bottom === right.arrowStyle.bottom && left.arrowStyle.left === right.arrowStyle.left
}

// Renders the shared floating surface used by tooltip-like and popover-like components.
export function Floating({
	autoFlip = true,
	className,
	classNames,
	content,
	closeOnEscape = false,
	closeOnPointerDownOutside = false,
	id,
	open = false,
	interactive = false,
	offset = DEFAULT_FLOATING_OFFSET,
	onOpenChange,
	placement = 'bottom',
	portalContainer,
	ref,
	role,
	style,
	triggerElement,
	...props
}: FloatingProps) {
	const [position, setPosition] = useState<FloatingPosition | null>(null)
	const contentRef = useRef<HTMLDivElement | null>(null)
	const mounted = typeof document !== 'undefined'
	const contentContainer = portalContainer ?? (mounted ? document.body : undefined)
	const hasContent = content !== undefined && content !== null && content !== false
	const rendered = mounted && open && hasContent && !!triggerElement
	const styles = floatingContentStyles({ interactive })

	// Reports requested open-state changes back to the caller.
	const requestOpenChange = useEffectEvent((nextOpen: boolean) => {
		if (nextOpen !== open) {
			onOpenChange?.(nextOpen)
		}
	})

	// Recomputes the overlay position from the current trigger and content rectangles.
	const updatePosition = useEffectEvent(() => {
		if (!rendered || !triggerElement || !contentRef.current) return
		if (!triggerElement.isConnected) {
			requestOpenChange(false)
			return
		}

		const nextPosition = computeFloatingPosition(triggerElement.getBoundingClientRect(), contentRef.current.getBoundingClientRect(), placement, autoFlip, offset)
		setPosition((currentPosition) => (samePosition(currentPosition, nextPosition) ? currentPosition : nextPosition))
	})

	// Resets the cached position whenever the overlay is hidden.
	useEffect(() => {
		if (!rendered) {
			setPosition(null)
		}
	}, [rendered])

	// Handles global close interactions like Escape and outside pointer presses.
	useEffect(() => {
		if (!rendered) return

		function handleKeyDown(event: KeyboardEvent) {
			if (closeOnEscape && event.key === 'Escape') {
				requestOpenChange(false)
			}
		}

		function handlePointerDown(event: PointerEvent) {
			if (!closeOnPointerDownOutside || !contentRef.current) return
			if (!(event.target instanceof Node)) return
			if (contentRef.current.contains(event.target)) return
			if (triggerElement?.contains(event.target)) return
			requestOpenChange(false)
		}

		document.addEventListener('keydown', handleKeyDown)
		document.addEventListener('pointerdown', handlePointerDown)

		return () => {
			document.removeEventListener('keydown', handleKeyDown)
			document.removeEventListener('pointerdown', handlePointerDown)
		}
	}, [closeOnEscape, closeOnPointerDownOutside, rendered, requestOpenChange, triggerElement])

	// Keeps the overlay aligned while the viewport, trigger, or content changes.
	useLayoutEffect(() => {
		if (!rendered) return

		updatePosition()

		const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => updatePosition())
		if (triggerElement) resizeObserver?.observe(triggerElement)
		if (contentRef.current) resizeObserver?.observe(contentRef.current)

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
	}, [autoFlip, offset, placement, rendered, triggerElement, updatePosition])

	if (!rendered || !contentContainer) return null

	return createPortal(
		<div
			{...props}
			className={tw(styles.base(), className, classNames?.base)}
			data-placement={position?.placement ?? placement}
			id={id}
			ref={(node) => {
				contentRef.current = node
				assignRef(ref, node)
			}}
			role={role}
			style={{
				...style,
				left: position?.left ?? 0,
				top: position?.top ?? 0,
				visibility: position ? 'visible' : 'hidden',
			}}>
			<span aria-hidden className={tw(styles.arrow(), classNames?.arrow)} style={position?.arrowStyle} />
			<div className={tw(styles.content(), classNames?.content)}>{content}</div>
		</div>,
		contentContainer,
	)
}
