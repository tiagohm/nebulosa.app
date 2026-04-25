import { Children, useEffect, useMemo, useRef, useState } from 'react'
import { type ClassValue, tv } from 'tailwind-variants'
import { assignRef, clamp, tw } from '@/shared/util'

const DEFAULT_ITEM_HEIGHT = 40
const DEFAULT_OVERSCAN = 3

const listStyles = tv({
	slots: {
		base: 'relative block min-h-0 max-h-80 min-w-0 overflow-x-hidden overflow-y-auto rounded-lg bg-neutral-900/70 text-neutral-100',
		spacer: 'relative w-full min-w-0',
		item: 'absolute left-0 top-0 w-full min-w-0 overflow-hidden hover:bg-neutral-800',
		empty: 'flex min-h-10 items-center px-4 text-sm text-neutral-500',
	},
	variants: {
		fullWidth: {
			true: {
				base: 'w-full',
			},
		},
	},
})

export type ListItemRenderer = (index: number) => React.ReactNode

export interface ListClassNames {
	readonly base?: ClassValue
	readonly spacer?: ClassValue
	readonly item?: ClassValue
	readonly empty?: ClassValue
}

export interface ListProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children'> {
	readonly children?: React.ReactNode | ListItemRenderer
	readonly classNames?: ListClassNames
	readonly emptyContent?: React.ReactNode
	readonly fullWidth?: boolean
	readonly itemHeight?: number
	readonly overscan?: number
	readonly itemCount?: number
}

// Normalizes row height so virtual range math always has a positive divisor.
function normalizeItemHeight(itemHeight: number | undefined) {
	return itemHeight !== undefined && Number.isFinite(itemHeight) && itemHeight > 0 ? itemHeight : DEFAULT_ITEM_HEIGHT
}

// Normalizes overscan into a non-negative item count.
function normalizeOverscan(overscan: number | undefined) {
	return overscan !== undefined && Number.isFinite(overscan) ? Math.max(0, Math.trunc(overscan)) : DEFAULT_OVERSCAN
}

// Normalizes item count into a non-negative number.
function normalizeItemCount(itemCount: number | undefined) {
	return itemCount !== undefined && Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0
}

// Calculates the inclusive-start and exclusive-end range that should be mounted.
function virtualRange(itemCount: number, itemHeight: number, overscan: number, scrollTop: number, viewportHeight: number) {
	if (itemCount <= 0) return { endIndex: 0, startIndex: 0 }

	const maxScrollTop = Math.max(0, itemCount * itemHeight - viewportHeight)
	const clampedScrollTop = clamp(scrollTop, 0, maxScrollTop)
	const firstVisibleIndex = clamp(Math.floor(clampedScrollTop / itemHeight), 0, itemCount - 1)
	const visibleItemCount = Math.max(1, Math.ceil(viewportHeight / itemHeight) + 1)
	const startIndex = Math.max(0, firstVisibleIndex - overscan)
	const endIndex = Math.min(itemCount, firstVisibleIndex + visibleItemCount + overscan)

	return { endIndex, startIndex }
}

// Builds the visible item wrappers without copying a window of the full item array.
function virtualItems(items: readonly React.ReactNode[] | ListItemRenderer, startIndex: number, endIndex: number, itemHeight: number, itemClassName: string) {
	const elements = new Array<React.ReactNode>(endIndex - startIndex)
	const render = items instanceof Function ? items : (i: number) => items[i]

	for (let itemIndex = startIndex, p = 0; itemIndex < endIndex; itemIndex++, p++) {
		const slotIndex = itemIndex - startIndex

		elements[p] = (
			<div className={itemClassName} key={slotIndex} style={{ height: itemHeight, transform: `translateY(${itemIndex * itemHeight}px)` }}>
				{render(itemIndex)}
			</div>
		)
	}

	return elements
}

// Renders a fixed-height vertical list with only visible children mounted.
export function List({ children, itemCount, className, classNames, emptyContent, fullWidth, itemHeight, onScroll, overscan, ref, ...props }: ListProps) {
	const items = useMemo(() => (children instanceof Function ? [] : Children.toArray(children)), [children])
	const length = children instanceof Function ? normalizeItemCount(itemCount) : items.length
	const normalizedItemHeight = normalizeItemHeight(itemHeight)
	const normalizedOverscan = normalizeOverscan(overscan)
	const styles = listStyles({ fullWidth })
	const viewportRef = useRef<HTMLDivElement | null>(null)
	const scrollTopRef = useRef(0)
	const animationFrameRef = useRef<number | undefined>(undefined)
	const [scrollTop, setScrollTop] = useState(0)
	const [viewportHeight, setViewportHeight] = useState(0)
	const range = virtualRange(length, normalizedItemHeight, normalizedOverscan, scrollTop, viewportHeight)
	const totalHeight = length * normalizedItemHeight
	const itemClassName = tw(styles.item(), classNames?.item)
	const mountedItems = useMemo(() => virtualItems(children instanceof Function ? children : items, range.startIndex, range.endIndex, normalizedItemHeight, itemClassName), [items, range.startIndex, range.endIndex, normalizedItemHeight, itemClassName])

	// Measures the scroll viewport and keeps the virtual range aligned to resize.
	useEffect(() => {
		const viewport = viewportRef.current
		if (viewport === null) return
		const observedViewport = viewport

		function updateViewport() {
			scrollTopRef.current = observedViewport.scrollTop
			setScrollTop(observedViewport.scrollTop)
			setViewportHeight(observedViewport.clientHeight)
		}

		updateViewport()

		const observer = new ResizeObserver(updateViewport)
		observer.observe(observedViewport)

		return () => {
			observer.disconnect()
		}
	}, [])

	// Cancels any pending scroll frame when the list unmounts.
	useEffect(() => {
		return () => {
			if (animationFrameRef.current !== undefined) {
				window.cancelAnimationFrame(animationFrameRef.current)
			}
		}
	}, [])

	// Keeps scroll position valid when children or item size shrink the list.
	useEffect(() => {
		const viewport = viewportRef.current
		if (viewport === null) return

		const maxScrollTop = Math.max(0, totalHeight - viewportHeight)

		if (viewport.scrollTop <= maxScrollTop) return

		viewport.scrollTop = maxScrollTop
		scrollTopRef.current = maxScrollTop
		setScrollTop(maxScrollTop)
	}, [totalHeight, viewportHeight])

	// Stores the viewport element while preserving the caller ref.
	function handleViewportRef(element: HTMLDivElement | null) {
		viewportRef.current = element
		assignRef(ref, element)
	}

	// Updates scroll position at most once per animation frame.
	function handleScroll(event: React.UIEvent<HTMLDivElement>) {
		onScroll?.(event)
		scrollTopRef.current = event.currentTarget.scrollTop

		if (animationFrameRef.current !== undefined) return

		animationFrameRef.current = window.requestAnimationFrame(() => {
			animationFrameRef.current = undefined
			setScrollTop(scrollTopRef.current)
		})
	}

	return (
		<div {...props} className={tw(styles.base(), className, classNames?.base)} onScroll={handleScroll} ref={handleViewportRef}>
			{length === 0 && emptyContent !== undefined && emptyContent !== null ? (
				<div className={tw(styles.empty(), classNames?.empty)}>{emptyContent}</div>
			) : (
				<div className={tw(styles.spacer(), classNames?.spacer)} style={{ height: totalHeight }}>
					{mountedItems}
				</div>
			)}
		</div>
	)
}

export interface ListItemProps extends Omit<React.ComponentProps<'div'>, 'children'> {
	readonly description?: React.ReactNode
	readonly label?: React.ReactNode
	readonly startContent?: React.ReactNode
	readonly endContent?: React.ReactNode
	readonly disabled?: boolean
	readonly children?: React.ReactNode
}

export function ListItem({ className, description, label, children, startContent, endContent, disabled, ...props }: ListItemProps) {
	const content = children ?? label

	return (
		<div className={tw('inline-flex flex-col justify-center gap-0 p-3', className, disabled && 'opacity-70 pointer-events-none')} {...props}>
			{startContent}
			<div className="flex flex-col justify-center gap-0 p-3">
				{description && <span className="text-xs font-bold text-neutral-600 uppercase">{description}</span>}
				{content && <span className="overflow-auto whitespace-nowrap">{content}</span>}
			</div>
			{endContent}
		</div>
	)
}
