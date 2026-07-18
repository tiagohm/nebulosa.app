import { indiServerStore } from '@stores/indi.server.store'
import { Badge } from '@ui/components/Badge'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { NumberInput } from '@ui/components/NumberInput'
import { Icons } from '@ui/Icon'
import { IndiDriverListbox } from '@ui/IndiDriverListbox'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const IndiServer = memo(({ params }: IDockviewPanelProps) => {
	useEffect(indiServerStore.mount, [])
	const { enabled } = useSnapshot(indiServerStore.state)

	if (!enabled) return <div className="flex h-full w-full items-center justify-center">Not available</div>

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Inputs />
			<Drivers />
			<Footer />
		</div>
	)
})

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
		<div className={blocked ? 'col-span-full min-w-0 opacity-50' : 'col-span-full min-w-0'}>
			<IndiDriverListbox classNames={{ base: 'max-h-100' }} onSelectedChange={blocked ? undefined : (drivers) => indiServerStore.update('drivers', drivers)} selected={drivers} showAll={showAll} />
		</div>
	)
})

const Footer = memo(() => {
	const { enabled, running } = useSnapshot(indiServerStore.state)
	const { drivers, port, repeat, verbose } = useSnapshot(indiServerStore.state.request)
	const canStart = canStartServer(enabled, running, drivers, port, repeat, verbose)

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="danger" disabled={!enabled || !running} label="Stop" onClick={indiServerStore.stop} startContent={<Icons.Stop />} />
			<Badge color="success" label={drivers.length}>
				<Button color="success" disabled={!canStart} label="Start" onClick={indiServerStore.start} startContent={<Icons.Play />} />
			</Badge>
		</div>
	)
})

function isFiniteInRange(value: number | undefined, min: number, max: number) {
	return value !== undefined && Number.isFinite(value) && value >= min && value <= max
}

function canStartServer(enabled: boolean, running: boolean, drivers: readonly string[], port: number | undefined, repeat: number | undefined, verbose: number | undefined) {
	return enabled && !running && drivers.length > 0 && isFiniteInRange(port, 80, 65535) && isFiniteInRange(repeat, 1, 10) && isFiniteInRange(verbose, 0, 3)
}
