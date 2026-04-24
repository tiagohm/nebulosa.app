import { Badge } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { IndiServerMolecule } from '@/molecules/indi/server'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { IndiDriverListbox } from './IndiDriverListbox'
import { Modal } from './Modal'

export const IndiServer = memo(() => {
	const indi = useMolecule(IndiServerMolecule)

	return (
		<Modal footer={<Footer />} header="INDI Server" id="indi-server" maxWidth="276px" onHide={indi.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<Inputs />
			<Drivers />
		</div>
	)
})

const Inputs = memo(() => {
	const indi = useMolecule(IndiServerMolecule)
	const { showAll } = useSnapshot(indi.state)
	const { port, repeat, verbose } = useSnapshot(indi.state.request)

	return (
		<>
			<NumberInput className="col-span-4" label="Port" maxValue={65535} minValue={80} onValueChange={(value) => indi.update('port', value)} value={port} />
			<NumberInput className="col-span-4" label="Repeat" maxValue={10} minValue={1} onValueChange={(value) => indi.update('repeat', value)} value={repeat} />
			<NumberInput className="col-span-4" label="Verbose" maxValue={3} minValue={0} onValueChange={(value) => indi.update('verbose', value)} value={verbose} />
			<Checkbox className="col-span-full" label="Show all drivers" onValueChange={(value) => (indi.state.showAll = value)} value={showAll} />
		</>
	)
})

const Drivers = memo(() => {
	const indi = useMolecule(IndiServerMolecule)
	const { showAll } = useSnapshot(indi.state)
	const { drivers } = useSnapshot(indi.state.request)

	return <IndiDriverListbox onSelectedChange={(drivers) => indi.update('drivers', drivers)} selected={drivers} showAll={showAll} />
})

const Footer = memo(() => {
	const indi = useMolecule(IndiServerMolecule)
	const { running } = useSnapshot(indi.state)
	const { drivers } = useSnapshot(indi.state.request)

	return (
		<>
			<Button color="danger" disabled={!running} label="Stop" onPointerUp={indi.stop} startContent={<Icons.Stop />} />
			<Badge color="success" content={drivers.length} showOutline={false}>
				<Button color="success" disabled={running || drivers.length === 0} label="Start" onPointerUp={indi.start} startContent={<Icons.Play />} />
			</Badge>
		</>
	)
})
