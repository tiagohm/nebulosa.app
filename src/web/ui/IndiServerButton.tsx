import { Tooltip } from '@heroui/react'
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
			<Tooltip content='INDI Server' placement='bottom' showArrow>
				<IconButton color={running ? 'success' : 'danger'} icon={running ? Icons.Server : Icons.ServerOff} isDisabled={!enabled} onPointerUp={indi.show} />
			</Tooltip>
			<Activity mode={show ? 'visible' : 'hidden'}>
				<IndiServer />
			</Activity>
		</>
	)
})
