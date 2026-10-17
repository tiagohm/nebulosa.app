import { useSyncExternalStore } from 'react'

// React binding of CSS media queries, for layout decisions Tailwind classes alone cannot make, such as
// which panel state a toggle button changes.

// Media query of Tailwind's lg breakpoint (64rem), above which the contextual panel is a docked column.
export const WIDE_SCREEN = '(min-width: 64rem)'

// Returns whether a media query matches, updating when it starts or stops matching.
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const media = window.matchMedia(query)
			media.addEventListener('change', onChange)
			return () => media.removeEventListener('change', onChange)
		},
		() => window.matchMedia(query).matches,
	)
}
