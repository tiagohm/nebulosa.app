import { useEffect, useRef } from 'react'
import type { Planetarium } from './planetarium'

// React host of the tab's star map. The map outlives this component: mounting attaches it to the page
// and starts its clock, unmounting detaches it and stops the clock, so switching workspaces never
// recreates the map or reloads its data.

export interface SkyViewProps {
	// Star map to show.
	readonly planetarium: Planetarium
}

// Container of the star map.
export function SkyView({ planetarium }: SkyViewProps) {
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		planetarium.attach(containerRef.current!)
		return () => planetarium.detach()
	}, [planetarium])

	return <div ref={containerRef} className="relative h-full w-full overflow-hidden" />
}
