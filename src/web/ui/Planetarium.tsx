import { useStore } from '@hooks/store.hook'
import { planetariumStore } from '@stores/planetarium.store'
import { SkyMap } from '@ui/SkyMap'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useEffect } from 'react'
import type { CelestialOptions } from 'src/lib/celestial/celestial'

const SKY_MAP_OPTIONS: CelestialOptions = {
	layers: {
		constellationBoundaries: true,
		movingBodies: true,
	},
	theme: {
		background: 'transparent',
		movingBodies: {
			planetColor: 'red',
		},
	},
}

export const Planetarium = memo(({ api }: IDockviewPanelProps) => {
	useEffect(planetariumStore.mount, [])

	return <SkyMap options={SKY_MAP_OPTIONS} onReady={planetariumStore.handleReady} onDestroy={planetariumStore.handleDestroy} className="absolute top-0 left-0" height="100%" />
})
