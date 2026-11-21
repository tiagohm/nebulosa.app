import { type RefObject, useEffect, useRef } from 'react'

// Light dismissal of a floating panel anchored to a root element (its button and the panel inside it): a press outside
// the root, or Escape anywhere in the page. Escape is left to whatever handled it first, such as an open select, and to
// an open dialog inside the panel, which closes itself instead.

// How a floating panel was dismissed: a press outside its root, or Escape.
export type LightDismissReason = 'outside' | 'escape'

// Calls onDismiss while open when a press lands outside root, or when Escape is pressed and neither a control nor an open
// dialog handled it. Listens only while open; onDismiss may change on every render without the listeners being replaced.
export function useLightDismiss(open: boolean, root: RefObject<HTMLElement | null>, onDismiss: (reason: LightDismissReason) => void) {
	const dismiss = useRef(onDismiss)

	useEffect(() => {
		dismiss.current = onDismiss
	})

	useEffect(() => {
		if (!open) return

		function handlePointerDown(e: MouseEvent) {
			if (e.target instanceof Node && !root.current?.contains(e.target)) dismiss.current('outside')
		}

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key !== 'Escape' || e.defaultPrevented) return
			if (e.target instanceof Element && e.target.closest('dialog[open]')) return
			dismiss.current('escape')
		}

		document.addEventListener('mousedown', handlePointerDown)
		document.addEventListener('keydown', handleKeyDown)

		return () => {
			document.removeEventListener('mousedown', handlePointerDown)
			document.removeEventListener('keydown', handleKeyDown)
		}
	}, [open, root])
}
