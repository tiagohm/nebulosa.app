import { Button, Input, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { StarDetectionMolecule } from '@/molecules/image/stardetection'
import { Modal } from './Modal'
import { StarDetectionSelect } from './StarDetectionSelect'

export const StarDetection = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { viewer } = starDetection
	const { loading, stars, computed, selected } = useSnapshot(starDetection.state)
	const request = useSnapshot(starDetection.state.request, { sync: true })
	const { info } = useSnapshot(viewer.state)

	return (
		<Modal
			footer={
				<Button color='success' isLoading={loading} onPointerUp={starDetection.detect} startContent={<Lucide.Check size={18} />} variant='flat'>
					Detect
				</Button>
			}
			header={
				<div className='w-full flex flex-col justify-center gap-0'>
					<span>Star Detection</span>
					<span className='text-xs font-normal text-gray-400 max-w-full'>{info.originalPath}</span>
				</div>
			}
			maxWidth='310px'
			name={`star-detection-${starDetection.scope.image.key}`}
			onClose={() => viewer.closeModal('starDetection')}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<StarDetectionSelect className='col-span-4' onValueChange={(value) => (starDetection.state.request.type = value)} value={request.type} />
				<NumberInput className='col-span-4' label='Min SNR' maxValue={500} minValue={0} onValueChange={(value) => (starDetection.state.request.minSNR = value)} size='sm' value={request.minSNR} />
				<NumberInput className='col-span-4' label='Max Stars' maxValue={2000} minValue={0} onValueChange={(value) => (starDetection.state.request.maxStars = value)} size='sm' value={request.maxStars} />
				<div className='col-span-full mt-1'>
					<span className='text-sm font-bold'>COMPUTED</span>
				</div>
				<Input className='col-span-3' isReadOnly label='Stars' size='sm' value={stars.length.toFixed(0)} />
				<Input className='col-span-2' isReadOnly label='HFD' size='sm' value={computed.hfd.toFixed(2)} />
				<Input className='col-span-2' isReadOnly label='SNR' size='sm' value={computed.snr.toFixed(0)} />
				<Input className='col-span-5' isReadOnly label='Flux' size='sm' value={`${computed.fluxMin.toFixed(0)} | ${computed.fluxMax.toFixed(0)}`} />
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
		</Modal>
	)
})
