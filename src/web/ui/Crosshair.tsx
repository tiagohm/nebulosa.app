import { ImageViewerStoreContext } from '@shared/context'
import { crosshairGeometry, crosshairSegmentsPath, type CrosshairGeometry } from '@shared/types/crosshair'
import { stopPropagationAndPreventDefault } from '@shared/util'
import { memo, useContext } from 'react'
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
	const grid = crosshairSegmentsPath(geometry.grid)
	const ticks = crosshairSegmentsPath(geometry.ticks)

	return (
		<g {...props} fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke">
			{grid && <path d={grid} vectorEffect="non-scaling-stroke" />}
			{axes && <path d={axes} vectorEffect="non-scaling-stroke" />}
			{geometry.radii.map((radius) => (
				<circle cx={geometry.center.x} cy={geometry.center.y} key={radius} r={radius} vectorEffect="non-scaling-stroke" />
			))}
			{ticks && <path d={ticks} vectorEffect="non-scaling-stroke" />}
		</g>
	)
}

export const Crosshair = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { crosshair } = viewer
	const { enabled, previewCenter, config } = useSnapshot(crosshair.state)
	const { info, scale } = useSnapshot(viewer.state)

	if (!enabled || !info || info.width <= 0 || info.height <= 0) return

	const center = previewCenter ?? config.center
	const geometry = crosshairGeometry(config, info.width, info.height, scale, center)
	const dash = config.dashed ? '6 4' : undefined

	return (
		<svg className="crosshair pointer-events-none absolute top-0 left-0 size-full select-none" viewBox={`0 0 ${info.width} ${info.height}`}>
			{config.halo && <GeometryStroke geometry={geometry} stroke="#000000" strokeDasharray={dash} strokeOpacity={0.6} strokeWidth={config.lineWidth + 2} />}
			<GeometryStroke geometry={geometry} stroke={config.color} strokeDasharray={dash} strokeOpacity={config.opacity} strokeWidth={config.lineWidth} />
			<circle cx={geometry.center.x} cy={geometry.center.y} fill={config.color} fillOpacity={config.opacity} r={geometry.dotRadius} stroke={config.halo ? '#000000' : 'none'} strokeOpacity={0.6} strokeWidth={config.lineWidth + 2} vectorEffect="non-scaling-stroke" />
			<circle
				className="pointer-events-auto cursor-move fill-transparent stroke-transparent outline-none focus-visible:stroke-white"
				cx={geometry.center.x}
				cy={geometry.center.y}
				data-interactable-control
				onClick={stopPropagationAndPreventDefault}
				onKeyDown={crosshair.handleCenterKeyDown}
				onPointerDown={crosshair.startCenterDrag}
				r={geometry.handleRadius}
				strokeWidth={1}
				tabIndex={0}
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	)
})
