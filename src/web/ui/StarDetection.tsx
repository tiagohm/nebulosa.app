import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { StarDetectionMolecule } from '@/molecules/image/stardetection'
import { formatNumber } from '@/shared/util'
import { Button } from './components/Button'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { StarDetectionPopover } from './StarDetectionPopover'
import { StarDetectionSelect } from './StarDetectionSelect'

export const StarDetection = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)

	return (
		<Modal footer={<Footer />} header="Star Detection" id={`star-detection-${starDetection.viewer.storageKey}`} maxWidth="312px" onHide={starDetection.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { type } = useSnapshot(starDetection.state.request)
	const { loading } = useSnapshot(starDetection.state)

	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<StarDetectionSelect className="col-span-full" disabled={loading} endContent={<StarDetectionEndContent />} onValueChange={(value) => starDetection.update('type', value)} value={type} />
			<Computed />
			<Selected />
		</div>
	)
})

const StarDetectionEndContent = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { loading, request } = useSnapshot(starDetection.state)

	return <StarDetectionPopover disabled={loading} onValueChange={starDetection.update} value={request} variant="ghost" />
})

const Computed = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { stars, computed } = useSnapshot(starDetection.state)

	return (
		<>
			<span className="col-span-full mt-1 text-sm font-bold">COMPUTED</span>
			<TextInput className="col-span-3" label="Stars" readOnly value={stars.length.toFixed(0)} />
			<TextInput className="col-span-2" label="HFD" readOnly value={computed.hfd.toFixed(2)} />
			<TextInput className="col-span-2" label="SNR" readOnly value={computed.snr.toFixed(0)} />
			<TextInput className="col-span-5" label="Flux" readOnly value={`${computed.fluxMin.toFixed(0)} | ${computed.fluxMax.toFixed(0)}`} />
		</>
	)
})

const Selected = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { selected } = useSnapshot(starDetection.state)

	return (
		<>
			<span className="col-span-full mt-1 text-sm font-bold">SELECTED</span>
			<div className="col-span-4 row-span-4 flex justify-center">
				<canvas className="pixelated h-27 w-27 rounded-md bg-slate-950" ref={starDetection.attach} />
			</div>
			<TextInput className="col-span-4" label="X | Y" readOnly value={`${formatNumber(selected?.x, 0)} | ${formatNumber(selected?.y, 0)}`} />
			<TextInput className="col-span-4" label="Flux" readOnly value={formatNumber(selected?.flux, 0)} />
			<TextInput className="col-span-4" label="HFD" readOnly value={formatNumber(selected?.hfd, 2)} />
			<TextInput className="col-span-4" label="SNR" readOnly value={formatNumber(selected?.snr, 0)} />
		</>
	)
})

const Footer = memo(() => {
	const starDetection = useMolecule(StarDetectionMolecule)
	const { loading } = useSnapshot(starDetection.state)

	return <Button color="success" disabled={loading} label="Detect" loading={loading} onClick={starDetection.detect} startContent={<Icons.Check />} />
})
