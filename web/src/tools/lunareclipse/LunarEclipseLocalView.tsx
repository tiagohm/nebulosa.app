import type { LocalLunarEclipseSvgShape, LunarEclipseLocalView as LocalViewGeometry } from 'api'
import { EclipseLocalViewSurface } from '../eclipse/EclipseLocalView'

// Local View of a lunar eclipse: the toolkit's schematic of the Moon crossing the Earth's shadow as seen from a
// place, drawn from the shapes the API computed (in pixels, origin at the top-left corner, y down) without any
// geometry of its own. The shadows are translucent over the Moon disks, so a disk inside the umbra darkens.

export interface LunarEclipseLocalViewProps {
	// Geometry to draw.
	readonly view: LocalViewGeometry
}

// Classes of each shape, by role.
const SHAPE_CLASSES: Readonly<Record<LocalLunarEclipseSvgShape['role'], string>> = {
	horizonBand: 'fill-danger/10',
	trajectoryPath: 'fill-none stroke-ink-300 [stroke-dasharray:4_3]',
	ghostMoonDisk: 'fill-none stroke-ink-300 [stroke-dasharray:2_2]',
	moonDisk: 'fill-ink-200 stroke-ink-100',
	penumbra: 'fill-black/25 stroke-ink-300',
	umbra: 'fill-black/55 stroke-ink-200',
	horizonLine: 'stroke-danger',
}

// Draws one shape.
function Shape({ shape }: { readonly shape: LocalLunarEclipseSvgShape }) {
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

// Local View, panned and zoomed, with the Moon at the contact drawn close up (EclipseLocalViewSurface).
export function LunarEclipseLocalView({ view }: LunarEclipseLocalViewProps) {
	const disk = view.shapes.find((shape) => shape.kind === 'circle' && shape.role === 'moonDisk')

	return (
		<EclipseLocalViewSurface width={view.width} height={view.height} disk={disk?.kind === 'circle' ? disk : undefined} body="Moon">
			{view.shapes.map((shape, index) => (
				<Shape key={index} shape={shape} />
			))}
		</EclipseLocalViewSurface>
	)
}
