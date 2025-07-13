import { Button, ButtonGroup, NumberInput, Select, SelectItem } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageScnrMolecule } from '@/molecules/image/scnr'
import { Modal } from './Modal'

export const ImageScnr = memo(() => {
	const scnr = useMolecule(ImageScnrMolecule)
	const { viewer } = scnr
	const { method, amount, channel } = useSnapshot(scnr.state)
	const { info } = useSnapshot(viewer.state)

	return (
		<Modal
			footer={
				<>
					<Button color='danger' onPointerUp={scnr.reset} startContent={<Tabler.IconRestore size={18} />} variant='flat'>
						Reset
					</Button>
					<Button color='success' onPointerUp={scnr.apply} startContent={<Lucide.Check size={18} />} variant='flat'>
						Apply
					</Button>
				</>
			}
			header={
				<div className='w-full flex flex-col justify-center gap-0'>
					<span>SCNR</span>
					<span className='text-xs font-normal text-gray-400 max-w-full'>{info.originalPath}</span>
				</div>
			}
			name={`scnr-${scnr.scope.image.key}`}
			onClose={() => viewer.closeModal('scnr')}>
			<div className='max-w-[260px] mt-0 grid grid-cols-12 gap-2'>
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
		</Modal>
	)
})
