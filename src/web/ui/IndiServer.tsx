import { Badge, Checkbox, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { IndiServerMolecule } from '@/molecules/indi/server'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { IndiDriverListbox } from './IndiDriverListbox'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const IndiServer = memo(() => {
	const indi = useMolecule(IndiServerMolecule)
	const { running, showAll } = useSnapshot(indi.state)
	const { port, repeat, verbose, drivers } = useSnapshot(indi.state.request)

	const Footer = (
		<>
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={indi.stop} startContent={<Icons.Stop />} />
			<Badge color='success' content={drivers.length} showOutline={false}>
				<TextButton color='success' isDisabled={running || drivers.length === 0} label='Start' onPointerUp={indi.start} startContent={<Icons.Play />} />
			</Badge>
		</>
	)

	return (
		<Modal footer={Footer} header='INDI Server' id='indi-server' maxWidth='276px' onHide={indi.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => indi.update('port', value)} size='sm' value={port} />
				<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} label='Repeat' maxValue={10} minValue={1} onValueChange={(value) => indi.update('repeat', value)} size='sm' value={repeat} />
				<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} label='Verbose' maxValue={3} minValue={0} onValueChange={(value) => indi.update('verbose', value)} size='sm' value={verbose} />
				<Checkbox className='col-span-full' isSelected={showAll} onValueChange={(value) => (indi.state.showAll = value)}>
					Show all drivers
				</Checkbox>
				<IndiDriverListbox onSelectedChange={(drivers) => indi.update('drivers', drivers)} selected={drivers} showAll={showAll} />
			</div>
		</Modal>
	)
})
