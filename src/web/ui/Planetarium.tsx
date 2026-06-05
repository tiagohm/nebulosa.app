import { memo } from 'react'
import type { CelestialOptions } from 'src/lib/celestial/celestial'
import { useSnapshot } from 'valtio'
import { useStore } from '../hooks/store.hook'
import { planetariumStore } from '../stores/planetarium.store'
import { SkyMap } from './SkyMap'

const SKY_MAP_OPTIONS: CelestialOptions = {
	layers: {
		constellationBoundaries: true,
	},
	theme: {
		background: 'transparent',
	},
}

export const Planetarium = memo(() => {
	const store = useStore(() => planetariumStore, [])
	const { show } = useSnapshot(store.state)

	if (!show) return null

	return <SkyMap options={SKY_MAP_OPTIONS} onReady={store.handleReady} onDestroy={store.handleDestroy} className="absolute top-0 left-0 z-0 w-full opacity-80" height="100%" />
})
