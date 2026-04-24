import { useMolecule } from 'bunshi/react'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { IndiServerMolecule } from '@/molecules/indi/server'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { IndiServer } from './IndiServer'

export const IndiServerButton = memo(() => {
	const indi = useMolecule(IndiServerMolecule)
	const { enabled, running, show } = useSnapshot(indi.state)

	return (
		<>
			<IconButton color={running ? 'success' : 'danger'} disabled={!enabled} icon={running ? Icons.Server : Icons.ServerOff} onPointerUp={indi.show} tooltipContent="INDI Server" />
			<Activity mode={show ? 'visible' : 'hidden'}>
				<IndiServer />
			</Activity>
		</>
	)
})
