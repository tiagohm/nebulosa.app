import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, Select, SelectItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FramingMolecule } from '@/molecules/framing'
import { useModal } from '@/shared/hooks'
import { DeclinationInput } from './DeclinationInput'
import { RightAscensionInput } from './RightAscensionInput'

export const Framing = memo(() => {
	const framing = useMolecule(FramingMolecule)
	const { request, hipsSurveys, loading } = useSnapshot(framing.state)
	const modal = useModal(() => framing.close())

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[325px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps}>Framing</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'>
								<RightAscensionInput className='col-span-6' isDisabled={loading} label='RA (J2000)' onValueChange={(value) => framing.update('rightAscension', value)} value={request.rightAscension} />
								<DeclinationInput className='col-span-6' isDisabled={loading} label='DEC (J2000)' onValueChange={(value) => framing.update('declination', value)} value={request.declination} />
								<NumberInput className='col-span-4' isDisabled={loading} label='Width' maxValue={8192} minValue={100} onValueChange={(value) => framing.update('width', value)} size='sm' value={request.width} />
								<NumberInput className='col-span-4' isDisabled={loading} label='Height' maxValue={8192} minValue={100} onValueChange={(value) => framing.update('height', value)} size='sm' value={request.height} />
								<NumberInput className='col-span-4' isDisabled={loading} label='Rotation (°)' maxValue={360} minValue={-360} onValueChange={(value) => framing.update('rotation', value)} size='sm' step={0.1} value={request.rotation} />
								<NumberInput className='col-span-6' isDisabled={loading} label='Focal Length (mm)' maxValue={100000} minValue={0} onValueChange={(value) => framing.update('focalLength', value)} size='sm' value={request.focalLength} />
								<NumberInput className='col-span-6' isDisabled={loading} label='Pixel size (µm)' maxValue={1000} minValue={0} onValueChange={(value) => framing.update('pixelSize', value)} size='sm' step={0.01} value={request.pixelSize} />
								<Select
									className='col-span-full'
									disallowEmptySelection
									isDisabled={loading || hipsSurveys.length === 0}
									isVirtualized
									itemHeight={42}
									items={hipsSurveys}
									onSelectionChange={(value) => framing.update('hipsSurvey', (value as Set<string>).values().next().value as never)}
									renderValue={(selected) => {
										return selected.map((item) => (
											<div className='p-1 flex flex-col justify-center gap-0' key={item.data!.id}>
												<span className='font-bold whitespace-nowrap'>{item.data!.id}</span>
												<span className='text-default-500 text-sm flex gap-1 items-center'>
													{item.data!.regime} ({(item.data!.skyFraction * 100).toFixed(1)}%)
												</span>
											</div>
										))
									}}
									selectedKeys={new Set([request.hipsSurvey])}
									selectionMode='single'
									size='sm'>
									{(item) => (
										<SelectItem key={item.id} textValue={item.id}>
											<div className='p-1 flex flex-col justify-center gap-0' key={item.id}>
												<span className='font-bold whitespace-nowrap'>{item.id}</span>
												<span className='text-default-500 text-xs flex gap-1 items-center'>
													{item.regime} ({(item.skyFraction * 100).toFixed(1)}%)
												</span>
											</div>
										</SelectItem>
									)}
								</Select>
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='success' isLoading={loading} onPointerUp={() => framing.load()} startContent={<Lucide.Download />} variant='flat'>
								Load
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
