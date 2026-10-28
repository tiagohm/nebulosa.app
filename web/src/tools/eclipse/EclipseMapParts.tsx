import { cn } from 'cn'
import { type ReactNode, useState } from 'react'
import { IconButton } from '../../ui/IconButton'

// Pieces of the eclipse map tools shared by the solar and the lunar map: the heading of the eclipse shown, between
// its Previous and Next buttons, and the legend box at the bottom left of the map. Below the sm breakpoint the
// heading puts the type and the date on two lines, and the legend starts collapsed to a button so it does not cover
// the map.

export interface EclipseHeadingProps {
	// Type of the eclipse shown, such as "Total solar eclipse"; absent until one is shown.
	readonly type?: string
	// UTC date of the greatest eclipse; absent until one is shown.
	readonly date?: string
	// Text shown while no eclipse is.
	readonly fallback: string
}

// Heading of the eclipse shown: its type and date on one line, or on two below the sm breakpoint.
export function EclipseHeading({ type, date, fallback }: EclipseHeadingProps) {
	return (
		<span className="flex min-w-0 flex-col text-[13px] leading-4 font-medium text-ink-100 sm:flex-row sm:gap-1">
			{type && date ? (
				<>
					<span className="min-w-0 truncate">{type}</span>
					<span className="flex-none max-sm:text-xs max-sm:font-normal max-sm:text-ink-300">
						<span className="max-sm:hidden">· </span>
						{date}
					</span>
				</>
			) : (
				<span className="truncate">{fallback}</span>
			)}
		</span>
	)
}

export interface EclipseMapLegendProps {
	// Lines of the legend, one under the other.
	readonly children: ReactNode
	// Whether clicks on the legend reach the map under it above the sm breakpoint, for a legend without controls.
	readonly passThrough?: boolean
}

// Legend of an eclipse map. Below the sm breakpoint it starts collapsed to a button that opens it, and once open it
// has a button that collapses it again; above it the legend is always shown.
export function EclipseMapLegend({ children, passThrough = false }: EclipseMapLegendProps) {
	const [open, setOpen] = useState(false)

	return (
		<>
			{!open && <IconButton icon="layers" label="Show legend" onClick={() => setOpen(true)} className="absolute bottom-9 left-3 border border-line-100 bg-base-100/80 sm:hidden" />}
			<div className={cn('absolute bottom-9 left-3 flex max-w-[calc(100%-1.5rem)] items-start gap-2 rounded-sm border border-line-100 bg-base-100/80 px-2.5 py-2 text-xs leading-4 text-ink-200', !open && 'max-sm:hidden', passThrough && 'sm:pointer-events-none')}>
				<div className="flex min-w-0 flex-col gap-1">{children}</div>
				<IconButton icon="close" label="Hide legend" onClick={() => setOpen(false)} className="-my-1.5 -mr-1.5 sm:hidden" />
			</div>
		</>
	)
}
