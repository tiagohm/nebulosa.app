import { Button, Checkbox, Chip, Input, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import { memo, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { FramingMolecule } from '@/molecules/framing'
import { HipsSurveySelect } from './HipsSurveySelect'
import { Modal } from './Modal'
import { PoweredBy } from './PoweredBy'

export const Framing = memo(() => {
	const framing = useMolecule(FramingMolecule)
	const { hipsSurveys, loading, openNewImage } = useSnapshot(framing.state)
	const { rightAscension, declination, width, height, rotation, focalLength, pixelSize, hipsSurvey } = useSnapshot(framing.state.request, { sync: true })

	const fov = useMemo(() => {
		const size = angularSizeOfPixel(focalLength, pixelSize)
		return `${((size * width) / 3600).toFixed(2)}° x ${((size * height) / 3600).toFixed(2)}°`
	}, [focalLength, pixelSize, width, height])

	return (
		<Modal
			footer={
				<>
					<div className='flex-1 flex items-center'>
						<Chip color='primary'>{fov}</Chip>
					</div>
					<Button color='success' isLoading={loading} onPointerUp={framing.load} startContent={<Lucide.Download size={18} />} variant='flat'>
						Load
					</Button>
				</>
			}
			header={
				<div className='flex flex-row items-center gap-2'>
					<span>Framing</span>
					<PoweredBy href='https://alasky.cds.unistra.fr/hips-image-services/hips2fits' label='hips2Fits' />
				</div>
			}
			maxWidth='300px'
			name='framing'
			onClose={framing.close}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<Input className='col-span-6' isDisabled={loading} label='RA (J2000)' onValueChange={(value) => framing.update('rightAscension', value)} size='sm' value={rightAscension} />
				<Input className='col-span-6' isDisabled={loading} label='DEC (J2000)' onValueChange={(value) => framing.update('declination', value)} size='sm' value={declination} />
				<NumberInput className='col-span-4' isDisabled={loading} label='Width' maxValue={8192} minValue={100} onValueChange={(value) => framing.update('width', value)} size='sm' value={width} />
				<NumberInput className='col-span-4' isDisabled={loading} label='Height' maxValue={8192} minValue={100} onValueChange={(value) => framing.update('height', value)} size='sm' value={height} />
				<NumberInput className='col-span-4' isDisabled={loading} label='Rotation (°)' maxValue={360} minValue={-360} onValueChange={(value) => framing.update('rotation', value)} size='sm' step={0.1} value={rotation} />
				<NumberInput className='col-span-6' isDisabled={loading} label='Focal Length (mm)' maxValue={100000} minValue={0} onValueChange={(value) => framing.update('focalLength', value)} size='sm' value={focalLength} />
				<NumberInput className='col-span-6' isDisabled={loading} label='Pixel size (µm)' maxValue={1000} minValue={0} onValueChange={(value) => framing.update('pixelSize', value)} size='sm' step={0.01} value={pixelSize} />
				<HipsSurveySelect className='col-span-full' isDisabled={loading} items={hipsSurveys} onValueChange={(value) => framing.update('hipsSurvey', value)} value={hipsSurvey} />
				<Checkbox className='col-span-full' isDisabled={loading} isSelected={openNewImage} onValueChange={(value) => (framing.state.openNewImage = value)}>
					Open in new image
				</Checkbox>
			</div>
		</Modal>
	)
})
