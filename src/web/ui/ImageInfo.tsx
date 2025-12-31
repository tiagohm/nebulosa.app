import { useMolecule } from 'bunshi/react'
import { formatAZ, formatDEC, formatRA } from 'nebulosa/src/angle'
import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import type { Point } from 'nebulosa/src/geometry'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageMouseCoordinateMolecule } from '@/molecules/image/mousecoordinate'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { Icons } from './Icon'

export const ImageInfo = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)
	const { info, scale, angle } = useSnapshot(viewer.state)
	const { visible: isMouseCoordinateVisible, interpolator } = useSnapshot(mouseCoordinate.state)
	const { hover, selected } = useSnapshot(mouseCoordinate.state.coordinate)

	if (!info) return null

	return (
		<div className='text-sm top-2 left-2 pointer-events-none select-none absolute p-1 opacity-80 hover:opacity-80 z-999999'>
			<div className='flex flex-col gap-0'>
				<span className='text-xs text-neutral-400'>{info.path}</span>
				<div className='flex flex-row items-center gap-1'>
					{info.width}x{info.height}
					<Icons.ZoomIn size={14} />
					{scale.toFixed(2)}
					<Icons.Restore size={14} />
					{angle.toFixed(1)}°
				</div>
				{isMouseCoordinateVisible && interpolator && (
					<>
						<Coordinate declination={hover.declination} rightAscension={hover.rightAscension} x={hover.x} y={hover.y} />
						{selected.show && (
							<span className='flex flex-row items-center gap-1'>
								<Coordinate declination={selected.declination} rightAscension={selected.rightAscension} selected x={selected.x} y={selected.y} />
								<b className='ms-1'>D:</b> {formatAZ(selected.distance)}
							</span>
						)}
					</>
				)}
			</div>
		</div>
	)
})

interface CoordinateProps extends Readonly<EquatorialCoordinate>, Readonly<Point> {
	readonly selected?: boolean
}

const Coordinate = memo(({ selected = false, x, y, rightAscension, declination }: CoordinateProps) => {
	return (
		<div className='inline-flex flex-row items-center gap-1'>
			{selected ? <Icons.Pin size={12} /> : <Icons.Cursor size={12} />}
			<b>X:</b> {x.toFixed(0)}
			<b className='ms-1'>Y:</b> {y.toFixed(0)}
			<b className='ms-1'>RA:</b> {formatRA(rightAscension)}
			<b className='ms-1'>DEC:</b> {formatDEC(declination)}
		</div>
	)
})
