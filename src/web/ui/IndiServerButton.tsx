import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { indiServerStore } from '@/stores/indi.server.store'
import { IconButton } from './components/IconButton'
import { Icons } from './Icon'
import { IndiServer } from './IndiServer'

export const IndiServerButton = memo(() => {
	const { enabled, running, show } = useSnapshot(indiServerStore.state)

	if (!enabled) return null

	return (
		<>
			<IconButton color={running ? 'success' : 'danger'} icon={running ? Icons.Server : Icons.ServerOff} onClick={indiServerStore.show} tooltipContent="INDI Server" />
			{show && <IndiServer />}
		</>
	)
})
