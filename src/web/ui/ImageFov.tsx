import { ImageViewerStoreContext } from '@shared/context'
import { tw } from '@shared/util'
import { hasScaledSolution } from '@stores/image.solver.store'
import { AstroBinEquipmentPopover } from '@ui/AstroBinEquipmentPopover'
import { Checkbox } from '@ui/components/Checkbox'
import { IconButton } from '@ui/components/IconButton'
import { List } from '@ui/components/List'
import { NumberInput } from '@ui/components/NumberInput'
import { Icons } from '@ui/Icon'
import { memo, useContext, useEffect } from 'react'
import cameras from 'src/data/astrobin.cameras.json'
import telescopes from 'src/data/astrobin.telescopes.json'
import type { FovItem } from 'src/shared/types'
import { useSnapshot } from 'valtio'

export const ImageFov = memo(() => {
	const { fov, solver } = useContext(ImageViewerStoreContext)
	const { solution } = useSnapshot(solver.state)

	useEffect(fov.mount, [])

	if (!hasScaledSolution(solution)) return <div className="flex h-full w-full flex-row items-center justify-center">Not available</div>

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<FovList />
			<Telescope />
			<Camera />
			<OrientationAndOptics />
			<Actions />
		</div>
	)
})

const Telescope = memo(() => {
	const { fov } = useContext(ImageViewerStoreContext)
	const { items, selected } = useSnapshot(fov.state)
	const item = items[selected]

	if (!item) return null

	const { focalLength, aperture } = item

	return (
		<>
			<div className="col-span-2 items-center">
				<AstroBinEquipmentPopover items={telescopes} onValueChange={fov.selectTelescope} type="telescope" />
			</div>
			<NumberInput className="col-span-5 min-w-0" label="Focal Length (mm)" maxValue={100000} minValue={100} onValueChange={fov.setFocalLength} value={focalLength} />
			<NumberInput className="col-span-5 min-w-0" label="Aperture (mm)" maxValue={10000} minValue={10} onValueChange={fov.setAperture} value={aperture} />
		</>
	)
})

const Camera = memo(() => {
	const { fov } = useContext(ImageViewerStoreContext)
	const { items, selected } = useSnapshot(fov.state)
	const item = items[selected]

	if (!item) return null

	const { cameraWidth, cameraHeight, pixelWidth, pixelHeight } = item

	return (
		<>
			<div className="col-span-2 items-center">
				<AstroBinEquipmentPopover items={cameras} onValueChange={fov.selectCamera} type="camera" />
			</div>
			<NumberInput className="col-span-5 min-w-0" label="Width (px)" maxValue={100000} minValue={100} onValueChange={fov.setCameraWidth} value={cameraWidth} />
			<NumberInput className="col-span-5 min-w-0" label="Height (px)" maxValue={100000} minValue={100} onValueChange={fov.setCameraHeight} value={cameraHeight} />
			<NumberInput className="col-span-4 min-w-0" fractionDigits={2} label="Width (µm)" maxValue={100} minValue={1} onValueChange={fov.setPixelWidth} step={0.01} value={pixelWidth} />
			<NumberInput className="col-span-4 min-w-0" fractionDigits={2} label="Height (µm)" maxValue={100} minValue={1} onValueChange={fov.setPixelHeight} step={0.01} value={pixelHeight} />
		</>
	)
})

const OrientationAndOptics = memo(() => {
	const { fov } = useContext(ImageViewerStoreContext)
	const { items, selected } = useSnapshot(fov.state)
	const item = items[selected]

	if (!item) return null

	const { barlowReducer, bin, rotation } = item

	return (
		<>
			<NumberInput className="col-span-4 min-w-0" fractionDigits={1} label="Rotation (°)" maxValue={360} minValue={-360} onValueChange={fov.setRotation} step={0.1} value={rotation} />
			<NumberInput className="col-span-5 min-w-0" fractionDigits={2} label="Barlow/Reducer" maxValue={10} minValue={0.1} onValueChange={fov.setBarlowReducer} step={0.01} value={barlowReducer} />
			<NumberInput className="col-span-3 min-w-0" label="Bin" maxValue={8} minValue={1} onValueChange={fov.setBin} value={bin} />
		</>
	)
})

const Actions = memo(() => {
	const { fov } = useContext(ImageViewerStoreContext)
	const { items } = useSnapshot(fov.state)

	return (
		<div className="col-span-4 flex flex-row items-center justify-center gap-2">
			<IconButton className="col-span-2" color="success" icon={Icons.Plus} onClick={fov.add} tooltipContent="Add" />
			<IconButton className="col-span-2" color="danger" disabled={items.length <= 1} icon={Icons.Trash} onClick={fov.remove} tooltipContent="Remove" />
		</div>
	)
})

const FovList = memo(() => {
	const { fov } = useContext(ImageViewerStoreContext)
	const { items, selected } = useSnapshot(fov.state)

	function handleClick(event: React.UIEvent<HTMLElement>) {
		const index = +event.currentTarget.dataset.index!
		fov.select(index)
	}

	return (
		<List className="col-span-full" itemCount={items.length}>
			{(i) => {
				const item = items[i]
				const isSelected = i === selected

				return (
					<div data-index={i} onClick={handleClick} className={tw('flex h-full min-w-0 flex-row items-center justify-between gap-0 border-e-2 ps-3 transition hover:bg-neutral-800/80', isSelected && 'bg-neutral-800/70')} style={{ borderColor: item.color }}>
						<Checkbox onValueChange={(value) => fov.setVisible(item.id, value)} value={item.visible} />
						<ComputedFovItem {...item} />
					</div>
				)
			}}
		</List>
	)
})

const ComputedFovItem = memo((item: FovItem) => (
	<div className="flex min-w-0 flex-1 flex-row flex-wrap items-center justify-between gap-1 px-2 text-sm">
		<span>
			<strong>FL:</strong> {formatFovNumber(item.focalLength)}mm
		</span>
		<span>
			<strong>AP:</strong> {formatFovNumber(item.aperture)}mm
		</span>
		<span>
			<strong>SZ:</strong> {formatFovNumber(item.cameraWidth)}x{formatFovNumber(item.cameraHeight)} px
		</span>
		<span>
			<strong>PS:</strong> {formatFovNumber(item.pixelWidth, 2)}x{formatFovNumber(item.pixelHeight, 2)} µm
		</span>
		<span>
			<strong>BIN:</strong> {formatFovNumber(item.bin)}
		</span>
		<span>
			<strong>B/R:</strong> {formatFovNumber(item.barlowReducer, 2)}x
		</span>
		<span>
			<strong>ROT:</strong> {formatFovNumber(item.rotation, 1)}°
		</span>
	</div>
))

function formatFovNumber(value: number, fractionDigits = 0) {
	return Number.isFinite(value) ? value.toFixed(fractionDigits) : '--'
}
