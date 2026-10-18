import { useEffect, useRef } from 'react'
import { Celestial, type CelestialOptions } from './celestial/celestial'

// React host of the Celestial star map. The map is created once per mount, with the container's size
// at that moment, and destroyed on unmount; a ResizeObserver keeps its canvas the size of the container
// as panels open and close or the window resizes. Options are read only at creation: everything that
// changes later goes through Celestial methods, so React rerenders never recreate the map.

export interface SkyViewProps {
	// Construction options of the map, read once.
	readonly options: CelestialOptions
	// Called with the new map; the returned function runs before the map is destroyed.
	readonly onReady: (celestial: Celestial) => VoidFunction
}

// Container of the star map.
export function SkyView({ options, onReady }: SkyViewProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const optionsRef = useRef(options)
	const onReadyRef = useRef(onReady)

	useEffect(() => {
		const container = containerRef.current!
		const rect = container.getBoundingClientRect()
		const celestial = new Celestial(container, { ...optionsRef.current, width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) })
		const cleanup = onReadyRef.current(celestial)

		const resizeObserver = new ResizeObserver(([entry]) => {
			if (entry) celestial.resize(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height))
		})

		resizeObserver.observe(container)

		return () => {
			resizeObserver.disconnect()
			cleanup()
			celestial.destroy()
		}
	}, [])

	return <div ref={containerRef} className="relative h-full w-full touch-none overflow-hidden select-none" />
}
