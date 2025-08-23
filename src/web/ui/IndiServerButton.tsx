import { Button, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { IndiServerMolecule } from '@/molecules/indi/server'
import { Icons } from './Icon'
import { IndiServer } from './IndiServer'

export const IndiServerButton = memo(() => {
	const indi = useMolecule(IndiServerMolecule)
	const { enabled, running, showModal } = useSnapshot(indi.state)

	return (
		<>
			<Tooltip content='INDI Server' placement='bottom'>
				<Button color={running ? 'success' : 'danger'} isDisabled={!enabled} isIconOnly onPointerUp={indi.show} variant='light'>
					{running ? <Icons.Server /> : <Icons.ServerOff />}
				</Button>
			</Tooltip>
			{showModal && <IndiServer />}
		</>
	)
})
