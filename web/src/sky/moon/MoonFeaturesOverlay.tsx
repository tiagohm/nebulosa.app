import { cn } from 'cn'
import type { FeatureMarker } from './moon.features'
import type { DiscViewport } from './moon.geometry'

// Feature markers of the Lunar Surface Explorer, an SVG laid over the Moon drawing in the same CSS pixels: a dot at
// each official center point (never an outline), dimmed on the night side, a larger transparent target for pointers
// and touch, the name beside the markers that have room for it, outlined for contrast over bright and dark ground,
// and a ring around the selected feature. Only the markers given are drawn, a few hundred at most.

export interface MoonFeaturesOverlayProps {
	// Where the disk is drawn.
	readonly viewport: DiscViewport
	// Markers to draw.
	readonly markers: readonly FeatureMarker[]
	// Gazetteer id of the selected feature.
	readonly selected?: number
	// Called with the feature clicked or tapped.
	readonly onSelect: (id: number) => void
}

// Feature markers of the Lunar Surface Explorer.
export function MoonFeaturesOverlay({ viewport, markers, selected, onSelect }: MoonFeaturesOverlayProps) {
	return (
		<svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
			{markers.map(({ feature, x, y, dark, labeled, labelLeft }) => (
				<g key={feature.id} className={cn(dark && feature.id !== selected && 'opacity-60')}>
					<circle cx={x} cy={y} r={12} className="pointer-events-auto cursor-pointer fill-transparent" onClick={() => onSelect(feature.id)}>
						<title>{`${feature.name} · ${feature.descriptor}`}</title>
					</circle>
					<circle cx={x} cy={y} r={2.5} className="fill-amber-200 stroke-black/70" strokeWidth={1} />
					{feature.id === selected && <circle cx={x} cy={y} r={8} className="fill-none stroke-accent" strokeWidth={2} />}
					{labeled && (
						<text x={labelLeft ? x - 6 : x + 6} y={y} textAnchor={labelLeft ? 'end' : 'start'} dominantBaseline="middle" className={cn('fill-amber-50 stroke-black/80 text-[11px]', feature.id === selected && 'fill-accent font-semibold')} strokeWidth={3} paintOrder="stroke">
							{feature.name}
						</text>
					)}
				</g>
			))}
		</svg>
	)
}
