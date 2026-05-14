import { useMolecule } from 'bunshi/react'
import type { SCNRProtectionMethod } from 'nebulosa/src/image.types'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageScnrMolecule } from '@/molecules/image/scnr'
import { Button } from './components/Button'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { ImageChannelButtonGroup } from './ImageChannelButtonGroup'
import { Modal } from './Modal'
import { SCNRProtectionMethodSelect } from './SCNRProtectionMethodSelect'

function isMaskProtectionMethod(method: SCNRProtectionMethod) {
	return method.endsWith('MASK')
}

export const ImageScnr = memo(() => {
	const scnr = useMolecule(ImageScnrMolecule)

	return (
		<Modal footer={<Footer />} header="SCNR" id={`scnr-${scnr.viewer.storageKey}`} maxWidth="288px" onHide={scnr.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const scnr = useMolecule(ImageScnrMolecule)
	const { method, amount, channel } = useSnapshot(scnr.state.scnr)
	const hasChannel = channel !== undefined
	const amountDisabled = !hasChannel || isMaskProtectionMethod(method)

	return (
		<div className="mt-0 grid grid-cols-12 items-center gap-2">
			<ImageChannelButtonGroup allowNoneSelection className="col-span-full min-w-0" fullWidth onValueChange={(value) => scnr.update('channel', value)} value={channel} />
			<SCNRProtectionMethodSelect className="col-span-8 min-w-0" disabled={!hasChannel} fullWidth onValueChange={(value) => scnr.update('method', value)} value={method} />
			<NumberInput className="col-span-4 min-w-0" disabled={amountDisabled} fractionDigits={1} label="Amount" maxValue={1} minValue={0} onValueChange={(value) => scnr.update('amount', value)} step={0.1} value={amount} />
		</div>
	)
})

const Footer = memo(() => {
	const scnr = useMolecule(ImageScnrMolecule)

	return (
		<>
			<Button color="danger" label="Reset" onPointerUp={scnr.reset} startContent={<Icons.Restore />} />
			<Button color="success" label="Apply" onPointerUp={scnr.apply} startContent={<Icons.Check />} />
		</>
	)
})
