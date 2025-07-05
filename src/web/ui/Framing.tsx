import { Button, Checkbox, Chip, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import { memo, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { FramingMolecule } from '@/molecules/framing'
import { useModal } from '@/shared/hooks'
import { DeclinationInput } from './DeclinationInput'
import { HipsSurveySelect } from './HipsSurveySelect'
import { RightAscensionInput } from './RightAscensionInput'

export const Framing = memo(() => {
	const framing = useMolecule(FramingMolecule)
	const { request, hipsSurveys, loading, openNewImage } = useSnapshot(framing.state)
	const modal = useModal(() => framing.close())

	const fov = useMemo(() => {
		const size = angularSizeOfPixel(request.focalLength, request.pixelSize)
		return `${((size * request.width) / 3600).toFixed(2)}° x ${((size * request.height) / 3600).toFixed(2)}°`
	}, [request.focalLength, request.pixelSize, request.width, request.height])

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[310px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps}>Framing</ModalHeader>
						<ModalBody>
							<div className='mt-0 grid grid-cols-12 gap-2'>
								<RightAscensionInput className='col-span-6' isDisabled={loading} label='RA (J2000)' onValueChange={(value) => framing.update('rightAscension', value)} value={request.rightAscension} />
								<DeclinationInput className='col-span-6' isDisabled={loading} label='DEC (J2000)' onValueChange={(value) => framing.update('declination', value)} value={request.declination} />
								<NumberInput className='col-span-4' isDisabled={loading} label='Width' maxValue={8192} minValue={100} onValueChange={(value) => framing.update('width', value)} size='sm' value={request.width} />
								<NumberInput className='col-span-4' isDisabled={loading} label='Height' maxValue={8192} minValue={100} onValueChange={(value) => framing.update('height', value)} size='sm' value={request.height} />
								<NumberInput className='col-span-4' isDisabled={loading} label='Rotation (°)' maxValue={360} minValue={-360} onValueChange={(value) => framing.update('rotation', value)} size='sm' step={0.1} value={request.rotation} />
								<NumberInput className='col-span-6' isDisabled={loading} label='Focal Length (mm)' maxValue={100000} minValue={0} onValueChange={(value) => framing.update('focalLength', value)} size='sm' value={request.focalLength} />
								<NumberInput className='col-span-6' isDisabled={loading} label='Pixel size (µm)' maxValue={1000} minValue={0} onValueChange={(value) => framing.update('pixelSize', value)} size='sm' step={0.01} value={request.pixelSize} />
								<HipsSurveySelect className='col-span-full' isDisabled={loading} items={hipsSurveys} onValueChange={(value) => framing.update('hipsSurvey', value)} value={request.hipsSurvey} />
								<Checkbox className='col-span-full' isDisabled={loading} isSelected={openNewImage} onValueChange={(value) => (framing.state.openNewImage = value)} size='sm'>
									Open in new image
								</Checkbox>
								<div className='col-span-full text-center mt-2 text-neutral-500 text-sm'>
									Powered by&nbsp;
									<a className='bg-neutral-800 px-1 rounded p-1' href='https://alasky.cds.unistra.fr/hips-image-services/hips2fits' rel='noreferrer' target='_blank'>
										hips2fits
									</a>
								</div>
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<div className='flex-1 flex items-center select-none'>
								<Chip color='primary'>{fov}</Chip>
							</div>
							<Button color='success' isLoading={loading} onPointerUp={framing.load} startContent={<Lucide.Download size={18} />} variant='flat'>
								Load
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
