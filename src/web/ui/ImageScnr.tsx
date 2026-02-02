import { NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageScnrMolecule } from '@/molecules/image/scnr'
import { DECIMAL_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { ImageChannelButtonGroup } from './ImageChannelButtonGroup'
import { Modal } from './Modal'
import { SCNRProtectionMethodSelect } from './SCNRProtectionMethodSelect'
import { TextButton } from './TextButton'

export const ImageScnr = memo(() => {
	const scnr = useMolecule(ImageScnrMolecule)
	const { method, amount, channel } = useSnapshot(scnr.state.scnr)

	const Footer = (
		<>
			<TextButton color='danger' label='Reset' onPointerUp={scnr.reset} startContent={<Icons.Restore />} />
			<TextButton color='success' label='Apply' onPointerUp={scnr.apply} startContent={<Icons.Check />} />
		</>
	)

	return (
		<Modal footer={Footer} header='SCNR' id={`scnr-${scnr.viewer.storageKey}`} maxWidth='288px' onHide={scnr.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<ImageChannelButtonGroup allowNoneSelection className='col-span-full' onValueChange={(value) => scnr.update('channel', value)} value={channel} />
				<SCNRProtectionMethodSelect className='col-span-8' isDisabled={channel === undefined} onValueChange={(value) => scnr.update('method', value)} value={method} />
				<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={channel === undefined || method.endsWith('MASK')} label='Amount' maxValue={1} minValue={0} onValueChange={(value) => scnr.update('amount', value)} size='sm' step={0.1} value={amount} />
			</div>
		</Modal>
	)
})
