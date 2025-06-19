import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, Select, SelectItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { useModal } from '@/shared/hooks'
import { StarDetectionMolecule } from '@/shared/molecules'

export function StarDetection() {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { loading, stars, request, computed, selected } = useSnapshot(starDetection.state)
	const { info } = useSnapshot(starDetection.viewer.state)
	const modal = useModal(() => (starDetection.state.showModal = false))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[360px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-col gap-0'>
							<span>Star Detection</span>
							<span className='text-xs font-normal text-gray-400'>{info.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'>
								<Select className='col-span-4' disallowEmptySelection label='Detector' onSelectionChange={(value) => (starDetection.state.request.type = (value as Set<string>).values().next().value as never)} selectedKeys={new Set([request.type])} selectionMode='single' size='sm'>
									<SelectItem key='ASTAP'>Astap</SelectItem>
								</Select>
								<NumberInput className='col-span-4' label='Min SNR' maxValue={500} minValue={0} onValueChange={(value) => (starDetection.state.request.minSNR = value)} size='sm' value={request.minSNR} />
								<NumberInput className='col-span-4' label='Max Stars' maxValue={2000} minValue={0} onValueChange={(value) => (starDetection.state.request.maxStars = value)} size='sm' value={request.maxStars} />
								<div className='col-span-full mt-1'>
									<span className='text-sm font-bold'>COMPUTED</span>
								</div>
								<Input className='col-span-2' isReadOnly label='Stars' size='sm' value={stars.length.toFixed(0)} />
								<Input className='col-span-2' isReadOnly label='HFD' size='sm' value={computed.hfd.toFixed(2)} />
								<Input className='col-span-2' isReadOnly label='SNR' size='sm' value={computed.snr.toFixed(0)} />
								<Input className='col-span-6' isReadOnly label='Flux' size='sm' value={`${computed.fluxMin.toFixed(0)} | ${computed.fluxMax.toFixed(0)}`} />
								<div className='col-span-full mt-1'>
									<span className='text-sm font-bold'>SELECTED</span>
								</div>
								<div className='col-span-4 row-span-4 flex justify-center'>
									<canvas className='pixelated h-27 w-27 rounded-md bg-slate-950' id={`${starDetection.scope.image.key}-selected-star`} />
								</div>
								<Input className='col-span-4' isReadOnly label='X | Y' size='sm' value={`${selected?.x.toFixed(0) ?? '0'} | ${selected?.y.toFixed(0) ?? '0'}`} />
								<Input className='col-span-4' isReadOnly label='Flux' size='sm' value={selected?.flux.toFixed(0) ?? '0'} />
								<Input className='col-span-4' isReadOnly label='HFD' size='sm' value={selected?.hfd.toFixed(2) ?? '0'} />
								<Input className='col-span-4' isReadOnly label='SNR' size='sm' value={selected?.snr.toFixed(0) ?? '0'} />
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='success' isLoading={loading} onPointerUp={() => starDetection.detect()} startContent={<Lucide.Check />} variant='flat'>
								Detect
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
