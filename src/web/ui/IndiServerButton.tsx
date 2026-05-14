import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { IndiServerMolecule } from '@/molecules/indi/server'
import { IconButton } from './components/IconButton'
import { Icons } from './Icon'
import { IndiServer } from './IndiServer'

export const IndiServerButton = memo(() => {
	const indi = useMolecule(IndiServerMolecule)
	const { enabled, running, show } = useSnapshot(indi.state)

	return (
		<>
			<IconButton color={running ? 'success' : 'danger'} disabled={!enabled} icon={running ? Icons.Server : Icons.ServerOff} onClick={indi.show} tooltipContent="INDI Server" />
			{show && <IndiServer />}
		</>
	)
})
