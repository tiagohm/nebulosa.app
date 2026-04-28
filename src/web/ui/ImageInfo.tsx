import { useMolecule } from 'bunshi/react'
import { formatAZ, formatDEC, formatRA } from 'nebulosa/src/angle'
import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import type { Point } from 'nebulosa/src/geometry'
import type { Mount } from 'nebulosa/src/indi.device'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageMouseCoordinateMolecule } from '@/molecules/image/mousecoordinate'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { Dropdown, DropdownItem } from './components/Dropdown'
import { MountDropdown } from './DeviceDropdown'
import { Icons } from './Icon'

export const ImageInfo = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)
	const { info, scale, angle } = useSnapshot(viewer.state)
	const { visible: isMouseCoordinateVisible, interpolator } = useSnapshot(mouseCoordinate.state)
	const { hover, selected } = useSnapshot(mouseCoordinate.state.coordinate)

	if (!info) return null

	return (
		<div className="pointer-events-none absolute top-2 left-2 z-999999 p-1 text-sm opacity-80 select-none hover:opacity-80">
			<div className="flex flex-col gap-0">
				<span className="text-xs text-neutral-400">{info.path}</span>
				<div className="flex flex-row items-center gap-1">
					{info.width}x{info.height}
					<Icons.ZoomIn />
					{scale.toFixed(2)}
					<Icons.Restore />
					{angle.toFixed(1)}°
				</div>
				<Activity mode={isMouseCoordinateVisible && interpolator ? 'visible' : 'hidden'}>
					<Coordinate declination={hover.declination} rightAscension={hover.rightAscension} x={hover.x} y={hover.y} />
					<Activity mode={selected.show ? 'visible' : 'hidden'}>
						<span className="flex flex-row items-center gap-1">
							<Coordinate declination={selected.declination} pinned rightAscension={selected.rightAscension} x={selected.x} y={selected.y} />
							<b className="ms-1">D:</b> {formatAZ(selected.distance, true)}
							<SelectedCoordinateDropdown onFrameAt={viewer.frameAt} onPointMountHere={viewer.pointMountHere} />
						</span>
					</Activity>
				</Activity>
			</div>
		</div>
	)
})

interface CoordinateProps extends Readonly<EquatorialCoordinate>, Readonly<Point> {
	readonly pinned?: boolean
}

function Coordinate({ pinned = false, x, y, rightAscension, declination }: CoordinateProps) {
	return (
		<div className="inline-flex flex-row items-center gap-1">
			{pinned ? <Icons.Pin /> : <Icons.Cursor />}
			<b>X:</b> {x.toFixed(0)}
			<b className="ms-1">Y:</b> {y.toFixed(0)}
			<b className="ms-1">RA:</b> {formatRA(rightAscension, true)}
			<b className="ms-1">DEC:</b> {formatDEC(declination, true)}
		</div>
	)
}

export interface SelectedCoordinateDropdownProps {
	readonly onPointMountHere: (mount: Mount, coordinate: EquatorialCoordinate) => void
	readonly onFrameAt: (coordinate: EquatorialCoordinate) => void
}

const SelectedCoordinateDropdown = memo((props: SelectedCoordinateDropdownProps) => {
	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)

	return (
		<Dropdown label={<Icons.DotsVertical />}>
			<DropdownItem startContent={<Icons.Telescope />}>
				<span className="flex flex-row items-center gap-1">
					<span>Point mount here:</span>
					<MountDropdown disallowNoneSelection onValueChange={(value) => value && props.onPointMountHere(value, mouseCoordinate.state.coordinate.selected)} />
				</span>
			</DropdownItem>
			<DropdownItem label="Frame at this coordinate" onPointerUp={() => props.onFrameAt(mouseCoordinate.state.coordinate.selected)} startContent={<Icons.Image />} />
			<DropdownItem label="Unpin" onPointerUp={() => (mouseCoordinate.state.coordinate.selected.show = false)} className="text-danger" color="danger" key="UNPIN" startContent={<Icons.Trash />} />
		</Dropdown>
	)
})
