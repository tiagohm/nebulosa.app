import type { LocalLunarEclipseSvgShape, LunarEclipseLocalView as LocalViewGeometry } from 'api'

// Local View of a lunar eclipse: the toolkit's schematic of the Moon crossing the Earth's shadow as seen from a
// place, drawn from the shapes the API computed (in pixels, origin at the top-left corner, y down) without any
// geometry of its own. The shadows are translucent over the Moon disks, so a disk inside the umbra darkens.

export interface LunarEclipseLocalViewProps {
	// Geometry to draw.
	readonly view: LocalViewGeometry
}

// Margin around the diagram, in pixels, so disks near its edges stay inside.
const MARGIN = 32

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
export function LunarEclipseLocalView({ view }: LunarEclipseLocalViewProps) {
	const width = view.width + 2 * MARGIN
	const height = view.height + 2 * MARGIN

	return (
		<svg viewBox={`${-MARGIN} ${-MARGIN} ${width} ${height}`} className="aspect-square w-full rounded-sm border border-line-100 bg-base-200">
			{view.shapes.map((shape, index) => (
				<Shape key={index} shape={shape} />
			))}
		</svg>
	)
}
