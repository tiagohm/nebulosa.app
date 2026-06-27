import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { Mount } from 'nebulosa/src/devices/indi/device'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import { formatAZ, formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'
import { formatNumber, tw } from '../shared/util'
import { imageWorkspaceStore } from '../stores/image.workspace.store'
import { Dropdown, DropdownItem } from './components/Dropdown'
import { MountDropdown } from './DeviceDropdown'
import { Icons } from './Icon'

export const ImageInfo = memo(() => {
	const { selected: selectedImage } = useSnapshot(imageWorkspaceStore.state)
	const viewer = useContext(ImageViewerStoreContext)
	const { info, scale, angle } = useSnapshot(viewer.state)
	const { mouseCoordinate } = viewer
	const { visible: isMouseCoordinateVisible, interpolator } = useSnapshot(mouseCoordinate.state)
	const { hover, selected } = useSnapshot(mouseCoordinate.state.coordinate)

	if (!info || selectedImage?.id !== viewer.image.id) return null

	return (
		<div className="pointer-events-none absolute top-2 left-2 z-999999 max-w-[calc(100vw-1rem)] rounded-2xl bg-black/60 p-3 text-sm opacity-80 select-none">
			<div className="flex min-w-0 flex-col gap-0 text-white">
				<span className="truncate text-xs text-neutral-400">{info.path}</span>
				<div className="flex flex-row items-center gap-1">
					{info.width}x{info.height}
					<Icons.ZoomIn />
					{formatNumber(scale, 2)}
					<Icons.Restore />
					{formatNumber(angle, 1)}°
				</div>
				{isMouseCoordinateVisible && interpolator && (
					<>
						<Coordinate className="mt-2" declination={hover.declination} rightAscension={hover.rightAscension} x={hover.x} y={hover.y} />
						{selected.show && (
							<span className="flex flex-row items-center gap-1">
								<Coordinate declination={selected.declination} pinned rightAscension={selected.rightAscension} x={selected.x} y={selected.y} />
								<b>D:</b> {formatAZ(selected.distance, true)}
								<SelectedCoordinateDropdown onFrameAt={viewer.frameAt} onPointMountHere={viewer.pointMountHere} onSyncMountHere={viewer.syncMountHere} />
							</span>
						)}
					</>
				)}
			</div>
		</div>
	)
})

interface CoordinateProps extends React.ComponentProps<'div'>, Readonly<EquatorialCoordinate>, Readonly<Point> {
	readonly pinned?: boolean
}

function Coordinate({ pinned = false, x, y, rightAscension, declination, className, ...props }: CoordinateProps) {
	return (
		<div className={tw('inline-flex min-w-0 flex-row items-center gap-1', className)} {...props}>
			{pinned ? <Icons.Pin className="size-[1em]" /> : <Icons.Cursor className="size-[1em]" />}
			<b>X:</b> {formatNumber(x, 0)}
			<b className="ms-1">Y:</b> {formatNumber(y, 0)}
			<b className="ms-1">RA:</b> {formatAngle(rightAscension, formatRA)}
			<b className="ms-1">DEC:</b> {formatAngle(declination, formatDEC)}
		</div>
	)
}

export interface SelectedCoordinateDropdownProps {
	readonly onPointMountHere: (mount: Mount, coordinate: EquatorialCoordinate) => void
	readonly onSyncMountHere: (mount: Mount, coordinate: EquatorialCoordinate) => void
	readonly onFrameAt: (coordinate: EquatorialCoordinate) => void
}

const SelectedCoordinateDropdown = memo((props: SelectedCoordinateDropdownProps) => {
	const viewer = useContext(ImageViewerStoreContext)
	const { mouseCoordinate } = viewer

	function handlePointMountHere(mount: Mount | undefined) {
		const coordinate = mouseCoordinate.state.coordinate.selected
		if (mount && isValidCoordinate(coordinate)) props.onPointMountHere(mount, coordinate)
	}

	function handleSyncMountHere(mount: Mount | undefined) {
		const coordinate = mouseCoordinate.state.coordinate.selected
		if (mount && isValidCoordinate(coordinate)) props.onSyncMountHere(mount, coordinate)
	}

	function handleFrameAt() {
		const coordinate = mouseCoordinate.state.coordinate.selected
		if (isValidCoordinate(coordinate)) props.onFrameAt(coordinate)
	}

	return (
		<Dropdown className="pointer-events-auto" itemHeight={32} size="sm">
			<DropdownItem startContent={<Icons.Telescope />}>
				<span className="flex flex-row items-center gap-1">
					<span>Mount:</span>
					<MountDropdown disallowNoneSelection onValueChange={handlePointMountHere} color="success" size="sm" />
					<MountDropdown disallowNoneSelection onValueChange={handleSyncMountHere} color="primary" size="sm" icon={Icons.Sync} />
				</span>
			</DropdownItem>
			<DropdownItem label="Frame at this coordinate" onClick={handleFrameAt} startContent={<Icons.Image />} />
			<DropdownItem label="Unpin" onClick={() => (mouseCoordinate.state.coordinate.selected.show = false)} variant="flat" color="danger" startContent={<Icons.Trash />} />
		</Dropdown>
	)
})

function formatAngle(value: number, format: (value: number, signed?: boolean) => string) {
	return Number.isFinite(value) ? format(value, true) : '--'
}

function isValidCoordinate(coordinate: EquatorialCoordinate) {
	return Number.isFinite(coordinate.rightAscension) && Number.isFinite(coordinate.declination)
}
