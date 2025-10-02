import { ButtonGroup, NumberInput, Select, SelectItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageScnrMolecule } from '@/molecules/image/scnr'
import { DECIMAL_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageScnr = memo(() => {
	const scnr = useMolecule(ImageScnrMolecule)
	const { method, amount, channel } = useSnapshot(scnr.state)

	const Footer = (
		<>
			<TextButton color='danger' label='Reset' onPointerUp={scnr.reset} startContent={<Icons.Restore />} />
			<TextButton color='success' label='Apply' onPointerUp={scnr.apply} startContent={<Icons.Check />} />
		</>
	)

	return (
		<Modal footer={Footer} header='SCNR' id={`scnr-${scnr.scope.image.key}`} maxWidth='295px' onHide={scnr.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<ButtonGroup className='col-span-full'>
					<TextButton color='secondary' label='NONE' onPointerUp={() => scnr.update('channel', undefined)} variant={channel === undefined ? 'flat' : 'light'} />
					<TextButton color='danger' label='RED' onPointerUp={() => scnr.update('channel', 'RED')} variant={channel === 'RED' ? 'flat' : 'light'} />
					<TextButton color='success' label='GREEN' onPointerUp={() => scnr.update('channel', 'GREEN')} variant={channel === 'GREEN' ? 'flat' : 'light'} />
					<TextButton color='primary' label='BLUE' onPointerUp={() => scnr.update('channel', 'BLUE')} variant={channel === 'BLUE' ? 'flat' : 'light'} />
				</ButtonGroup>
				<Select className='col-span-8' disallowEmptySelection isDisabled={channel === undefined} label='Method' onSelectionChange={(value) => scnr.update('method', (value as Set<string>).values().next().value as never)} selectedKeys={new Set([method])} size='sm'>
					<SelectItem key='MAXIMUM_MASK'>Maximum Mask</SelectItem>
					<SelectItem key='ADDITIVE_MASK'>Additive Mask</SelectItem>
					<SelectItem key='AVERAGE_NEUTRAL'>Average Neutral</SelectItem>
					<SelectItem key='MAXIMUM_NEUTRAL'>Maximum Neutral</SelectItem>
					<SelectItem key='MINIMUM_NEUTRAL'>Minimum Neutral</SelectItem>
				</Select>
				<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={channel === undefined || method.endsWith('MASK')} label='Amount' maxValue={1} minValue={0} onValueChange={(value) => scnr.update('amount', value)} size='sm' step={0.1} value={amount} />
			</div>
		</Modal>
	)
})
