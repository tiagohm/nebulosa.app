import { type RefObject, useEffect, useRef, useState } from 'react'

// Panels the status bar opens above one of its buttons, such as the status details and the Sky selection: placed in the
// viewport (fixed), so the clipping bar never cuts them, following the button when the window resizes, focused when they
// open so the keyboard goes on inside them, and closed when the button is pressed again, on a press outside, and on Escape,
// which returns the focus to the button. A dialog opened from inside a panel, such as a confirmation, belongs to it: a
// press or an Escape inside the dialog never closes the panel under it.

// Smallest distance kept between a panel and the edges of the viewport, in CSS pixels.
export const VIEWPORT_GUTTER = 16

// Distance between the button and its panel, in CSS pixels.
const PANEL_GAP = 4

// Height of the top bar a panel never covers, in CSS pixels.
const TOP_BAR_HEIGHT = 56

// Position and width of a panel in the viewport, in CSS pixels.
export interface PanelPlacement {
	// Distance from the bottom edge of the viewport to the bottom of the panel.
	readonly bottom: number
	// Distance from the right edge of the viewport to the right of the panel.
	readonly right: number
	// Width of the panel.
	readonly width: number
}

// Panel of a button of the bar, and what opens and closes it.
export interface BarPopover {
	// Element holding the button and the panel; a press inside it never closes the panel.
	readonly rootRef: RefObject<HTMLSpanElement | null>
	// Button the panel is aligned with and the focus returns to.
	readonly buttonRef: RefObject<HTMLButtonElement | null>
	// Panel, focused when it opens.
	readonly panelRef: RefObject<HTMLDivElement | null>
	// Where the panel is shown; absent while it is closed.
	readonly placement?: PanelPlacement
	// Opens the panel, or closes it when it is open.
	readonly toggle: () => void
	// Closes the panel.
	readonly close: () => void
}

// Returns the inline style of a panel at a placement: its edges, its width, and the most height it may take, below the top bar.
export function panelStyle({ bottom, right, width }: PanelPlacement) {
	return { bottom, right, width, maxHeight: `calc(100dvh - ${bottom + TOP_BAR_HEIGHT + VIEWPORT_GUTTER}px)` }
}

// Returns whether an event comes from inside an open dialog, which a panel never closes for.
function insideDialog(target: EventTarget | null) {
	return target instanceof Element && target.closest('dialog[open]') !== null
}

// Returns the panel of a button of the bar, `preferredWidth` CSS pixels wide when the viewport has room for it, its right
// edge aligned with the button's.
export function useBarPopover(preferredWidth: number): BarPopover {
	const [placement, setPlacement] = useState<PanelPlacement>()
	const rootRef = useRef<HTMLSpanElement>(null)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const open = !!placement

	// Returns where the panel goes: above the button, aligned with its right edge but kept inside the viewport, or
	// undefined while the button is not laid out.
	function place(): PanelPlacement | undefined {
		const rect = buttonRef.current?.getBoundingClientRect()
		if (!rect) return undefined
		const width = Math.min(preferredWidth, window.innerWidth - 2 * VIEWPORT_GUTTER)
		const right = Math.max(VIEWPORT_GUTTER, Math.min(window.innerWidth - rect.right, window.innerWidth - width - VIEWPORT_GUTTER))
		return { bottom: window.innerHeight - rect.top + PANEL_GAP, right, width }
	}

	// Moves the focus into the panel once it opened, so Tab goes on through its controls.
	useEffect(() => {
		if (open) panelRef.current?.focus()
	}, [open])

	useEffect(() => {
		if (!open) return

		function handlePointerDown(e: MouseEvent) {
			if (e.target instanceof Node && !rootRef.current?.contains(e.target) && !insideDialog(e.target)) setPlacement(undefined)
		}

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key !== 'Escape' || e.defaultPrevented || insideDialog(e.target)) return
			setPlacement(undefined)
			buttonRef.current?.focus()
		}

		// Follows the button, as when a phone's address bar hides or the device turns.
		function handleResize() {
			setPlacement(place())
		}

		document.addEventListener('mousedown', handlePointerDown)
		document.addEventListener('keydown', handleKeyDown)
		window.addEventListener('resize', handleResize)

		return () => {
			document.removeEventListener('mousedown', handlePointerDown)
			document.removeEventListener('keydown', handleKeyDown)
			window.removeEventListener('resize', handleResize)
		}
	}, [open])

	return { rootRef, buttonRef, panelRef, placement, toggle: () => setPlacement(open ? undefined : place()), close: () => setPlacement(undefined) }
}
