import type { LocalSolarEclipseSvgShape, SolarEclipseLocalView as LocalViewGeometry } from 'api'

// Local View of a solar eclipse: the toolkit's schematic of the Moon over the Sun as seen from a place at a
// contact, drawn from the shapes the API computed (in pixels, origin at the top-left corner, y down) without any
// geometry of its own. The Moon disk is opaque over the Sun, so the covered part of the Sun is dark, and the
// band below the horizon is drawn over both.

export interface SolarEclipseLocalViewProps {
	// Geometry to draw.
	readonly view: LocalViewGeometry
}

// Margin around the diagram, in pixels, so ghost disks near its edges stay inside.
const MARGIN = 24

// Classes of each shape, by role.
const SHAPE_CLASSES: Readonly<Record<LocalSolarEclipseSvgShape['role'], string>> = {
	ghostSunDisk: 'fill-none stroke-ink-300 [stroke-dasharray:2_2]',
	ghostMoonDisk: 'fill-none stroke-ink-300 [stroke-dasharray:2_2]',
	sunDisk: 'fill-ink-100 stroke-ink-100',
	moonDisk: 'fill-base-000 stroke-ink-300',
	solarLimb: 'fill-none stroke-ink-100',
	lunarLimb: 'fill-none stroke-ink-300',
	trajectoryLine: 'stroke-ink-300 [stroke-dasharray:4_3]',
	trajectoryPath: 'fill-none stroke-ink-300 [stroke-dasharray:4_3]',
	horizonBand: 'fill-danger/10',
	horizonLine: 'stroke-danger',
}

// Draws one shape.
function Shape({ shape }: { readonly shape: LocalSolarEclipseSvgShape }) {
	const className = SHAPE_CLASSES[shape.role]

	switch (shape.kind) {
		case 'circle':
			return <circle cx={shape.cx} cy={shape.cy} r={shape.r} className={className} strokeWidth={1} />
		case 'line':
			return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} className={className} strokeWidth={1.5} />
		case 'path':
			return <path d={shape.d} className={className} strokeWidth={1} />
		case 'polygon':
			return <polygon points={shape.points.map((point) => `${point.x},${point.y}`).join(' ')} className={className} />
	}
}

// Local View.
export function SolarEclipseLocalView({ view }: SolarEclipseLocalViewProps) {
	const width = view.width + 2 * MARGIN
	const height = view.height + 2 * MARGIN

	return (
		<svg viewBox={`${-MARGIN} ${-MARGIN} ${width} ${height}`} style={{ aspectRatio: `${width} / ${height}` }} className="w-full overflow-hidden rounded-sm border border-line-100 bg-base-200">
			{view.shapes.map((shape, index) => (
				<Shape key={index} shape={shape} />
			))}
		</svg>
	)
}
