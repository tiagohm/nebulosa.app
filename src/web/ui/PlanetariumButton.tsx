import { planetariumStore } from '@stores/planetarium.store'
import { IconButton } from '@ui/components/IconButton'
import { Icons } from '@ui/Icon'
import { memo } from 'react'
import { useSnapshot } from 'valtio'

export const PlanetariumButton = memo(() => {
	const { show } = useSnapshot(planetariumStore.state)

	return <IconButton icon={Icons.Globe} color={show ? 'success' : 'default'} onClick={planetariumStore.toggle} tooltipContent="Planetarium" />
})
