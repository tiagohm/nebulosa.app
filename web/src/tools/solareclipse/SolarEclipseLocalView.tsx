import type { LocalSolarEclipseSvgShape, SolarEclipseLocalView as LocalViewGeometry } from 'api'
import { EclipseLocalViewSurface } from '../eclipse/EclipseLocalView'

// Local View of a solar eclipse: the toolkit's schematic of the Moon over the Sun as seen from a place at a
// contact, drawn from the shapes the API computed (in pixels, origin at the top-left corner, y down) without any
// geometry of its own. The Moon disk is opaque over the Sun, so the covered part of the Sun is dark, and the
// band below the horizon is drawn over both. The Sun is a dim gold, never the brightest thing on a night screen.

export interface SolarEclipseLocalViewProps {
	// Geometry to draw.
	readonly view: LocalViewGeometry
}

// Classes of each shape, by role.
const SHAPE_CLASSES: Readonly<Record<LocalSolarEclipseSvgShape['role'], string>> = {
	ghostSunDisk: 'fill-none stroke-ink-300 [stroke-dasharray:2_2]',
	ghostMoonDisk: 'fill-none stroke-ink-300 [stroke-dasharray:2_2]',
	sunDisk: 'fill-map-sun/45 stroke-map-sun',
	moonDisk: 'fill-base-000/95 stroke-ink-300',
	solarLimb: 'fill-none stroke-map-sun',
	lunarLimb: 'fill-none stroke-ink-300',
	trajectoryLine: 'stroke-ink-300 [stroke-dasharray:4_3]',
	trajectoryPath: 'fill-none stroke-ink-300 [stroke-dasharray:4_3]',
	horizonBand: 'fill-green-500/15',
	horizonLine: 'stroke-green-500/35',
}

// Draws one shape.
function Shape({ shape }: { readonly shape: LocalSolarEclipseSvgShape }) {
	const className = SHAPE_CLASSES[shape.role]

	switch (shape.kind) {
		case 'circle':
			return <circle cx={shape.cx} cy={shape.cy} r={shape.r} className={className} strokeWidth={1} vectorEffect="non-scaling-stroke" />
		case 'line':
			return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} className={className} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
		case 'path':
			return <path d={shape.d} className={className} strokeWidth={1} vectorEffect="non-scaling-stroke" />
		case 'polygon':
			return <polygon points={shape.points.map((point) => `${point.x},${point.y}`).join(' ')} className={className} vectorEffect="non-scaling-stroke" />
	}
}

// Local View, panned and zoomed, with the Sun close up (EclipseLocalViewSurface).
export function SolarEclipseLocalView({ view }: SolarEclipseLocalViewProps) {
	const disk = view.shapes.find((shape) => shape.kind === 'circle' && shape.role === 'sunDisk')

	return (
		<EclipseLocalViewSurface width={view.width} height={view.height} disk={disk?.kind === 'circle' ? disk : undefined} body="Sun">
			{view.shapes.map((shape, index) => (
				<Shape key={index} shape={shape} />
			))}
		</EclipseLocalViewSurface>
	)
}
