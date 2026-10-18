import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Celestial } from './celestial/celestial'
import { formatMagnitude } from './format'
import { type HoverLabel, hoverLabel, type MapNames } from './objects'

// Tooltip of the object under the pointer on the star map. It reuses the map's hover events and the data
// they carry, never querying the API. React state changes only when the hovered object changes; the
// tooltip follows the pointer by writing its position directly, kept inside the map. Hovering never
// changes the selection.

// Distance between the pointer and the tooltip in pixels.
const POINTER_OFFSET = 14

export interface HoverTooltipProps {
	// Map whose hover events the tooltip follows; absent before the map exists.
	readonly celestial?: Celestial
	// Map data that names the drawn objects, read when an object is hovered.
	readonly names: () => MapNames
}

// Tooltip of the hovered object.
export function HoverTooltip({ celestial, names }: HoverTooltipProps) {
	const [label, setLabel] = useState<HoverLabel>()
	const tooltipRef = useRef<HTMLDivElement>(null)
	// Last pointer position in map pixels.
	const pointer = useRef({ x: 0, y: 0 })
	const namesRef = useRef(names)
	namesRef.current = names

	// Moves the tooltip next to the pointer, flipping it to the other side near the map's edges.
	function place() {
		const element = tooltipRef.current
		const parent = element?.parentElement
		if (!element || !parent) return

		const { x, y } = pointer.current
		const left = x + POINTER_OFFSET + element.offsetWidth > parent.clientWidth ? x - POINTER_OFFSET - element.offsetWidth : x + POINTER_OFFSET
		const top = y + POINTER_OFFSET + element.offsetHeight > parent.clientHeight ? y - POINTER_OFFSET - element.offsetHeight : y + POINTER_OFFSET
		element.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, top)}px)`
	}

	useEffect(() => {
		if (!celestial) return

		const unsubscribe = [
			celestial.on('objectHover', ({ object }) => setLabel(hoverLabel(object, namesRef.current()))),
			celestial.on('objectLeave', () => setLabel(undefined)),
			celestial.on('hover', ({ x, y }) => {
				pointer.current.x = x
				pointer.current.y = y
				place()
			}),
		]

		return () => {
			for (const off of unsubscribe) off()
			setLabel(undefined)
		}
	}, [celestial])

	// A new label changes the tooltip's size, so it is placed again before it is painted.
	useLayoutEffect(place, [label])

	return (
		<div ref={tooltipRef} hidden={!label} className="pointer-events-none absolute top-0 left-0 z-10 max-w-64 rounded-sm border border-line-100 bg-base-200/95 px-2 py-1.5 shadow-[0_4px_16px_rgb(0_0_0/0.4)]">
			{label && (
				<>
					<p className="m-0 truncate text-[13px] font-medium text-ink-100">{label.name}</p>
					<p className="m-0 text-xs text-ink-300">
						{label.typeName}
						{label.magnitude !== undefined && label.magnitude < 99 && <span className="font-mono"> · mag {formatMagnitude(label.magnitude)}</span>}
					</p>
				</>
			)}
		</div>
	)
}
