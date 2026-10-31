import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { IconName } from './Icon'
import { IconButton } from './IconButton'

// Toolbar icon button that opens a small floating panel of controls below it. The panel is fixed to the viewport, so
// no scrolling or clipping ancestor of the toolbar cuts it, and is mounted only while open: whatever state its
// content keeps is discarded when it closes. It closes when the button is pressed again, on a press outside both,
// on Escape (unless a control inside it handled the key first, such as an open select), and when the window resizes.

// Width of the panel, in CSS pixels, when the viewport has room for it.
const PANEL_WIDTH = 288

// Smallest distance kept between the panel and the edges of the viewport, in CSS pixels.
const VIEWPORT_GUTTER = 16

// Distance between the button and the panel, in CSS pixels.
const PANEL_GAP = 4

export interface PopoverProps {
	// Icon of the button.
	readonly icon: IconName
	// Name of the button, shown as its tooltip, and heading of the panel.
	readonly label: string
	// Whether the panel is shown.
	readonly open: boolean
	// Called to show or hide the panel.
	readonly onOpenChange: (open: boolean) => void
	// Whether the button is disabled; a disabled popover closes.
	readonly disabled?: boolean
	// Controls of the panel, mounted only while it is open.
	readonly children: ReactNode
}

// Position of the panel in the viewport, in CSS pixels.
interface PanelPosition {
	// Distance from the top of the viewport.
	readonly top: number
	// Distance from the left of the viewport.
	readonly left: number
}

// Icon button with a floating panel.
export function Popover({ icon, label, open, onOpenChange, disabled = false, children }: PopoverProps) {
	const rootRef = useRef<HTMLSpanElement>(null)
	const [position, setPosition] = useState<PanelPosition>()

	// Places the panel under the button, aligned with its left edge but kept inside the viewport.
	function show() {
		const rect = rootRef.current?.getBoundingClientRect()
		if (!rect) return
		const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * VIEWPORT_GUTTER)
		setPosition({ top: rect.bottom + PANEL_GAP, left: Math.max(VIEWPORT_GUTTER, Math.min(rect.left, window.innerWidth - width - VIEWPORT_GUTTER)) })
		onOpenChange(true)
	}

	useEffect(() => {
		if (open && disabled) onOpenChange(false)
	}, [open, disabled, onOpenChange])

	useEffect(() => {
		if (!open) return

		function handlePointerDown(e: MouseEvent) {
			if (e.target instanceof Node && !rootRef.current?.contains(e.target)) onOpenChange(false)
		}

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key !== 'Escape' || e.defaultPrevented) return
			onOpenChange(false)
			rootRef.current?.querySelector('button')?.focus()
		}

		function handleResize() {
			onOpenChange(false)
		}

		document.addEventListener('mousedown', handlePointerDown)
		document.addEventListener('keydown', handleKeyDown)
		window.addEventListener('resize', handleResize)

		return () => {
			document.removeEventListener('mousedown', handlePointerDown)
			document.removeEventListener('keydown', handleKeyDown)
			window.removeEventListener('resize', handleResize)
		}
	}, [open, onOpenChange])

	return (
		<span ref={rootRef} className="flex flex-none">
			<IconButton icon={icon} label={label} pressed={open} disabled={disabled} onClick={() => (open ? onOpenChange(false) : show())} />
			{open && position && (
				<div style={{ top: position.top, left: position.left }} className="min-w-fit fixed z-30 box-border flex max-w-[calc(100vw-32px)] flex-col gap-2 rounded-md border border-line-100 bg-base-200 p-3 text-sm shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
					<h4 className="m-0 text-xs font-medium text-ink-100">{label}</h4>
					{children}
				</div>
			)}
		</span>
	)
}
