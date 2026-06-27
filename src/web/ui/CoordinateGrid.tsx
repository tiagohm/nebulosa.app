import { formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { type CSSProperties, memo, useContext } from 'react'
import type { ImageCoordinateGridAxis, ImageCoordinateGridLine } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'

const GRID_STROKE: Record<ImageCoordinateGridAxis, string> = {
	rightAscension: 'var(--danger)',
	declination: 'var(--primary)',
}

const TEXT_STYLE: CSSProperties = {
	paintOrder: 'stroke',
	strokeLinejoin: 'round',
	textAnchor: 'middle',
	alignmentBaseline: 'middle',
	transform: 'rotate(0deg)',
}

function gridLinePoints(line: ImageCoordinateGridLine) {
	return line.points.map(({ x, y }) => `${x},${y}`).join(' ')
}

function gridLineLabel(line: ImageCoordinateGridLine) {
	return line.axis === 'rightAscension' ? formatRA(line.value, false) : formatDEC(line.value, false)
}

export const CoordinateGrid = memo(() => {
	const { coordinateGrid } = useContext(ImageViewerStoreContext)
	const { visible, grid } = useSnapshot(coordinateGrid.state)

	if (!visible || !grid || grid.lines.length === 0) return null

	return (
		<svg className="coordinate-grid pointer-events-none absolute top-0 left-0 h-full w-full select-none" fill="none">
			{grid.lines.map((line, index) => {
				const stroke = GRID_STROKE[line.axis]

				return (
					<g key={`${line.axis}-${line.value}-${index}`}>
						<polyline opacity={0.42} points={gridLinePoints(line)} stroke={stroke} strokeWidth={1} />
						{line.labels?.map((label, labelIndex) => (
							<text className="text-xs font-bold" fill={stroke} key={labelIndex} stroke="black" strokeWidth={3} style={TEXT_STYLE} x={label.x} y={label.y}>
								{gridLineLabel(line)}
							</text>
						))}
					</g>
				)
			})}
		</svg>
	)
})
