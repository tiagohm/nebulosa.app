import { type RefObject, useEffect, useState } from 'react'

// Full screen of one element through the browser's own Fullscreen API: whether the element fills the screen now, which
// follows the browser (Escape and its own controls leave it too), whether the browser offers it at all, and the toggle.
// Floating panels inside the element (popovers, menus) and modal dialogs stay visible over it.

// State and toggle of the full screen of an element.
export interface Fullscreen {
	// Whether the element fills the screen.
	readonly active: boolean
	// Whether the browser lets the page fill the screen.
	readonly supported: boolean
	// Fills the screen with the element, or leaves the full screen; a refusal of the browser changes nothing.
	readonly toggle: () => void
}

// Follows and toggles the full screen of the element of ref.
export function useFullscreen(ref: RefObject<HTMLElement | null>): Fullscreen {
	const [active, setActive] = useState(false)

	useEffect(() => {
		const update = () => setActive(ref.current !== null && document.fullscreenElement === ref.current)
		document.addEventListener('fullscreenchange', update)
		return () => document.removeEventListener('fullscreenchange', update)
	}, [ref])

	function toggle() {
		// A refusal (no user gesture, a browser policy) leaves the view as it is, which is what the operator sees.
		if (active) void document.exitFullscreen().catch(() => undefined)
		else void ref.current?.requestFullscreen().catch(() => undefined)
	}

	return { active, supported: document.fullscreenEnabled, toggle }
}
