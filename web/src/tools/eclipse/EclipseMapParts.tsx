import { cn } from 'cn'
import { type ReactNode, type Ref, useState } from 'react'
import { IconButton } from '../../ui/IconButton'
import type { ViewportPadding } from '../../ui/worldmap.geometry'

// Pieces of the eclipse map tools shared by the solar and the lunar map: the heading of the eclipse shown, between
// its Previous and Next buttons, the legend box at the bottom left of the map, and the room kept free around an
// eclipse framed on the map. Below the sm breakpoint the heading puts the type and the date on two lines; the legend
// starts collapsed to a button at every width so it does not cover the map.

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
		<span className="flex min-w-0 flex-col text-sm leading-4 font-medium text-ink-100 sm:flex-row sm:gap-1">
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
	// Whether clicks on the lines of the legend reach the map under it above the sm breakpoint, for lines without
	// controls; the button that hides the legend always takes its clicks.
	readonly passThrough?: boolean
	// Whether the legend is shown, for an owner that keeps it, such as across eclipses; absent, the legend keeps it
	// itself, collapsed at first.
	readonly open?: boolean
	// Called with whether the legend is shown when its button shows or hides it.
	readonly onOpenChange?: (open: boolean) => void
	// Box of the legend while shown, so the map can keep what it frames out from under it.
	readonly ref?: Ref<HTMLDivElement>
}

// Legend of an eclipse map, at every width collapsed at first to a button that opens it, and once open with a button
// that collapses it again, so it covers the map only on demand.
export function EclipseMapLegend({ children, passThrough = false, open, onOpenChange, ref }: EclipseMapLegendProps) {
	const [ownOpen, setOwnOpen] = useState(false)
	const shown = open ?? ownOpen

	function show(value: boolean) {
		setOwnOpen(value)
		onOpenChange?.(value)
	}

	return (
		<>
			{!shown && <IconButton icon="layers" label="Show legend" onClick={() => show(true)} className="absolute bottom-9 left-3 border border-line-100 bg-base-100/80" />}
			<div ref={ref} className={cn('absolute bottom-9 left-3 flex max-w-[calc(100%-1.5rem)] items-start gap-2 rounded-sm border border-line-100 bg-base-100/80 px-2.5 py-2 text-xs leading-4 text-ink-200', !shown && 'hidden', passThrough && 'sm:pointer-events-none')}>
				<div className="flex min-w-0 flex-col gap-1">{children}</div>
				<IconButton icon="close" label="Hide legend" onClick={() => show(false)} className="pointer-events-auto -my-1.5 -mr-1.5" />
			</div>
		</>
	)
}

// Room kept free around an eclipse framed on the map, in viewport pixels: the zoom buttons on the right, the coordinate
// readout at the bottom, and room for labels at the edges.
const FRAME_PADDING: ViewportPadding = { top: 24, right: 72, bottom: 36, left: 32 }

// Room between the legend and an eclipse framed beside or above it, in viewport pixels.
const LEGEND_GAP = 16

// Largest zoom of an eclipse framed on the map, as a multiple of the whole map, so a small region keeps its
// surroundings.
export const FRAME_MAX_ZOOM = 12

// Returns the room to keep free around an eclipse framed on the map, in viewport pixels: FRAME_PADDING, and while the
// legend (its box, null or hidden when it is not shown) covers the bottom-left corner, the room beside or above it,
// on the side that leaves the larger area.
export function framePadding(legend: HTMLElement | null): ViewportPadding {
	const box = legend?.parentElement
	if (!legend?.offsetParent || !box) return FRAME_PADDING

	const width = legend.offsetLeft + legend.offsetWidth + LEGEND_GAP
	const height = box.clientHeight - legend.offsetTop + LEGEND_GAP
	const beside = (box.clientWidth - width - FRAME_PADDING.right) * (box.clientHeight - FRAME_PADDING.top - FRAME_PADDING.bottom)
	const above = (box.clientWidth - FRAME_PADDING.left - FRAME_PADDING.right) * (box.clientHeight - height - FRAME_PADDING.top)
	return beside > above ? { ...FRAME_PADDING, left: width } : { ...FRAME_PADDING, bottom: height }
}
