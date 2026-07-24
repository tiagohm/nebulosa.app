import { ImageViewerStoreContext } from '@shared/context'
import { formatNumber, tw } from '@shared/util'
import { hasScaledSolution } from '@stores/image.solver.store'
import { IconButton } from '@ui/components/IconButton'
import { Switch } from '@ui/components/Switch'
import { MountDropdown } from '@ui/DeviceDropdown'
import { Icons } from '@ui/Icon'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { Mount } from 'nebulosa/src/devices/indi/device'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import { formatAZ, formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const ImageMouseCoordinate = memo(() => {
	const { mouseCoordinate, solver } = useContext(ImageViewerStoreContext)
	const { solution } = useSnapshot(solver.state)

	useEffect(mouseCoordinate.mount, [])

	if (!hasScaledSolution(solution)) return <div className="flex h-full w-full flex-row items-center justify-center">Not available</div>

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Toggle />
			<HoverCoordinate />
			<SelectedCoordinate />
			<SelectedCoordinateAction />
		</div>
	)
})

const Toggle = memo(() => {
	const { mouseCoordinate } = useContext(ImageViewerStoreContext)
	const { enabled } = useSnapshot(mouseCoordinate.state)

	return <Switch className="col-span-full min-w-0" label="Enabled" onValueChange={mouseCoordinate.setEnabled} value={enabled} />
})

const HoverCoordinate = memo(() => {
	const { mouseCoordinate } = useContext(ImageViewerStoreContext)
	const { enabled, interpolator } = useSnapshot(mouseCoordinate.state)
	const { hover } = useSnapshot(mouseCoordinate.state.coordinate)

	if (!enabled || interpolator === undefined) return null

	return <Coordinate className="col-span-full" declination={hover.declination} rightAscension={hover.rightAscension} x={hover.x} y={hover.y} />
})

const SelectedCoordinate = memo(() => {
	const { mouseCoordinate } = useContext(ImageViewerStoreContext)
	const { enabled, interpolator } = useSnapshot(mouseCoordinate.state)
	const { selected } = useSnapshot(mouseCoordinate.state.coordinate)

	if (!enabled || interpolator === undefined || !selected.show) return null

	return (
		<span className="col-span-full flex flex-row items-center gap-1">
			<Coordinate declination={selected.declination} pinned rightAscension={selected.rightAscension} x={selected.x} y={selected.y} />
			<b>D:</b> {formatAZ(selected.distance, true)}
		</span>
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

const SelectedCoordinateAction = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { mouseCoordinate } = viewer

	function handlePointMountHere(mount: Mount | undefined) {
		const coordinate = mouseCoordinate.state.coordinate.selected
		if (mount && isValidCoordinate(coordinate)) void viewer.pointMountHere(mount, coordinate)
	}

	function handleSyncMountHere(mount: Mount | undefined) {
		const coordinate = mouseCoordinate.state.coordinate.selected
		if (mount && isValidCoordinate(coordinate)) void viewer.syncMountHere(mount, coordinate)
	}

	function handleFrameAt() {
		const coordinate = mouseCoordinate.state.coordinate.selected
		if (isValidCoordinate(coordinate)) void viewer.frameAt(coordinate)
	}

	return (
		<div className="col-span-full flex items-center justify-center gap-2">
			<MountDropdown disallowNoneSelection onValueChange={handlePointMountHere} color="success" size="sm" />
			<MountDropdown disallowNoneSelection onValueChange={handleSyncMountHere} color="primary" size="sm" icon={Icons.Sync} />
			<IconButton color="secondary" icon={Icons.Image} onClick={handleFrameAt} tooltipContent="Frame" variant="flat" />
			<IconButton color="danger" icon={Icons.Trash} onClick={() => (mouseCoordinate.state.coordinate.selected.show = false)} tooltipContent="Unpin" variant="flat" />
		</div>
	)
})

function formatAngle(value: number, format: (value: number, signed?: boolean) => string) {
	return Number.isFinite(value) ? format(value, true) : '--'
}

function isValidCoordinate(coordinate: EquatorialCoordinate) {
	return Number.isFinite(coordinate.rightAscension) && Number.isFinite(coordinate.declination)
}
