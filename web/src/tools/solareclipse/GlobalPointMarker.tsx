import { GLOBAL_POINTS, type GlobalPointKind } from './solareclipse'

// Markers of the global points of a solar eclipse, in screen pixels centered on the origin, one shape per family:
// a hollow circle for a contact of the penumbra, a hollow accent circle for one of the umbra, a filled accent dot
// for an end of the central line, a hollow diamond for an end of a partial limit, a target for the greatest
// eclipse, and a square for the greatest duration. The shape, not only the color, tells the families apart.

export interface GlobalPointMarkerProps {
	// Point drawn.
	readonly kind: GlobalPointKind
}

// Marker of a global point, as SVG elements; draw it inside a WorldMapSymbol or a small SVG.
export function GlobalPointMarker({ kind }: GlobalPointMarkerProps) {
	switch (GLOBAL_POINTS[kind].family) {
		case 'penumbralContact':
			return <circle r={3.5} className="fill-base-000 stroke-ink-200" strokeWidth={1.5} />
		case 'umbralContact':
			return <circle r={3.5} className="fill-base-000 stroke-accent" strokeWidth={1.5} />
		case 'centralLineEnd':
			return <circle r={3.5} className="fill-accent stroke-base-000" strokeWidth={1} />
		case 'limitEnd':
			return <rect x={-3} y={-3} width={6} height={6} transform="rotate(45)" className="fill-base-000 stroke-ink-200" strokeWidth={1.5} />
		case 'extreme':
			return kind === 'GD' ? (
				<rect x={-4} y={-4} width={8} height={8} className="fill-accent stroke-base-000" strokeWidth={1.5} />
			) : (
				<>
					<circle r={5} className="fill-base-000 stroke-ink-100" strokeWidth={1.5} />
					<circle r={2} className="fill-ink-100" />
				</>
			)
	}
}

// Marker of a global point in a box of its own, for lists and the legend.
export function GlobalPointIcon({ kind }: GlobalPointMarkerProps) {
	return (
		<svg viewBox="-7 -7 14 14" width={14} height={14} className="flex-none">
			<GlobalPointMarker kind={kind} />
		</svg>
	)
}
