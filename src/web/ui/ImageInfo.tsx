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
				<Activity mode={isMouseCoordinateVisible && interpolator ? 'visible' : 'hidden'}>
					<Coordinate declination={hover.declination} rightAscension={hover.rightAscension} x={hover.x} y={hover.y} />
					<Activity mode={selected.show ? 'visible' : 'hidden'}>
						<span className="flex flex-row items-center gap-1">
							<Coordinate declination={selected.declination} pinned rightAscension={selected.rightAscension} x={selected.x} y={selected.y} />
							<b className="ms-1">D:</b> {formatAZ(selected.distance, true)}
							<SelectedCoordinateDropdown onFrameAt={viewer.frameAt} onPointMountHere={viewer.pointMountHere} onSyncMountHere={viewer.syncMountHere} />
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
		<div className="inline-flex min-w-0 flex-row items-center gap-1">
			{pinned ? <Icons.Pin /> : <Icons.Cursor />}
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
	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)

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
		<Dropdown className="pointer-events-auto" label={<Icons.DotsVertical />} itemHeight={38} size="sm">
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

function formatNumber(value: number, fractionDigits: number) {
	return Number.isFinite(value) ? value.toFixed(fractionDigits) : '--'
}

function formatAngle(value: number, format: (value: number, signed?: boolean) => string) {
	return Number.isFinite(value) ? format(value, true) : '--'
}

function isValidCoordinate(coordinate: EquatorialCoordinate) {
	return Number.isFinite(coordinate.rightAscension) && Number.isFinite(coordinate.declination)
}
