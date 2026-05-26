import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { indiServerStore } from '../store/indi.server.store'
import { IconButton } from './components/IconButton'
import { Icons } from './Icon'
import { IndiServer } from './IndiServer'

export const IndiServerButton = memo(() => {
	const { enabled, running, show } = useSnapshot(indiServerStore.state)

	return (
		<>
			<IconButton color={running ? 'success' : 'danger'} disabled={!enabled} icon={running ? Icons.Server : Icons.ServerOff} onClick={indiServerStore.show} tooltipContent="INDI Server" />
			{show && enabled && <IndiServer />}
		</>
	)
})
