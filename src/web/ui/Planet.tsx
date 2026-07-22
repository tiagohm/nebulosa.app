import { planetStore } from '@stores/atlas.planet.store'
import { EphemerisAndChart, EphemerisPositionContext } from '@ui/Atlas'
import { ListItem, List } from '@ui/components/List'
import { TextInput } from '@ui/components/TextInput'
import { PlanetTypeSelect } from '@ui/PlanetTypeSelect'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useEffect, useMemo } from 'react'
import planetarySatelliteEphemeris from 'src/data/planetary.satellites.json'
import { useSnapshot } from 'valtio'

const PLANETS = [
	{ name: 'Mercury', code: '199', type: 'PLANET', solution: 'DE441' },
	{ name: 'Venus', code: '299', type: 'PLANET', solution: 'DE441' },
	{ name: 'Mars', code: '499', type: 'PLANET', solution: 'DE441' },
	{ name: 'Jupiter', code: '599', type: 'PLANET', solution: 'DE441' },
	{ name: 'Saturn', code: '699', type: 'PLANET', solution: 'DE441' },
	{ name: 'Uranus', code: '799', type: 'PLANET', solution: 'DE441' },
	{ name: 'Neptune', code: '899', type: 'PLANET', solution: 'DE441' },
	{ name: 'Pluto', code: '999', type: 'DWARF_PLANET', solution: 'DE441' },
	{ name: '1 Ceres (A801 AA)', code: '1;', type: 'DWARF_PLANET', solution: 'JPL#48' },
	{ name: '90377 Sedna (2003 VB12)', code: '90377;', type: 'DWARF_PLANET', solution: 'JPL#44' },
	{ name: '136199 Eris (2003 UB313)', code: '136199;', type: 'DWARF_PLANET', solution: 'JPL#96' },
	{ name: '2 Pallas (A802 FA)', code: '2;', type: 'ASTEROID', solution: 'JPL#69' },
	{ name: '3 Juno (A804 RA)', code: '3;', type: 'ASTEROID', solution: 'JPL#143' },
	{ name: '4 Vesta (A807 FA)', code: '4;', type: 'ASTEROID', solution: 'JPL#36' },
	...planetarySatelliteEphemeris.mars,
	...planetarySatelliteEphemeris.jupiter,
	...planetarySatelliteEphemeris.saturn,
	...planetarySatelliteEphemeris.uranus,
	...planetarySatelliteEphemeris.neptune,
	...planetarySatelliteEphemeris.pluto,
] as const

export const Planet = memo(({ api }: IDockviewPanelProps) => {
	useEffect(planetStore.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Filter />
			<FilteredList />
			<EphemerisPositionContext value={planetStore}>
				<EphemerisAndChart />
			</EphemerisPositionContext>
		</div>
	)
})

const Filter = memo(() => {
	const { name, type } = useSnapshot(planetStore.state.search)

	return (
		<div className="col-span-full grid grid-cols-subgrid items-center gap-2 p-2">
			<TextInput className="col-span-8" onValueChange={planetStore.setName} label="Search" value={name} />
			<PlanetTypeSelect className="col-span-4" onValueChange={planetStore.setType} value={type} />
		</div>
	)
})

const FilteredList = memo(() => {
	const { search } = useSnapshot(planetStore.state)

	const items = useMemo(() => {
		const noSearch = !search.name.trim()
		const all = search.type === 'ALL'

		if (noSearch && all) return PLANETS

		const text = search.name.trim().toUpperCase()
		return PLANETS.filter((e) => (all || e.type === search.type) && (noSearch || e.name.toUpperCase().includes(text) || e.code.includes(text) || e.solution.includes(text)))
	}, [search.name, search.type])

	function handleAction(index: number) {
		return planetStore.select(items[index])
	}

	return (
		<List className="col-span-full max-h-120" itemCount={items.length} onAction={handleAction}>
			{(i) => PlanetItem(items[i])}
		</List>
	)
})

function PlanetItem(planet: (typeof PLANETS)[number]) {
	return (
		<ListItem description={planet.type}>
			<span className="flex flex-row items-center justify-between">
				<span>{planet.name}</span>
				<span className="text-xs">{planet.solution}</span>
			</span>
		</ListItem>
	)
}
