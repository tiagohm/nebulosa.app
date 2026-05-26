import { RAD2DEG } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST, type Constellation } from 'nebulosa/src/constellation'
import type { LunarPhase } from 'nebulosa/src/moon'
import type { SmallBodySearchListItem } from 'nebulosa/src/sbd'
import { formatTemporal, type Temporal, temporalGet, temporalSet } from 'nebulosa/src/temporal'
import React, { Activity, memo, useCallback, useDeferredValue, useMemo } from 'react'
import { Area, type AreaProps, CartesianGrid, Tooltip as ChartTooltip, ComposedChart, Line, type TooltipContentProps, XAxis, YAxis } from 'recharts'
import { EMPTY_TWILIGHT, type MinorPlanetParameter, type Twilight } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { activityMode, formatDistance, skyObjectName, skyObjectType, tw } from '@/shared/util'
import planetarySatelliteEphemeris from '../../../data/planetary-satellite-ephemeris.json'
import { useStore } from '../hooks/store.hook'
import { asteroidStore } from '../store/atlas.asteroid.store'
import { galaxyStore } from '../store/atlas.galaxy.store'
import { moonStore } from '../store/atlas.moon.store'
import { planetStore } from '../store/atlas.planet.store'
import { satelliteStore } from '../store/atlas.satellite.store'
import { atlasStore, type AtlasTab, type BookmarkItem } from '../store/atlas.store'
import { sunStore } from '../store/atlas.sun.store'
import { BodyCoordinateInfo } from './BodyCoordinateInfo'
import { Button } from './components/Button'
import { Calendar } from './components/Calendar'
import { Checkbox } from './components/Checkbox'
import { Chip, type ChipProps } from './components/Chip'
import { FilterableList } from './components/FilterableList'
import { IconButton } from './components/IconButton'
import { Link } from './components/Link'
import { List, ListItem } from './components/List'
import { NumberInput } from './components/NumberInput'
import { Popover } from './components/Popover'
import { Slider } from './components/Slider'
import { Table } from './components/Table'
import { Tab, TabPanel, Tabs } from './components/Tabs'
import { TextInput } from './components/TextInput'
import { ToggleButton } from './components/ToggleButton'
import { ConstellationSelect } from './ConstellationSelect'
import { MountDropdown } from './DeviceDropdown'
import { type Icon, Icons } from './Icon'
import { Location } from './Location'
import { Modal } from './Modal'
import { Moon } from './Moon'
import { PlanetTypeSelect } from './PlanetTypeSelect'
import { SatelliteCategoryChipGroup } from './SatelliteCategoryChipGroup'
import { SatelliteGroupTypeChipGroup } from './SatelliteGroupTypeChipGroup'
import { SkyObjectNameTypeDropdown } from './SkyObjectNameTypeDropdown'
import { StellariumObjectTypeSelect } from './StellariumObjectTypeSelect'
import { Sun } from './Sun'

export const Atlas = memo(() => {
	const { show, tab, location } = useSnapshot(atlasStore.state)
	const request = useSnapshot(atlasStore.state.request)

	if (!show) return null

	const Footer = tab !== 'galaxy' ? <Link className="mt-1" href="https://ssd-api.jpl.nasa.gov/doc/horizons.html" label="NASA/JPL Horizons API" /> : null

	return (
		<>
			<Modal footer={Footer} header={<Header />} id="sky-atlas" maxWidth="456px" onHide={atlasStore.hide}>
				<Body />
			</Modal>
			{location.show && <Location {...request.location} id="location-atlas" onClose={atlasStore.hideLocation} onCoordinateChange={atlasStore.updateLocation} />}
		</>
	)
})

const Header = memo(() => {
	const { time } = useSnapshot(atlasStore.state.request)

	return (
		<div className="flex flex-row items-center justify-between gap-2">
			<div className="flex items-center justify-center gap-1">
				<TabPopover />
				<BookmarkPopover />
			</div>
			<div className="flex flex-1 items-center justify-center gap-2">
				<TimeBar key={`${time.utc}${time.offset}`} />
				<IconButton color="primary" icon={Icons.MapMarker} onClick={atlasStore.showLocation} tooltipContent="Location" variant="flat" />
			</div>
			<HeaderFilterPopover />
		</div>
	)
})

const TAB_ICONS = {
	sun: Icons.Sun,
	moon: Icons.Moon,
	planet: Icons.Planet,
	asteroid: Icons.Meteor,
	galaxy: Icons.Galaxy,
	satellite: Icons.Satellite,
} as const

const TabPopover = memo(() => {
	const { tab } = useSnapshot(atlasStore.state)

	return (
		<Popover trigger={<IconButton color="secondary" icon={TAB_ICONS[tab]} onWheel={atlasStore.handleTabWheel} />}>
			<TabPopoverContent />
		</Popover>
	)
})

const TabPopoverContent = memo(() => (
	<div className="inline-flex flex-row gap-2">
		{Object.entries(TAB_ICONS).map(([key, icon]) => (
			<IconButton icon={icon} key={key} onClick={() => (atlasStore.state.tab = key as never)} tooltipContent={key} />
		))}
	</div>
))

function BookmarkFilter(item: BookmarkItem, text: string) {
	return item.name.toLowerCase().includes(text) || item.type.includes(text)
}

function isBookmarked(bookmark: readonly Readonly<BookmarkItem>[], type: AtlasTab, code: string) {
	return bookmark.some((e) => e.type === type && e.code === code)
}

const BookmarkPopover = memo(() => (
	<Popover trigger={<IconButton color="warning" icon={Icons.Bookmark} tooltipContent="Bookmarks" />}>
		<BookmarkPopoverContent />
	</Popover>
))

const BookmarkPopoverContent = memo(() => {
	const { items } = useSnapshot(atlasStore.state.bookmark)

	return (
		<div className="w-full">
			<FilterableList className="col-span-full" filter={BookmarkFilter} items={items} minLengthToSearch={1}>
				{(item) => (
					<div onClick={() => atlasStore.selectBookmark(item)} className="flex flex-row items-center justify-between gap-2 p-2">
						<div className="flex flex-col justify-center gap-0">
							<span className="text-xs font-bold text-neutral-600 uppercase">{item.type}</span>
							<span className="overflow-auto whitespace-nowrap">{item.name}</span>
						</div>
						<IconButton color="danger" icon={Icons.Trash} onClick={() => atlasStore.removeBookmark(item)} size="sm" />
					</div>
				)}
			</FilterableList>
		</div>
	)
})

const HeaderFilterPopover = memo(() => {
	const { tab } = useSnapshot(atlasStore.state)
	const show = tab === 'planet' || tab === 'galaxy' || tab === 'satellite'

	if (!show) return null

	return (
		<Popover className="max-w-140" trigger={<IconButton color="secondary" icon={Icons.Filter} tooltipContent="Filter" variant="flat" />}>
			{tab === 'planet' && <PlanetFilter />}
			{tab === 'galaxy' && <GalaxyFilter />}
			{tab === 'satellite' && <SatelliteFilter />}
		</Popover>
	)
})

const PlanetFilter = memo(() => {
	const { name, type } = useSnapshot(planetStore.state.search)

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2 p-2">
			<TextInput className="col-span-full" onValueChange={(value) => planetStore.update('name', value)} placeholder="Search" value={name} />
			<PlanetTypeSelect className="col-span-full" onValueChange={(value) => planetStore.update('type', value)} value={type} />
		</div>
	)
})

const GalaxyFilter = memo(() => {
	const { nameType, magnitudeMin, magnitudeMax, constellations, types, visible, visibleAbove, radius } = useSnapshot(galaxyStore.state.request)
	const { name, rightAscension, declination } = useSnapshot(galaxyStore.state.request)
	const { loading } = useSnapshot(galaxyStore.state)

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2 p-2">
			<TextInput className="col-span-full" onValueChange={(value) => galaxyStore.update('name', value)} placeholder="Search" startContent={<SkyObjectNameTypeDropdown color="secondary" onValueChange={(value) => galaxyStore.update('nameType', value)} value={nameType} size="sm" />} value={name} />
			<ConstellationSelect className="col-span-full" onValueChange={(value) => galaxyStore.update('constellations', value)} value={constellations} />
			<StellariumObjectTypeSelect className="col-span-full" onValueChange={(value) => galaxyStore.update('types', value)} value={types} />
			<TextInput className="col-span-4" disabled={radius <= 0 || loading} label="RA" onValueChange={(value) => galaxyStore.update('rightAscension', value)} value={rightAscension} />
			<TextInput className="col-span-4" disabled={radius <= 0 || loading} label="DEC" onValueChange={(value) => galaxyStore.update('declination', value)} value={declination} />
			<NumberInput className="col-span-4" fractionDigits={1} label="Radius (°)" maxValue={360} minValue={0} onValueChange={(value) => galaxyStore.update('radius', value)} step={0.1} value={radius} />
			<Slider
				className="col-span-5"
				startContent={magnitudeMin.toFixed(1)}
				endContent={magnitudeMax.toFixed(1)}
				label="Magnitude"
				maxValue={30}
				minValue={-30}
				onValueChange={galaxyStore.updateMagnitude}
				step={0.1}
				classNames={{ endContent: 'w-[5ch]', startContent: 'w-[5ch]' }}
				value={[magnitudeMin, magnitudeMax]}
			/>
			<Checkbox className="col-span-4 flex w-full max-w-none justify-center" label="Show visible" onValueChange={(value) => galaxyStore.update('visible', value)} value={visible} />
			<NumberInput className="col-span-3" disabled={!visible || loading} label="Above (°)" maxValue={89} minValue={0} onValueChange={(value) => galaxyStore.update('visibleAbove', value)} value={visibleAbove} />
			<div className="col-span-full flex flex-row items-center justify-center">
				<IconButton color="primary" disabled={loading} icon={Icons.Search} onClick={galaxyStore.search} tooltipContent="Filter" variant="flat" />
			</div>
		</div>
	)
})

const SatelliteFilter = memo(() => {
	const { groups, category } = useSnapshot(satelliteStore.state.request)
	const { text } = useSnapshot(satelliteStore.state.request)
	const { loading } = useSnapshot(satelliteStore.state)

	return (
		<div className="grid w-full grid-cols-12 items-center gap-2 p-2">
			<TextInput className="col-span-full" label="Search" onValueChange={(value) => satelliteStore.update('text', value)} value={text} />
			<p className="col-span-full font-bold">CATEGORY</p>
			<SatelliteCategoryChipGroup className="col-span-full" onValueChange={(value) => satelliteStore.update('category', value)} value={category} />
			<p className="col-span-full font-bold">GROUP</p>
			<SatelliteGroupTypeChipGroup category={category} className="col-span-full h-[200px]" onValueChange={(value) => satelliteStore.update('groups', value)} value={groups} />
			<div className="col-span-full flex flex-row items-center justify-center gap-2">
				<IconButton color="danger" disabled={loading} icon={Icons.Restore} onClick={satelliteStore.resetFilter} tooltipContent="Reset" variant="flat" />
				<IconButton color="primary" disabled={loading} icon={Icons.Search} onClick={satelliteStore.search} tooltipContent="Filter" variant="flat" />
			</div>
		</div>
	)
})

const Body = memo(() => {
	const { tab } = useSnapshot(atlasStore.state)

	return (
		<div className="mt-0 flex flex-col gap-2">
			{tab === 'sun' && <SunTab />}
			{tab === 'moon' && <MoonTab />}
			{tab === 'planet' && <PlanetTab />}
			{tab === 'asteroid' && <AsteroidTab />}
			{tab === 'galaxy' && <GalaxyTab />}
			{tab === 'satellite' && <SatelliteTab />}
		</div>
	)
})

const SunTab = memo(() => {
	const { source } = useSnapshot(sunStore.state)

	return (
		<div className="grid grid-cols-12 items-center gap-2">
			<div className="relative col-span-full flex max-h-80 min-h-[200px] items-center justify-center">
				<Sun onSourceChange={(source) => (sunStore.state.source = source)} source={source} />
				<div className="absolute top-auto left-0 p-0 text-xs">
					<SolarEclipses />
				</div>
				<div className="absolute top-auto right-0 p-0 text-xs">
					<Seasons />
				</div>
			</div>
			<EphemerisAndChart tab="sun" className="col-span-full" name="Sun" />
		</div>
	)
})

const SolarEclipses = memo(() => {
	const { eclipses } = useSnapshot(sunStore.state)
	const { offset } = useSnapshot(sunStore.state.request.time)

	return (
		<div className="flex flex-col gap-0">
			{eclipses.map((eclipse) => (
				<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Sun} key={eclipse.time} label={eclipse.type} offset={offset} time={eclipse.time} />
			))}
		</div>
	)
})

const Seasons = memo(() => {
	const { offset } = useSnapshot(sunStore.state.request.time)
	const { summer, spring, autumn, winter } = useSnapshot(sunStore.state.seasons)
	const { latitude } = useSnapshot(sunStore.state.request.location)
	const isSouthern = latitude < 0

	return (
		<div className="flex flex-col gap-0">
			<AstronomicalEvent format="MM-DD HH:mm" icon={isSouthern ? Icons.Leaf : Icons.Flower} label={isSouthern ? 'AUTUMN/FALL' : 'SPRING'} offset={offset} time={spring} />
			<AstronomicalEvent format="MM-DD HH:mm" icon={isSouthern ? Icons.SnowFlake : Icons.Sun} label={isSouthern ? 'WINTER' : 'SUMMER'} offset={offset} time={summer} />
			<AstronomicalEvent format="MM-DD HH:mm" icon={isSouthern ? Icons.Flower : Icons.Leaf} label={isSouthern ? 'SPRING' : 'AUTUMN/FALL'} offset={offset} time={autumn} />
			<AstronomicalEvent format="MM-DD HH:mm" icon={isSouthern ? Icons.Sun : Icons.SnowFlake} label={isSouthern ? 'SUMMER' : 'WINTER'} offset={offset} time={winter} />
		</div>
	)
})

const MoonTab = memo(() => (
	<div className="grid grid-cols-12 items-center gap-2">
		<div className="relative col-span-full flex max-h-80 min-h-[200px] items-center justify-center">
			<Moon />
			<div className="absolute top-auto left-0 p-0 text-xs">
				<LunarEclipses />
				<LunarApsis />
			</div>
			<div className="absolute top-auto right-0 p-0 text-xs">
				<MoonPhases />
			</div>
		</div>
		<EphemerisAndChart tab="moon" className="col-span-full" name="Moon" />
	</div>
))

function mapLunarPhase(phase: LunarPhase, time: number, offset: number) {
	if (phase === 'NEW') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonNew} key={time} label="NEW MOON" offset={offset} time={time} />
	if (phase === 'FIRST_QUARTER') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonFirstQuarter} key={time} label="FIRST QUARTER" offset={offset} time={time} />
	if (phase === 'FULL') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonFull} key={time} label="FULL MOON" offset={offset} time={time} />
	if (phase === 'LAST_QUARTER') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonLastQuarter} key={time} label="LAST QUARTER" offset={offset} time={time} />
	return null
}

const MoonPhases = memo(() => {
	const { phases } = useSnapshot(moonStore.state)
	const { offset } = useSnapshot(moonStore.state.request.time)

	return <div className="flex flex-col gap-0">{phases.map(([phase, time]) => mapLunarPhase(phase, time, offset))}</div>
})

const LunarEclipses = memo(() => {
	const { eclipses } = useSnapshot(moonStore.state)
	const { offset } = useSnapshot(moonStore.state.request.time)

	return (
		<div className="flex flex-col gap-0">
			{eclipses.map((eclipse) => (
				<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Moon} key={eclipse.time} label={eclipse.type} offset={offset} time={eclipse.startTime} />
			))}
		</div>
	)
})

const LunarApsis = memo(() => {
	const { apsis } = useSnapshot(moonStore.state)
	const { offset } = useSnapshot(moonStore.state.request.time)

	return (
		<div className="flex flex-col gap-0">
			<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Moon} label={`APOGEE (${formatDistance(apsis[0].distance)})`} offset={offset} time={apsis[0].time} />
			<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Moon} label={`PERIGEE (${formatDistance(apsis[1].distance)})`} offset={offset} time={apsis[1].time} />
		</div>
	)
})

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

const PlanetTab = memo(() => {
	const { bookmark } = useSnapshot(atlasStore.state)
	const { code, search } = useSnapshot(planetStore.state)
	const name = PLANETS.find((e) => e.code === code)?.name

	const items = useMemo(() => {
		const noSearch = !search.name.trim()
		const all = search.type === 'ALL'

		if (noSearch && all) return PLANETS

		const text = search.name.trim().toUpperCase()
		return PLANETS.filter((e) => (all || e.type === search.type) && (noSearch || e.name.toUpperCase().includes(text) || e.code.includes(text) || e.solution.includes(text)))
	}, [search.name, search.type])

	function handleFavoriteChange(favorite: boolean) {
		if (name && code) atlasStore.toggleBookmark('planet', name, code, favorite)
	}

	function handleAction(index: number) {
		return planetStore.select(items[index].code)
	}

	return (
		<div className="grid grid-cols-12 items-center gap-2">
			<List className="col-span-full" itemCount={items.length} onAction={handleAction}>
				{(i) => PlanetItem(items[i])}
			</List>
			<EphemerisAndChart tab="planet" className="col-span-full" isFavorite={code ? isBookmarked(bookmark.items, 'planet', code) : undefined} name={name} onFavoriteChange={handleFavoriteChange} />
		</div>
	)
})

const AsteroidTab = memo(() => {
	const { bookmark } = useSnapshot(atlasStore.state)
	const { tab, selected } = useSnapshot(asteroidStore.state)

	const tags = useMemo(() => {
		const tags: EphemerisAndChartTag[] = []

		if (selected) {
			if (selected.orbitType) tags.push({ label: selected.orbitType, color: 'success' })
			if (selected.neo) tags.push({ label: 'NEO', color: 'warning' })
			if (selected.pha) tags.push({ label: 'PHA', color: 'danger' })
		}

		return tags
	}, [selected])

	const handleFavoriteChange = useCallback(
		(favorite: boolean) => {
			if (selected) atlasStore.toggleBookmark('asteroid', selected.name, selected.id, favorite)
		},
		[selected],
	)

	return (
		<div className="grid grid-cols-12 items-center gap-2">
			<div className="relative col-span-full flex min-h-[200px] flex-col gap-2">
				<Tabs onValueChange={(value) => (asteroidStore.state.tab = value as never)} value={tab}>
					<Tab id="search"> Search</Tab>
					<Tab id="closeApproaches">Close Approaches</Tab>
					<TabPanel id="search">
						<AsteroidSearchTab />
					</TabPanel>
					<TabPanel id="closeApproaches">
						<AsteroidCloseApproachesTab />
					</TabPanel>
				</Tabs>
			</div>
			<EphemerisAndChart tab="asteroid" className="col-span-full" isFavorite={selected && isBookmarked(bookmark.items, 'asteroid', selected.id)} name={selected?.name} onFavoriteChange={handleFavoriteChange} tags={tags} />
		</div>
	)
})

function AsteroidSearchListItem(item: SmallBodySearchListItem, onClick: React.UIEventHandler) {
	return <ListItem description={item.pdes} label={item.name} data-pdes={item.pdes} onClick={onClick} />
}

function AsteroidSearchParameterItem(parameter: MinorPlanetParameter) {
	return (
		<ListItem description={parameter.description}>
			<span className="flex items-center justify-between">
				<span>{parameter.name}</span>
				<span>{parameter.value}</span>
			</span>
		</ListItem>
	)
}

const AsteroidSearchTab = memo(() => {
	const { loading, selected, list } = useSnapshot(asteroidStore.state)
	const { text } = useSnapshot(asteroidStore.state.search)

	function handlePointer(event: React.PointerEvent<HTMLElement>) {
		const pdes = event.currentTarget.dataset.pdes!
		return asteroidStore.select(pdes)
	}

	return (
		<div className="flex w-full flex-col gap-2">
			<div className="flex w-full flex-row items-center justify-center gap-2">
				<TextInput className="flex-1" disabled={loading} label="Search" onValueChange={asteroidStore.updateSearch} placeholder="Enter the IAU number, designation, name or SPK ID" value={text} />
				<IconButton color="primary" disabled={loading || !text} icon={Icons.Search} onClick={asteroidStore.search} variant="ghost" />
			</div>
			{list ? (
				<List fullWidth itemCount={list.length}>
					{(i) => AsteroidSearchListItem(list[i], handlePointer)}
				</List>
			) : selected?.parameters ? (
				<List fullWidth itemCount={selected.parameters.length}>
					{(i) => AsteroidSearchParameterItem(selected.parameters![i])}
				</List>
			) : null}
			<Link href="https://ssd-api.jpl.nasa.gov/doc/sbdb.html" label="NASA/JPL Small-Body Database (SBDB) API" />
		</div>
	)
})

const AsteroidCloseApproachesTab = memo(() => {
	const { loading } = useSnapshot(asteroidStore.state)
	const { days, distance } = useSnapshot(asteroidStore.state.closeApproaches.request)
	const { result } = useSnapshot(asteroidStore.state.closeApproaches)
	const { offset } = useSnapshot(asteroidStore.state.request.time)

	function handleAction(index: number) {
		const item = result[index]
		asteroidStore.state.search.text = item.name
		asteroidStore.state.tab = 'search'
		void asteroidStore.search()
	}

	return (
		<div className="flex w-full flex-col gap-2">
			<div className="flex w-full flex-row items-center justify-center gap-2">
				<NumberInput className="flex-1" disabled={loading} label="Days" maxValue={30} minValue={1} onValueChange={(value) => asteroidStore.updateCloseApproaches('days', value)} value={days} />
				<NumberInput className="flex-1" disabled={loading} fractionDigits={1} label="Distance (LD)" maxValue={100} minValue={0.1} onValueChange={(value) => asteroidStore.updateCloseApproaches('distance', value)} step={0.1} value={distance} />
				<IconButton color="primary" disabled={loading} icon={Icons.Search} onClick={asteroidStore.closeApproaches} variant="ghost" />
			</div>
			<List itemCount={result.length} fullWidth onAction={handleAction}>
				{(i) => {
					const item = result[i]

					return (
						<ListItem className="cursor-pointer" description={`${item.distance.toFixed(3)} LD`}>
							<span className="flex items-center justify-between">
								<span>{item.name}</span>
								<span>{formatTemporal(item.date, 'YYYY-MM-DD HH:mm', offset)}</span>
							</span>
						</ListItem>
					)
				}}
			</List>
			<Link href="https://ssd-api.jpl.nasa.gov/doc/cad.html" label="NASA/JPL SBDB Close Approach Data API" />
		</div>
	)
})

const GalaxyTab = memo(() => {
	const { bookmark } = useSnapshot(atlasStore.state)
	const { selected } = useSnapshot(galaxyStore.state)
	const { names, constellation } = useSnapshot(galaxyStore.state.position)
	useStore(galaxyStore, [])

	const handleFavoriteChange = useCallback(
		(favorite: boolean) => {
			if (!selected) return
			const name = names?.length ? skyObjectName(names[0], constellation) : skyObjectName(selected.name, selected.constellation)
			atlasStore.toggleBookmark('galaxy', name, selected.id.toFixed(0), favorite)
		},
		[constellation, names, selected],
	)

	return (
		<div className="grid grid-cols-12 items-center gap-2">
			<GalaxyTable />
			<GalaxyPaginator className="col-span-full w-full" />
			<EphemerisAndChart tab="galaxy" className="col-span-full" isFavorite={selected && isBookmarked(bookmark.items, 'galaxy', selected.id.toFixed(0))} onFavoriteChange={handleFavoriteChange} />
		</div>
	)
})

const GalaxyTable = memo(() => {
	const { result } = useSnapshot(galaxyStore.state)

	return (
		<Table rowCount={result.length} columnCount={4} className="col-span-full" onAction={galaxyStore.select}>
			<span>Name</span>
			<span>Mag.</span>
			<span>Type</span>
			<span>Const.</span>
			{result.map((item) => (
				<>
					<span>{skyObjectName(item.name, item.constellation)}</span>
					<span>{item.magnitude}</span>
					<span>{skyObjectType(item.type)}</span>
					<span>{CONSTELLATION_LIST[item.constellation]}</span>
				</>
			))}
		</Table>
	)
})

const GalaxyPaginator = memo((props: React.ComponentProps<'div'>) => {
	const { page } = useSnapshot(galaxyStore.state.request)
	const { loading, result } = useSnapshot(galaxyStore.state)

	return <Paginator {...props} count={result.length} loading={loading} onNext={galaxyStore.next} onPrev={galaxyStore.prev} page={page} />
})

const SatelliteTab = memo(() => {
	const { bookmark } = useSnapshot(atlasStore.state)
	const { selected } = useSnapshot(satelliteStore.state)
	useStore(satelliteStore, [])

	const handleFavoriteChange = useCallback(
		(favorite: boolean) => {
			if (selected) atlasStore.toggleBookmark('satellite', selected.name, selected.id.toFixed(0), favorite)
		},
		[selected],
	)

	return (
		<div className="relative grid grid-cols-12 items-center gap-2">
			<SatelliteTable />
			<SatellitePaginator className="col-span-full w-full" />
			<EphemerisAndChart tab="satellite" className="col-span-full" isFavorite={selected && isBookmarked(bookmark.items, 'satellite', selected.id.toFixed(0))} name={selected?.name} onFavoriteChange={handleFavoriteChange} />
		</div>
	)
})

const SatelliteTable = memo(() => {
	const { result } = useSnapshot(satelliteStore.state)

	return (
		<Table rowCount={result.length} columnCount={3} className="col-span-full" onAction={satelliteStore.select}>
			<span>ID</span>
			<span>Name</span>
			<span>Group</span>
			{result.map((item) => (
				<>
					<span>{item.id}</span>
					<span>{item.name}</span>
					<span>{item.groups.join(', ')}</span>
				</>
			))}
		</Table>
	)
})

const SatellitePaginator = memo((props: React.ComponentProps<'div'>) => {
	const { page } = useSnapshot(satelliteStore.state.request)
	const { loading, result } = useSnapshot(satelliteStore.state)

	return <Paginator {...props} count={result.length} loading={loading} onNext={satelliteStore.next} onPrev={satelliteStore.prev} page={page} />
})

interface PaginatorProps extends React.ComponentProps<'div'> {
	readonly page: number
	readonly count: number
	readonly loading?: boolean
	readonly readOnly?: boolean
	readonly onPrev: VoidFunction
	readonly onNext: VoidFunction
}

function Paginator({ page, count, onPrev, onNext, loading = false, readOnly = true, className, ...props }: PaginatorProps) {
	return (
		<div {...props} className={tw('flex flex-row items-center justify-center gap-3', className)}>
			<IconButton color="secondary" disabled={page <= 1 || loading} icon={Icons.ChevronLeft} onClick={onPrev} />
			<NumberInput className="max-w-20" classNames={{ input: 'text-center' }} disabled={loading || (page <= 1 && count < 4)} minValue={1} readOnly={readOnly} value={page} />
			<IconButton color="secondary" disabled={count < 4 || loading} icon={Icons.ChevronRight} onClick={onNext} />
		</div>
	)
}

const ONE_MINUTE = 60 * 1000

const TimeBar = memo(() => {
	const { utc, offset } = useSnapshot(atlasStore.state.request.time)
	const { manual } = useSnapshot(atlasStore.state.calendar)

	const local = utc + offset * ONE_MINUTE

	const handleDateChange = useCallback(
		(value: Temporal) => {
			atlasStore.updateTime(value - offset * ONE_MINUTE, offset)
		},
		[offset],
	)

	const handleOffsetChange = useCallback(
		(value: number) => {
			atlasStore.updateTime(utc, value, manual)
		},
		[manual, utc],
	)

	return (
		<div className="inline-flex flex-row items-center gap-1">
			<CalendarPopover date={local} offset={offset} onDateChange={handleDateChange} onOffsetChange={handleOffsetChange} />
			{manual ? (
				<IconButton color="warning" icon={Icons.TimerPlay} onClick={() => atlasStore.updateTime(Date.now(), offset, false)} tooltipContent="Play" variant="flat" />
			) : (
				<IconButton color="success" icon={Icons.TimerPause} onClick={() => (atlasStore.state.calendar.manual = true)} tooltipContent="Pause" variant="flat" />
			)}
		</div>
	)
})

interface CalendarPopoverProps {
	readonly date: number
	readonly offset: number
	readonly onDateChange: (date: number) => void
	readonly onOffsetChange: (offset: number) => void
}

const CalendarPopover = memo(({ date, offset, onDateChange, onOffsetChange }: CalendarPopoverProps) => {
	const hour = temporalGet(date, 'h')
	const minute = temporalGet(date, 'm')

	function handleDateChange(date: Temporal.PlainDate) {
		onDateChange(date.toZonedDateTime({ plainTime: { hour, minute }, timeZone: 'UTC' }).epochMilliseconds)
	}

	function handleHourChange(value: number) {
		onDateChange(temporalSet(date, value, 'h'))
	}

	function handleMinuteChange(value: number) {
		onDateChange(temporalSet(date, value, 'm'))
	}

	return (
		<Popover trigger={<Button color="secondary" label={formatTemporal(date, 'YYYY-MM-DD HH:mm', 0)} startContent={<Icons.CalendarToday />} tooltipContent="Time" />}>
			<div className="grid max-w-[256px] grid-cols-12 gap-2 pb-2">
				<Calendar className="col-span-full" onValueChange={handleDateChange} value={Temporal.Instant.fromEpochMilliseconds(date).toZonedDateTimeISO('GMT').toPlainDate()} />
				<div className="col-span-6 flex flex-row items-center justify-center gap-1">
					<NumberInput className="max-w-20" maxValue={23} minValue={0} onValueChange={handleHourChange} value={hour} />
					<span className="text-lg font-bold">:</span>
					<NumberInput className="max-w-20" maxValue={59} minValue={0} onValueChange={handleMinuteChange} value={minute} />
				</div>
				<div className="col-span-6 flex flex-row items-center justify-center gap-1">
					<NumberInput className="w-fit" label="Timezone (min)" maxValue={720} minValue={-720} onValueChange={onOffsetChange} step={30} value={offset} />
				</div>
			</div>
		</Popover>
	)
})

interface AstronomicalEventProps {
	readonly icon: Icon
	readonly label: string
	readonly time: number
	readonly offset?: number
	readonly format: string
}

const AstronomicalEvent = memo(({ icon: Icon, label, time, offset, format }: AstronomicalEventProps) => (
	<div className="flex flex-col gap-0">
		<span className="flex items-start gap-1 font-bold">
			<Icon />
			{label}
		</span>
		<span className="mb-1 ps-5">{formatTemporal(time, format, offset)}</span>
	</div>
))

interface EphemerisAndChartTag {
	readonly label: string
	readonly color: ChipProps['color']
}

interface EphemerisAndChartProps extends React.ComponentProps<'div'> {
	readonly tab: AtlasTab
	readonly name?: string
	readonly tags?: EphemerisAndChartTag[]
	readonly isFavorite?: boolean
	readonly onFavoriteChange?: (favorite: boolean) => void
}

function makeTags(name: string | undefined, names: readonly string[] | undefined, constellation: Constellation, extra?: EphemerisAndChartTag[]): EphemerisAndChartTag[] {
	const tags: EphemerisAndChartTag[] = []

	if (name) {
		tags.push({ label: name, color: 'primary' })
	} else if (names?.length) {
		for (const name of names) tags.push({ label: skyObjectName(name, constellation), color: 'primary' })
	}

	if (extra?.length) {
		tags.push(...extra)
	}

	return tags
}

function TagItem(tag: EphemerisAndChartTag) {
	return <Chip color={tag.color} key={tag.label} label={tag.label} size="sm" />
}

const EphemerisAndChart = memo(({ tab, name, tags, className, isFavorite, onFavoriteChange }: EphemerisAndChartProps) => {
	const state = atlasStore.state[tab]!.state
	const { mode } = useSnapshot(state)
	const { names, constellation } = useSnapshot(state.position)
	tags = useMemo(() => makeTags(name, names, constellation, tags), [name, constellation, names, tags])

	return (
		<div className={tw('h-[140px] col-span-full relative flex flex-col justify-start items-center gap-1', className)}>
			<div className="flex w-full flex-row gap-2 text-start text-sm font-bold">
				<ToggleButton color="primary" icon={Icons.Info} value={mode === 'info'} onClick={() => (state.mode = 'info')} />
				<ToggleButton color="primary" icon={Icons.Chart} value={mode === 'chart'} onClick={() => (state.mode = 'chart')} />
				<div className="flex flex-1 items-center justify-center gap-1 overflow-hidden text-sm font-bold">{tags.map(TagItem)}</div>
				{onFavoriteChange && <IconButton color={isFavorite ? 'danger' : 'warning'} disabled={isFavorite === undefined} icon={isFavorite ? Icons.BookmarkRemove : Icons.BookmarkPlus} onClick={() => onFavoriteChange(!isFavorite)} tooltipContent={isFavorite ? 'Remove bookmark' : 'Add bookmark'} />}
			</div>
			<span className="w-full">
				<Activity mode={activityMode(mode === 'info')}>
					<EphemerisPosition tab={tab} />
				</Activity>
				<Activity mode={activityMode(mode === 'chart')}>
					<EphemerisChart tab={tab} />
				</Activity>
			</span>
		</div>
	)
})

interface EphemerisPositionProps {
	readonly tab: AtlasTab
}

const EphemerisPosition = memo(({ tab }: EphemerisPositionProps) => {
	const state = atlasStore.state[tab]!.state
	const { position } = useSnapshot(state)

	return (
		<div className="flex w-full flex-col gap-2 p-0">
			<BodyCoordinateInfo position={position} />
			<EphemerisPositionButtons tab={tab} />
		</div>
	)
})

const EphemerisPositionButtons = memo(({ tab }: EphemerisPositionProps) => {
	const state = atlasStore.state[tab]!.state
	const { pierSide } = useSnapshot(state.position)

	return (
		<div className="flex items-center justify-center gap-2">
			<MountDropdown color="primary" disallowNoneSelection icon={Icons.Sync} disabled={pierSide === 'NEITHER'} onValueChange={atlasStore.sync} tooltipContent="Sync" variant="flat" />
			<MountDropdown color="success" disallowNoneSelection disabled={pierSide === 'NEITHER'} onValueChange={atlasStore.goTo} tooltipContent="Go" variant="flat" />
			<IconButton color="secondary" disabled={pierSide === 'NEITHER'} icon={Icons.Image} onClick={atlasStore.frame} tooltipContent="Frame" variant="flat" />
		</div>
	)
})

interface EphemerisChartData {
	readonly name: string | number
	readonly value: number | null
	readonly civilDawn: number | null
	readonly nauticalDawn: number | null
	readonly astronomicalDawn: number | null
	readonly civilDusk: number | null
	readonly nauticalDusk: number | null
	readonly astronomicalDusk: number | null
	readonly dayFirst: number | null
	readonly dayLast: number | null
	readonly night: number | null
}

interface EphemerisChartProps {
	readonly tab: AtlasTab
}

function ChartTooltipContent({ active, payload }: TooltipContentProps) {
	if (!active || !payload?.length || payload[0].name !== 'value') return null

	const item = payload[0].payload as EphemerisChartData
	const time = (+item.name + 720) % 1440
	const hour = Math.trunc(time / 60)
	const minute = Math.trunc(time % 60)

	return (
		<div className="text-small shadow-small bg-default-100 rounded-small inline-flex flex-col px-1.5 py-0.5 font-normal">
			<span className="font-bold text-white">
				{hour.toFixed(0).padStart(2, '0')}:{minute.toFixed(0).padStart(2, '0')}
			</span>
			<span className="text-foreground-600">{item.value?.toFixed(3)}°</span>
		</div>
	)
}

function ChartTickFormatter(value: unknown, i: number) {
	return ((i + 12) % 24).toFixed(0).padStart(2, '0')
}

const DEFAULT_AREA_PROPS: Partial<AreaProps<keyof EphemerisChartData, number>> = { dot: false, connectNulls: true, activeDot: false, fillOpacity: 0.3, isAnimationActive: false, stroke: 'transparent', type: 'monotone' }

const EphemerisChart = memo(({ tab }: EphemerisChartProps) => {
	const state = atlasStore.state[tab]!.state
	const { chart } = useSnapshot(state)
	const { twilight } = useSnapshot(atlasStore.state)
	const deferredChart = useDeferredValue(chart, [])
	const data = useMemo(() => makeEphemerisChart(deferredChart, twilight), [deferredChart, twilight])
	const deferredData = useDeferredValue(data, [])

	return (
		<ComposedChart data={deferredData} height={120} margin={{ top: 0, right: 8, left: 0, bottom: 0 }} responsive>
			<XAxis dataKey="name" domain={[0, 1440]} fontSize={10} interval={59} tickFormatter={ChartTickFormatter} tickMargin={6} />
			<YAxis domain={[0, 90]} width={25} />
			<Area dataKey="dayFirst" fill="#FFF176" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="civilDusk" fill="#7986CB" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="nauticalDusk" fill="#3F51B5" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="astronomicalDusk" fill="#303F9F" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="night" fill="#1A237E" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="astronomicalDawn" fill="#303F9F" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="nauticalDawn" fill="#3F51B5" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="civilDawn" fill="#7986CB" {...DEFAULT_AREA_PROPS} />
			<Area dataKey="dayLast" fill="#FFF176" {...DEFAULT_AREA_PROPS} />
			<CartesianGrid stroke="#FFFFFF10" strokeDasharray="3 3" />
			<ChartTooltip content={ChartTooltipContent} />
			<Line dataKey="value" dot={false} isAnimationActive={false} stroke="#F44336" strokeWidth={2} type="monotone" />
		</ComposedChart>
	)
})

function makeEphemerisChart(data: readonly number[], twilight: Twilight = EMPTY_TWILIGHT): EphemerisChartData[] {
	const chart = new Array<EphemerisChartData>(1441)

	// Combine data and twilight into a single array of objects
	for (let i = 0; i <= 1440; i++) {
		chart[i] = {
			name: i,
			value: data[i] >= 0 ? Math.max(0, data[i] * RAD2DEG) : null,
			dayFirst: i === 0 || i === twilight.dusk.civil[1] - 1 ? 90 : null,
			civilDusk: i === twilight.dusk.civil[1] || i === twilight.dusk.nautical[1] - 1 ? 90 : null,
			nauticalDusk: i === twilight.dusk.nautical[1] || i === twilight.dusk.astronomical[1] - 1 ? 90 : null,
			astronomicalDusk: i === twilight.dusk.astronomical[1] || i === twilight.night[1] - 1 ? 90 : null,
			night: i === twilight.night[1] || i === twilight.dawn.astronomical[1] - 1 ? 90 : null,
			astronomicalDawn: i === twilight.dawn.astronomical[1] || i === twilight.dawn.nautical[1] - 1 ? 90 : null,
			nauticalDawn: i === twilight.dawn.nautical[1] || i === twilight.dawn.civil[1] - 1 ? 90 : null,
			civilDawn: i === twilight.dawn.civil[1] || i === twilight.day[1] - 1 ? 90 : null,
			dayLast: i === twilight.day[1] || i === 1440 ? 90 : null,
		}
	}

	return chart
}
