import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { indiServerStore } from '@/stores/indi.server.store'
import { Badge } from './components/Badge'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { Icons } from './Icon'
import { IndiDriverListbox } from './IndiDriverListbox'
import { Modal } from './Modal'

export const IndiServer = memo(() => (
	<Modal footer={<Footer />} header="INDI Server" id="indi-server" initialWidth="276px" onHide={indiServerStore.hide}>
		<Body />
	</Modal>
))

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<Inputs />
		<Drivers />
	</div>
))

const Inputs = memo(() => {
	const { enabled, running, showAll } = useSnapshot(indiServerStore.state)
	const { port, repeat, verbose } = useSnapshot(indiServerStore.state.request)
	const blocked = !enabled || running

	return (
		<>
			<NumberInput className="col-span-4 min-w-0" disabled={blocked} label="Port" maxValue={65535} minValue={80} onValueChange={(value) => indiServerStore.update('port', value)} value={port} />
			<NumberInput className="col-span-4 min-w-0" disabled={blocked} label="Repeat" maxValue={10} minValue={1} onValueChange={(value) => indiServerStore.update('repeat', value)} value={repeat} />
			<NumberInput className="col-span-4 min-w-0" disabled={blocked} label="Verbose" maxValue={3} minValue={0} onValueChange={(value) => indiServerStore.update('verbose', value)} value={verbose} />
			<Checkbox className="col-span-full min-w-0" disabled={blocked} label="Show all drivers" onValueChange={(value) => (indiServerStore.state.showAll = value)} value={showAll} />
		</>
	)
})

const Drivers = memo(() => {
	const { enabled, running, showAll } = useSnapshot(indiServerStore.state)
	const { drivers } = useSnapshot(indiServerStore.state.request)
	const blocked = !enabled || running

	return (
		<div className={blocked ? 'pointer-events-none col-span-full min-w-0 opacity-50' : 'col-span-full min-w-0'}>
			<IndiDriverListbox onSelectedChange={blocked ? undefined : (drivers) => indiServerStore.update('drivers', drivers)} selected={drivers} showAll={showAll} />
		</div>
	)
})

function isFiniteInRange(value: number | undefined, min: number, max: number) {
	return value !== undefined && Number.isFinite(value) && value >= min && value <= max
}

function canStartServer(enabled: boolean, running: boolean, drivers: readonly string[], port: number | undefined, repeat: number | undefined, verbose: number | undefined) {
	return enabled && !running && drivers.length > 0 && isFiniteInRange(port, 80, 65535) && isFiniteInRange(repeat, 1, 10) && isFiniteInRange(verbose, 0, 3)
}

const Footer = memo(() => {
	const { enabled, running } = useSnapshot(indiServerStore.state)
	const { drivers, port, repeat, verbose } = useSnapshot(indiServerStore.state.request)
	const canStart = canStartServer(enabled, running, drivers, port, repeat, verbose)

	return (
		<>
			<Button color="danger" disabled={!enabled || !running} label="Stop" onClick={indiServerStore.stop} startContent={<Icons.Stop />} />
			<Badge color="success" label={drivers.length}>
				<Button color="success" disabled={!canStart} label="Start" onClick={indiServerStore.start} startContent={<Icons.Play />} />
			</Badge>
		</>
	)
})
