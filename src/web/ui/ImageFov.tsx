import { memo, useContext } from 'react'
import type { FovItem } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { tw } from '@/shared/util'
import { hasScaledSolution } from '@/stores/image.solver.store'
import cameras from '../../../data/cameras.json'
import telescopes from '../../../data/telescopes.json'
import { ImageViewerStoreContext } from '../shared/context'
import { AstroBinEquipmentPopover } from './AstroBinEquipmentPopover'
import { Checkbox } from './components/Checkbox'
import { IconButton } from './components/IconButton'
import { List } from './components/List'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { Modal } from './Modal'

export const ImageFov = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { fov, solver } = viewer
	const { show } = useSnapshot(fov.state)
	const { solution } = useSnapshot(solver.state)
	const hasSolutionScale = hasScaledSolution(solution)

	if (!show || !hasSolutionScale) return null

	return (
		<Modal header="FOV" id={`fov-${viewer.image.id}`} maxWidth="336px" onHide={fov.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 items-center gap-2">
		<FovList />
		<Edit />
	</div>
))

const Edit = memo(() => (
	<>
		<Telescope />
		<Camera />
		<OrientationAndOptics />
		<Actions />
	</>
))

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
			<NumberInput className="col-span-5 min-w-0" label="Focal Length (mm)" maxValue={100000} minValue={100} onValueChange={(value) => fov.update('focalLength', value)} value={focalLength} />
			<NumberInput className="col-span-5 min-w-0" label="Aperture (mm)" maxValue={10000} minValue={10} onValueChange={(value) => fov.update('aperture', value)} value={aperture} />
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
			<NumberInput className="col-span-5 min-w-0" label="Width (px)" maxValue={100000} minValue={100} onValueChange={(value) => fov.update('cameraWidth', value)} value={cameraWidth} />
			<NumberInput className="col-span-5 min-w-0" label="Height (px)" maxValue={100000} minValue={100} onValueChange={(value) => fov.update('cameraHeight', value)} value={cameraHeight} />
			<NumberInput className="col-span-4 min-w-0" fractionDigits={2} label="Width (µm)" maxValue={100} minValue={1} onValueChange={(value) => fov.update('pixelWidth', value)} step={0.01} value={pixelWidth} />
			<NumberInput className="col-span-4 min-w-0" fractionDigits={2} label="Height (µm)" maxValue={100} minValue={1} onValueChange={(value) => fov.update('pixelHeight', value)} step={0.01} value={pixelHeight} />
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
			<NumberInput className="col-span-4 min-w-0" fractionDigits={1} label="Rotation (°)" maxValue={360} minValue={-360} onValueChange={(value) => fov.update('rotation', value)} step={0.1} value={rotation} />
			<NumberInput className="col-span-5 min-w-0" fractionDigits={2} label="Barlow/Reducer" maxValue={10} minValue={0.1} onValueChange={(value) => fov.update('barlowReducer', value)} step={0.01} value={barlowReducer} />
			<NumberInput className="col-span-3 min-w-0" label="Bin" maxValue={8} minValue={1} onValueChange={(value) => fov.update('bin', value)} value={bin} />
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
						<Checkbox onValueChange={(selected) => fov.update('visible', selected, item.id)} value={item.visible} />
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
