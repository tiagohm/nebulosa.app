import { Badge, Button, Checkbox, ListboxItem, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { IndiServerMolecule } from '@/molecules/indi/server'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import DRIVERS from '../../../data/drivers.json' with { type: 'json' }
import { FilterableListbox } from './FilterableListBox'
import { Icons } from './Icon'
import { Modal } from './Modal'

export const IndiServer = memo(() => {
	const indi = useMolecule(IndiServerMolecule)
	const { running, showAll, drivers: availableDrivers } = useSnapshot(indi.state)
	const { port, repeat, verbose, drivers } = useSnapshot(indi.state.request, { sync: true })

	return (
		<Modal
			footer={
				<>
					<Button color='danger' isDisabled={!running} onPointerUp={indi.stop} startContent={<Icons.Stop />} variant='flat'>
						Stop
					</Button>
					<Badge color='success' content={drivers.length} showOutline={false}>
						<Button color='success' isDisabled={running || drivers.length === 0} onPointerUp={indi.start} startContent={<Icons.Play />} variant='flat'>
							Start
						</Button>
					</Badge>
				</>
			}
			header='INDI Server'
			maxWidth='280px'
			name='indi-server'
			onClose={indi.close}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => indi.update('port', value)} size='sm' value={port} />
				<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} label='Repeat' maxValue={10} minValue={1} onValueChange={(value) => indi.update('repeat', value)} size='sm' value={repeat} />
				<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} label='Verbose' maxValue={3} minValue={0} onValueChange={(value) => indi.update('verbose', value)} size='sm' value={verbose} />
				<Checkbox className='col-span-full' isSelected={showAll} onValueChange={(value) => (indi.state.showAll = value)}>
					Show all drivers
				</Checkbox>
				<FilterableListbox
					className='col-span-full'
					classNames={{ list: 'max-h-[200px] overflow-scroll' }}
					filter={(item, search) => item.name.toLowerCase().includes(search) || item.driver.includes(search)}
					items={showAll || availableDrivers.length === 0 ? DRIVERS : DRIVERS.filter((e) => availableDrivers.includes(e.driver))}
					onSelectionChange={(value) => indi.update('drivers', [...(value as Set<string>)])}
					selectedKeys={new Set(drivers)}
					selectionMode='multiple'
					variant='flat'>
					{(item) => (
						<ListboxItem description={item.driver} key={item.driver}>
							{item.name}
						</ListboxItem>
					)}
				</FilterableListbox>
			</div>
		</Modal>
	)
})
