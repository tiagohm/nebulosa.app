import { skyObjectName } from '@shared/util'
import { planetariumStore } from '@stores/planetarium.store'
import { BodyCoordinateInfo } from '@ui/BodyCoordinateInfo'
import { IconButton } from '@ui/components/IconButton'
import { MountDropdown } from '@ui/DeviceDropdown'
import { Icons } from '@ui/Icon'
import { SkyMap } from '@ui/SkyMap'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useEffect } from 'react'
import type { CelestialOptions } from 'src/lib/celestial/celestial'
import { useSnapshot } from 'valtio'

const SKY_MAP_OPTIONS: CelestialOptions = {
	layers: {
		constellationBoundaries: true,
		movingBodies: true,
	},
}

export const Planetarium = memo(({ api }: IDockviewPanelProps) => {
	useEffect(planetariumStore.mount, [])

	return (
		<div className="relative h-full w-full">
			<SkyMap options={SKY_MAP_OPTIONS} onReady={planetariumStore.handleReady} onDestroy={planetariumStore.handleDestroy} height="100%" width="100%" />
			<SelectedObject />
		</div>
	)
})

const SelectedObject = memo(() => {
	const { selected, selectedBodyPosition } = useSnapshot(planetariumStore.state)

	if (!selectedBodyPosition || !selected?.object) return null
	if (selected.object.type === 'constellationLabel' || selected.object.type === 'shape') return null

	const isDeepSkyObject = selected.object.type === 'deepSky' || selected.object.type === 'star'
	const name = skyObjectName(selectedBodyPosition.names?.[0], selectedBodyPosition.constellation) ?? (selected.object.type === 'star' ? selected.object.name : selected.object.type === 'deepSky' ? selected.object.object.name : selected.object.type === 'movingBody' ? selected.object.object.name : '')

	return (
		<div className="absolute top-5 left-5 flex flex-col gap-2 rounded-2xl bg-black/40 p-4 text-neutral-100 opacity-90">
			<div className="flex flex-row items-center justify-between gap-4">
				<div className="flex flex-col gap-0">
					<span className="text-lg font-bold">{name}</span>
					{selectedBodyPosition.names && selectedBodyPosition.names.length > 1 && <span className="text-sm text-neutral-300">{selectedBodyPosition.names?.slice(1).map(skyObjectName).join(' · ')}</span>}
					<span className="text-xs text-neutral-500">{selected.object.type === 'deepSky' ? 'DEEP SKY OBJECT' : selected.object.type === 'star' ? 'STAR' : 'SOLAR SYSTEM BODY'}</span>
				</div>
				<div className="flex items-center justify-end gap-2">
					<MountDropdown color="primary" disallowNoneSelection icon={Icons.Sync} onValueChange={planetariumStore.sync} tooltipContent="Sync" variant="flat" />
					<MountDropdown color="success" disallowNoneSelection onValueChange={planetariumStore.goTo} tooltipContent="Go" variant="flat" />
					<IconButton color="secondary" icon={Icons.Image} onClick={planetariumStore.frame} tooltipContent="Frame" variant="flat" />
				</div>
			</div>
			<BodyCoordinateInfo position={selectedBodyPosition} hideIlluminated={isDeepSkyObject} hideElongation={isDeepSkyObject} />
		</div>
	)
})
