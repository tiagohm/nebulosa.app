import { ImageViewerStoreContext } from '@shared/context'
// oxfmt-ignore
import { crosshairAngleDisplayUnit, crosshairAngleToDisplayValue, crosshairGeometry, crosshairPointFromPixels, crosshairPointInPixels, crosshairSegmentsPath, type CrosshairGeometry, type CrosshairPoint } from '@shared/types/crosshair'
import { stopPropagationAndPreventDefault } from '@shared/util'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import { memo, useContext, type ReactNode } from 'react'
import type { ImageCrosshairPolyline } from 'src/shared/types'
import { useSnapshot } from 'valtio'

type GeometryStrokeProps = {
	readonly geometry: CrosshairGeometry
	readonly stroke: string
	readonly strokeWidth: number
	readonly strokeOpacity: number
	readonly strokeDasharray?: string
}

function GeometryStroke({ geometry, ...props }: GeometryStrokeProps) {
	const axes = crosshairSegmentsPath(geometry.axes)

	return (
		<g {...props} fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke">
			{axes && <path d={axes} vectorEffect="non-scaling-stroke" />}
			{geometry.radii.map((radius) => (
				<circle cx={geometry.center.x} cy={geometry.center.y} key={radius} r={radius} vectorEffect="non-scaling-stroke" />
			))}
		</g>
	)
}

type PositionedProps = {
	readonly x: number
	readonly y: number
	readonly angle?: number
	readonly children: ReactNode
}

function Positioned({ x, y, angle = 0, children }: PositionedProps) {
	return <g transform={`translate(${x} ${y}) rotate(${angle})`}>{children}</g>
}

function polylinesPath(lines: readonly ImageCrosshairPolyline[], delta: CrosshairPoint) {
	return lines.map((line) => line.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x + delta.x} ${y + delta.y}`).join('')).join('')
}

type ProjectedStrokeProps = {
	readonly axes: readonly ImageCrosshairPolyline[]
	readonly rings: readonly ImageCrosshairPolyline[]
	readonly delta: CrosshairPoint
	readonly stroke: string
	readonly strokeWidth: number
	readonly strokeOpacity: number
	readonly strokeDasharray?: string
}

function ProjectedStroke({ axes, rings, delta, ...props }: ProjectedStrokeProps) {
	const paths = polylinesPath([...axes, ...rings], delta)

	return (
		<g {...props} fill="none" strokeLinecap="round">
			{paths && <path d={paths} vectorEffect="non-scaling-stroke" />}
		</g>
	)
}

function directionArrowPath(direction: Point, start: number, end: number, head: number) {
	const startX = direction.x * start
	const startY = direction.y * start
	const endX = direction.x * end
	const endY = direction.y * end
	const perpendicularX = -direction.y
	const perpendicularY = direction.x
	const baseX = endX - direction.x * head
	const baseY = endY - direction.y * head
	return `M${startX} ${startY}L${endX} ${endY}M${endX} ${endY}L${baseX + perpendicularX * head * 0.6} ${baseY + perpendicularY * head * 0.6}M${endX} ${endY}L${baseX - perpendicularX * head * 0.6} ${baseY - perpendicularY * head * 0.6}`
}

type CardinalTicksProps = {
	readonly center: Point
	readonly points: readonly Point[]
	readonly color: string
	readonly opacity: number
	readonly lineWidth: number
	readonly dashed: boolean
	readonly halo: boolean
}

function CardinalTicks({ center, points, color, opacity, lineWidth, dashed, halo }: CardinalTicksProps) {
	return points.map((point, index) => {
		const angle = Math.atan2(point.y - center.y, point.x - center.x) * (180 / Math.PI) + 90

		return (
			<Positioned angle={angle} key={index} x={point.x} y={point.y}>
				{halo && <line stroke="#000000" strokeOpacity={0.6} strokeWidth={lineWidth + 2} vectorEffect="non-scaling-stroke" x1={-3} x2={3} />}
				<line stroke={color} strokeDasharray={dashed ? '6 4' : undefined} strokeOpacity={opacity} strokeWidth={lineWidth} vectorEffect="non-scaling-stroke" x1={-3} x2={3} />
			</Positioned>
		)
	})
}

function angularValueLabel(value: number) {
	const unit = crosshairAngleDisplayUnit(value)
	const suffix = unit === 'arcsecond' ? '″' : unit === 'arcminute' ? '′' : '°'
	const display = crosshairAngleToDisplayValue(value, unit)
	return `${display.toLocaleString('en', { maximumFractionDigits: 2 })}${suffix}`
}

export const Crosshair = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { crosshair } = viewer
	const { enabled, previewCenter, projection, config } = useSnapshot(crosshair.state)
	const { info, angle } = useSnapshot(viewer.state)

	if (!enabled || !info || info.width <= 0 || info.height <= 0) return null

	const projectedCenter = projection?.center
	const baseCenter = config.center.space === 'image' ? crosshairPointInPixels(config.center.point, info.width, info.height) : projectedCenter
	const center = previewCenter ? crosshairPointInPixels(previewCenter, info.width, info.height) : baseCenter
	if (!center) return null

	const normalizedCenter = crosshairPointFromPixels(center, info.width, info.height)
	const geometry = crosshairGeometry(config, info.width, info.height, 1, normalizedCenter)
	const dash = config.dashed ? '6 4' : undefined
	const angular = config.spacing.unit === 'angular'
	const delta = projectedCenter ? { x: center.x - projectedCenter.x, y: center.y - projectedCenter.y } : { x: 0, y: 0 }
	const roseStart = 4
	const roseEnd = 28
	const roseHead = 4
	const fontSize = 10
	const labelRadius = roseEnd + fontSize
	const labelStrokeWidth = 3
	const handleVisible = center.x >= 0 && center.y >= 0 && center.x <= info.width && center.y <= info.height
	const strokeProps = { strokeDasharray: dash, strokeOpacity: config.opacity, strokeWidth: config.lineWidth }
	const projectedStrokeProps = projection && { axes: projection.axes, rings: projection.rings, delta }
	const tickPoints =
		angular && projection
			? projection.cardinals.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }))
			: config.preset === 'bullseye' && geometry.radii[2]
				? [
						{ x: center.x, y: center.y - geometry.radii[2] },
						{ x: center.x, y: center.y + geometry.radii[2] },
						{ x: center.x - geometry.radii[2], y: center.y },
						{ x: center.x + geometry.radii[2], y: center.y },
					]
				: []

	return (
		<svg className="crosshair pointer-events-none absolute top-0 left-0 size-full select-none" viewBox={`0 0 ${info.width} ${info.height}`}>
			{angular && projectedStrokeProps ? (
				<>
					{config.halo && <ProjectedStroke {...projectedStrokeProps} {...strokeProps} stroke="#000000" strokeOpacity={0.6} strokeWidth={config.lineWidth + 2} />}
					<ProjectedStroke {...projectedStrokeProps} {...strokeProps} stroke={config.color} />
				</>
			) : !angular ? (
				<>
					{config.halo && <GeometryStroke geometry={geometry} stroke="#000000" strokeDasharray={dash} strokeOpacity={0.6} strokeWidth={config.lineWidth + 2} />}
					<GeometryStroke geometry={geometry} stroke={config.color} {...strokeProps} />
				</>
			) : null}

			<CardinalTicks center={center} color={config.color} dashed={config.dashed} halo={config.halo} lineWidth={config.lineWidth} opacity={config.opacity} points={tickPoints} />

			{projection && (
				<Positioned x={center.x} y={center.y}>
					<g fill={config.color} fillOpacity={config.opacity} fontSize={fontSize} fontWeight="bold" strokeLinecap="round">
						{(['north', 'east'] as const).map((key) => {
							const direction = projection.directions[key]
							const labelX = direction.x * labelRadius
							const labelY = direction.y * labelRadius
							return (
								<g key={key}>
									{config.halo && <path d={directionArrowPath(direction, roseStart, roseEnd, roseHead)} fill="none" stroke="#000000" strokeOpacity={0.6} strokeWidth={config.lineWidth + 2} vectorEffect="non-scaling-stroke" />}
									<path d={directionArrowPath(direction, roseStart, roseEnd, roseHead)} fill="none" stroke={config.color} strokeOpacity={config.opacity} strokeWidth={config.lineWidth} vectorEffect="non-scaling-stroke" />
									<text dominantBaseline="middle" paintOrder="stroke" stroke={config.halo ? '#000000' : 'none'} strokeOpacity={0.8} strokeWidth={labelStrokeWidth} textAnchor="middle" transform={`rotate(${-angle} ${labelX} ${labelY})`} x={labelX} y={labelY}>
										{key === 'north' ? 'N' : 'E'}
									</text>
								</g>
							)
						})}
					</g>
				</Positioned>
			)}

			{angular &&
				config.preset === 'bullseye' &&
				projection?.ringIntersections.map((intersection) => {
					const x = intersection.x + delta.x
					const y = intersection.y + delta.y
					return (
						<text
							dominantBaseline="central"
							fill={config.color}
							fillOpacity={config.opacity}
							fontSize={fontSize}
							fontWeight="bold"
							key={intersection.radius}
							paintOrder="stroke"
							stroke={config.halo ? '#000000' : 'none'}
							strokeOpacity={0.8}
							strokeWidth={labelStrokeWidth}
							textAnchor="middle"
							transform={`rotate(${-angle} ${x} ${y})`}
							x={x}
							y={y}>
							{angularValueLabel(intersection.radius)}
						</text>
					)
				})}

			<Positioned x={center.x} y={center.y}>
				<circle fill={config.color} fillOpacity={config.opacity} r={2} stroke={config.halo ? '#000000' : 'none'} strokeOpacity={0.6} strokeWidth={config.lineWidth + 2} vectorEffect="non-scaling-stroke" />
				{handleVisible && (
					<circle
						className="pointer-events-auto cursor-move fill-transparent stroke-transparent outline-none focus-visible:stroke-white"
						data-interactable-control
						onClick={stopPropagationAndPreventDefault}
						onKeyDown={crosshair.handleCenterKeyDown}
						onPointerDown={crosshair.startCenterDrag}
						r={10}
						strokeWidth={1}
						tabIndex={0}
						vectorEffect="non-scaling-stroke"
					/>
				)}
			</Positioned>
		</svg>
	)
})
