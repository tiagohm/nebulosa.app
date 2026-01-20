import { Checkbox, Listbox, ListboxItem, NumberInput, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import clsx from 'clsx'
import { memo, useCallback } from 'react'
import { useSnapshot } from 'valtio'
import { ImageFovMolecule } from '@/molecules/image/fov'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import cameras from '../../../data/cameras.json'
import telescopes from '../../../data/telescopes.json'
import { AstroBinEquipmentPopover, type AstroBinEquipmentPopoverItem } from './AstroBinEquipmentPopover'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'

export const ImageFov = memo(() => {
	const fov = useMolecule(ImageFovMolecule)

	return (
		<Modal header='FOV' id={`fov-${fov.scope.image.key}`} maxWidth='336px' onHide={fov.hide}>
			<div className='mt-0 grid grid-cols-12 items-center gap-2'>
				<FovItemList />
				<FovItemEdit />
			</div>
		</Modal>
	)
})

const FovItemEdit = memo(() => {
	const fov = useMolecule(ImageFovMolecule)
	const { items, selected } = useSnapshot(fov.state)

	const { focalLength, aperture, cameraWidth, cameraHeight, pixelWidth, pixelHeight, barlowReducer, bin, rotation } = items[selected]

	const handleOnCameraSelectedChange = useCallback((item: AstroBinEquipmentPopoverItem) => {
		const { w = 0, h = 0, ps = 0 } = item

		fov.update('cameraWidth', w)
		fov.update('cameraHeight', h)
		fov.update('pixelWidth', ps)
		fov.update('pixelHeight', ps)
	}, [])

	const handleOnTelescopeSelectedChange = useCallback((item: AstroBinEquipmentPopoverItem) => {
		const { ap = 0, fl = 0 } = item

		fov.update('aperture', ap)
		fov.update('focalLength', fl)
	}, [])

	return (
		<>
			<div className='col-span-2'>
				<AstroBinEquipmentPopover items={telescopes} onSelectedChange={handleOnTelescopeSelectedChange} type='telescope' />
			</div>
			<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} label='Focal Length (mm)' maxValue={100000} minValue={100} onValueChange={(value) => fov.update('focalLength', value)} size='sm' value={focalLength} />
			<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} label='Aperture (mm)' maxValue={10000} minValue={10} onValueChange={(value) => fov.update('aperture', value)} size='sm' value={aperture} />
			<div className='col-span-2'>
				<AstroBinEquipmentPopover items={cameras} onSelectedChange={handleOnCameraSelectedChange} type='camera' />
			</div>
			<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} label='Width (px)' maxValue={100000} minValue={100} onValueChange={(value) => fov.update('cameraWidth', value)} size='sm' value={cameraWidth} />
			<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} label='Height (px)' maxValue={100000} minValue={100} onValueChange={(value) => fov.update('cameraHeight', value)} size='sm' value={cameraHeight} />
			<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} label='Width (µm)' maxValue={100} minValue={1} onValueChange={(value) => fov.update('pixelWidth', value)} size='sm' step={0.01} value={pixelWidth} />
			<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} label='Height (µm)' maxValue={100} minValue={1} onValueChange={(value) => fov.update('pixelHeight', value)} size='sm' step={0.01} value={pixelHeight} />
			<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} label='Rotation (°)' maxValue={360} minValue={-360} onValueChange={(value) => fov.update('rotation', value)} size='sm' step={0.1} value={rotation} />
			<NumberInput className='col-span-5' formatOptions={DECIMAL_NUMBER_FORMAT} label='Barlow/Reducer' maxValue={10} minValue={0.1} onValueChange={(value) => fov.update('barlowReducer', value)} size='sm' step={0.01} value={barlowReducer} />
			<NumberInput className='col-span-3' formatOptions={DECIMAL_NUMBER_FORMAT} label='Bin' maxValue={8} minValue={1} onValueChange={(value) => fov.update('bin', value)} size='sm' value={bin} />
			<div className='col-span-4 flex flex-row items-center justify-center gap-2'>
				<Tooltip content='Add' placement='bottom' showArrow>
					<IconButton className='col-span-2' color='success' icon={Icons.Plus} onPointerUp={fov.add} />
				</Tooltip>
				<Tooltip content='Remove' placement='bottom' showArrow>
					<IconButton className='col-span-2' color='danger' icon={Icons.Trash} isDisabled={items.length <= 1} onPointerUp={fov.remove} />
				</Tooltip>
			</div>
		</>
	)
})

const FovItemList = memo(() => {
	const fov = useMolecule(ImageFovMolecule)
	const { items, selected } = useSnapshot(fov.state)

	return (
		<Listbox className='col-span-full' classNames={{ list: 'max-h-[146px] overflow-scroll pe-1' }} onAction={(value) => fov.select(+value)} selectionMode='none'>
			{items.map((item, index) => {
				return (
					<ListboxItem className={clsx({ 'bg-green-600/10': index === selected })} key={item.id}>
						<div className='flex flex-row gap-1 items-center justify-between ps-3 border-l-2' style={{ borderColor: item.color }}>
							<div className='flex flex-col items-center justify-center'>
								<Checkbox isSelected={item.visible} onValueChange={(selected) => fov.update('visible', selected, item.id)} />
							</div>
							<div className='flex flex-row flex-wrap gap-1 items-center justify-between'>
								<span>
									<strong>FL:</strong> {item.focalLength}mm
								</span>
								<span>
									<strong>AP:</strong> {item.aperture}mm
								</span>
								<span>
									<strong>SZ:</strong> {item.cameraWidth}x{item.cameraHeight} px
								</span>
								<span>
									<strong>PS:</strong> {item.pixelWidth.toFixed(2)}x{item.pixelHeight.toFixed(2)} µm
								</span>
								<span>
									<strong>BIN:</strong> {item.bin}
								</span>
								<span>
									<strong>B/R:</strong> {item.barlowReducer.toFixed(2)}x
								</span>
								<span>
									<strong>ROT:</strong> {item.rotation.toFixed(1)}°
								</span>
							</div>
						</div>
					</ListboxItem>
				)
			})}
		</Listbox>
	)
})
