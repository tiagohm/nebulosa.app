import type { ReactNode } from 'react'

// Row of the command buttons of a panel section, which wraps on narrow panels.

// Buttons of a section, in a row that wraps.
export function Actions({ children }: { readonly children: ReactNode }) {
	return <div className="flex flex-wrap items-center gap-2">{children}</div>
}
