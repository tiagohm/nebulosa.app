import { Button, ButtonGroup, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, Select, SelectItem } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { useModal } from '@/shared/hooks'
import { ScnrMolecule } from '@/shared/molecules'

export function Scnr() {
	const scnr = useMolecule(ScnrMolecule)
	const { method, amount, channel } = useSnapshot(scnr.state)
	const { info } = useSnapshot(scnr.viewer.state)
	const modal = useModal(() => (scnr.viewer.state.scnr.showModal = false))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[320px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-col gap-0'>
							<span>SCNR</span>
							<span className='text-xs font-normal text-gray-400'>{info.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'>
								<ButtonGroup className='col-span-full'>
									<Button color='secondary' onPointerUp={() => scnr.update('channel', undefined)} variant={channel === undefined ? 'flat' : 'light'}>
										NONE
									</Button>
									<Button color='danger' onPointerUp={() => scnr.update('channel', 'RED')} variant={channel === 'RED' ? 'flat' : 'light'}>
										RED
									</Button>
									<Button color='success' onPointerUp={() => scnr.update('channel', 'GREEN')} variant={channel === 'GREEN' ? 'flat' : 'light'}>
										GREEN
									</Button>
									<Button color='primary' onPointerUp={() => scnr.update('channel', 'BLUE')} variant={channel === 'BLUE' ? 'flat' : 'light'}>
										BLUE
									</Button>
								</ButtonGroup>
								<Select className='col-span-8' disallowEmptySelection isDisabled={channel === undefined} label='Method' onSelectionChange={(value) => scnr.update('method', (value as Set<string>).values().next().value as never)} selectedKeys={new Set([method])} size='sm'>
									<SelectItem key='MAXIMUM_MASK'>Maximum Mask</SelectItem>
									<SelectItem key='ADDITIVE_MASK'>Additive Mask</SelectItem>
									<SelectItem key='AVERAGE_NEUTRAL'>Average Neutral</SelectItem>
									<SelectItem key='MAXIMUM_NEUTRAL'>Maximum Neutral</SelectItem>
									<SelectItem key='MINIMUM_NEUTRAL'>Minimum Neutral</SelectItem>
								</Select>
								<NumberInput className='col-span-4' isDisabled={channel === undefined || method.endsWith('MASK')} label='Amount' maxValue={1} minValue={0} onValueChange={(value) => scnr.update('amount', value)} size='sm' step={0.1} value={amount} />
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='success' onPointerUp={() => scnr.apply()} startContent={<Lucide.Check />} variant='flat'>
								Apply
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
}
