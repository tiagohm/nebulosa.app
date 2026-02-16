import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatAZ, formatDEC, formatRA } from 'nebulosa/src/angle'
import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import type { Point } from 'nebulosa/src/geometry'
import type { Mount } from 'nebulosa/src/indi.device'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageMouseCoordinateMolecule } from '@/molecules/image/mousecoordinate'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { DEFAULT_DROPDOWN_PROPS } from '../shared/constants'
import { stopPropagation } from '../shared/util'
import { MountDropdown } from './DeviceDropdown'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

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
				<Activity mode={isMouseCoordinateVisible && interpolator ? 'visible' : 'hidden'}>
					<Coordinate declination={hover.declination} rightAscension={hover.rightAscension} x={hover.x} y={hover.y} />
					<Activity mode={selected.show ? 'visible' : 'hidden'}>
						<span className='flex flex-row items-center gap-1'>
							<Coordinate declination={selected.declination} pinned rightAscension={selected.rightAscension} x={selected.x} y={selected.y} />
							<b className='ms-1'>D:</b> {formatAZ(selected.distance, true)}
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

const Coordinate = memo(({ pinned = false, x, y, rightAscension, declination }: CoordinateProps) => {
	return (
		<div className='inline-flex flex-row items-center gap-1'>
			{pinned ? <Icons.Pin size={12} /> : <Icons.Cursor size={12} />}
			<b>X:</b> {x.toFixed(0)}
			<b className='ms-1'>Y:</b> {y.toFixed(0)}
			<b className='ms-1'>RA:</b> {formatRA(rightAscension, true)}
			<b className='ms-1'>DEC:</b> {formatDEC(declination, true)}
		</div>
	)
})

export interface SelectedCoordinateDropdownProps {
	readonly onPointMountHere: (mount: Mount, coordinate: EquatorialCoordinate) => void
	readonly onFrameAt: (coordinate: EquatorialCoordinate) => void
}

const SelectedCoordinateDropdown = memo((props: SelectedCoordinateDropdownProps) => {
	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)

	function handleAction(key: React.Key) {
		if (key === 'FRAME_AT_HERE') props.onFrameAt(mouseCoordinate.state.coordinate.selected!)
		else if (key === 'UNPIN') mouseCoordinate.state.coordinate.selected.show = false
	}

	return (
		<Dropdown {...DEFAULT_DROPDOWN_PROPS}>
			<DropdownTrigger>
				<IconButton className='pointer-events-auto' icon={Icons.DotsVertical} onPointerUp={stopPropagation} size='sm' />
			</DropdownTrigger>
			<DropdownMenu onAction={handleAction}>
				<DropdownItem key='POINT_MOUNT_HERE' startContent={<Icons.Telescope size={12} />}>
					<span className='flex flex-row items-center gap-1'>
						<span>Point mount here:</span>
						<MountDropdown disallowNoneSelection onValueChange={(value) => value && props.onPointMountHere(value, mouseCoordinate.state.coordinate.selected!)} />
					</span>
				</DropdownItem>
				<DropdownItem key='FRAME_AT_HERE' startContent={<Icons.Image size={12} />}>
					Frame at this coordinate
				</DropdownItem>
				<DropdownItem className='text-danger' color='danger' key='UNPIN' startContent={<Icons.Trash size={12} />}>
					Unpin
				</DropdownItem>
			</DropdownMenu>
		</Dropdown>
	)
})
