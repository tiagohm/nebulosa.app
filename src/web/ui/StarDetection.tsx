import type { UseDraggableModalResult } from '@/shared/hooks'
import { ImageViewerMolecule } from '@/shared/molecules'
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, Select, SelectItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'

export interface StarDetectionProps {
	readonly draggable: UseDraggableModalResult
}

export function StarDetection({ draggable }: StarDetectionProps) {
	const viewer = useMolecule(ImageViewerMolecule)
	const { starDetection, info } = useSnapshot(viewer.state)

	return (
		<Modal size='sm' ref={draggable.targetRef} isOpen={draggable.isOpen} onOpenChange={draggable.onOpenChange} classNames={{ base: 'max-w-[410px] max-h-[90vh]', wrapper: 'pointer-events-none' }} backdrop='transparent' isDismissable={false}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...draggable.moveProps} className='flex flex-col gap-0'>
							<span>Star Detection</span>
							<span className='text-xs font-normal italic'>{info?.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'>
								<Select disallowEmptySelection className='col-span-4' size='sm' selectionMode='single' label='Type' selectedKeys={new Set([starDetection.request.type])} onSelectionChange={(value) => (viewer.state.starDetection.request.type = (value as Set<string>).values().next().value as never)}>
									<SelectItem key='ASTAP'>Astap</SelectItem>
								</Select>
								<NumberInput label='Min SNR' className='col-span-4' size='sm' minValue={0} maxValue={500} value={starDetection.request.minSNR} onValueChange={(value) => (viewer.state.starDetection.request.minSNR = value)} />
								<NumberInput label='Max Stars' className='col-span-4' size='sm' minValue={0} maxValue={2000} value={starDetection.request.maxStars} onValueChange={(value) => (viewer.state.starDetection.request.maxStars = value)} />
								<div className='col-span-full mt-1'>
									<span className='text-sm font-bold'>COMPUTED</span>
								</div>
								<Input isReadOnly className='col-span-2' size='sm' label='Stars' value={starDetection.stars.length.toFixed(0)} />
								<Input isReadOnly className='col-span-2' size='sm' label='HFD' value={starDetection.computed.hfd.toFixed(2)} />
								<Input isReadOnly className='col-span-2' size='sm' label='SNR' value={starDetection.computed.snr.toFixed(0)} />
								<Input isReadOnly className='col-span-6' size='sm' label='Flux' value={`${starDetection.computed.fluxMin.toFixed(0)} | ${starDetection.computed.fluxMax.toFixed(0)}`} />
								<div className='col-span-full mt-1'>
									<span className='text-sm font-bold'>SELECTED</span>
								</div>
								<div className='col-span-4 row-span-4 flex justify-center'>
									<canvas id={`${viewer.scope.image.key}-selected-star`} className='pixelated h-27 w-27 rounded-md bg-slate-950' />
								</div>
								<Input isReadOnly className='col-span-4' size='sm' label='X | Y' value={`${starDetection.selected?.x.toFixed(0) ?? '0'} | ${starDetection.selected?.y.toFixed(0) ?? '0'}`} />
								<Input isReadOnly className='col-span-4' size='sm' label='Flux' value={starDetection.selected?.flux.toFixed(0) ?? '0'} />
								<Input isReadOnly className='col-span-4' size='sm' label='HFD' value={starDetection.selected?.hfd.toFixed(2) ?? '0'} />
								<Input isReadOnly className='col-span-4' size='sm' label='SNR' value={starDetection.selected?.snr.toFixed(0) ?? '0'} />
							</div>
						</ModalBody>
						<ModalFooter>
							<Button isLoading={starDetection.loading} color='success' variant='light' startContent={<Lucide.Check />} onPointerUp={() => viewer.detectStars()}>
								Detect
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
