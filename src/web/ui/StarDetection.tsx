import { Input } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { StarDetectionMolecule } from '@/molecules/image/stardetection'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { StarDetectionPopover } from './StarDetectionPopover'
import { StarDetectionSelect } from './StarDetectionSelect'
import { TextButton } from './TextButton'

export const StarDetection = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)

	return (
		<Modal footer={<Footer />} header='Star Detection' id={`star-detection-${starDetection.viewer.storageKey}`} maxWidth='312px' onHide={starDetection.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { type } = useSnapshot(starDetection.state.request)

	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<StarDetectionSelect className='col-span-full' endContent={<StarDetectionEndContent />} onValueChange={(value) => starDetection.update('type', value)} value={type} />
			<Computed />
			<Selected />
		</div>
	)
})

const StarDetectionEndContent = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { request } = useSnapshot(starDetection.state)

	return <StarDetectionPopover isRounded onValueChange={starDetection.update} size='sm' value={request} variant='light' />
})

const Computed = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { stars, computed } = useSnapshot(starDetection.state)

	return (
		<>
			<span className='col-span-full mt-1 text-sm font-bold'>COMPUTED</span>
			<Input className='col-span-3' isReadOnly label='Stars' size='sm' value={stars.length.toFixed(0)} />
			<Input className='col-span-2' isReadOnly label='HFD' size='sm' value={computed.hfd.toFixed(2)} />
			<Input className='col-span-2' isReadOnly label='SNR' size='sm' value={computed.snr.toFixed(0)} />
			<Input className='col-span-5' isReadOnly label='Flux' size='sm' value={`${computed.fluxMin.toFixed(0)} | ${computed.fluxMax.toFixed(0)}`} />
		</>
	)
})

const Selected = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { selected } = useSnapshot(starDetection.state)

	return (
		<>
			<span className='col-span-full mt-1 text-sm font-bold'>SELECTED</span>
			<div className='col-span-4 row-span-4 flex justify-center'>
				<canvas className='pixelated h-27 w-27 rounded-md bg-slate-950' ref={starDetection.attach} />
			</div>
			<Input className='col-span-4' isReadOnly label='X | Y' size='sm' value={`${selected?.x.toFixed(0) ?? '0'} | ${selected?.y.toFixed(0) ?? '0'}`} />
			<Input className='col-span-4' isReadOnly label='Flux' size='sm' value={selected?.flux.toFixed(0) ?? '0'} />
			<Input className='col-span-4' isReadOnly label='HFD' size='sm' value={selected?.hfd.toFixed(2) ?? '0'} />
			<Input className='col-span-4' isReadOnly label='SNR' size='sm' value={selected?.snr.toFixed(0) ?? '0'} />
		</>
	)
})

const Footer = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { loading } = useSnapshot(starDetection.state)

	return <TextButton color='success' isLoading={loading} label='Detect' onPointerUp={starDetection.detect} startContent={<Icons.Check />} />
})
