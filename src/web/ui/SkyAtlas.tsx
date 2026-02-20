import { Calendar, Checkbox, Chip, type ChipProps, Input, Listbox, ListboxItem, NumberInput, Popover, PopoverContent, PopoverTrigger, ScrollShadow, Slider, Tab, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Tabs, Tooltip } from '@heroui/react'
import { fromAbsolute, type ZonedDateTime } from '@internationalized/date'
import { useMolecule } from 'bunshi/react'
import { RAD2DEG } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST } from 'nebulosa/src/constellation'
import { formatTemporal, type Temporal, temporalGet, temporalSet } from 'nebulosa/src/temporal'
import { Activity, memo, useCallback, useDeferredValue, useMemo, useState } from 'react'
import { Area, type AreaProps, CartesianGrid, Tooltip as ChartTooltip, ComposedChart, Line, type TooltipContentProps, XAxis, YAxis } from 'recharts'
import { type BodyPosition, EMPTY_TWILIGHT, type Twilight } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { AsteroidMolecule, type BookmarkItem, GalaxyMolecule, MoonMolecule, PlanetMolecule, SatelliteMolecule, SkyAtlasMolecule, type SkyAtlasTab, SunMolecule } from '@/molecules/skyatlas'
import { DECIMAL_NUMBER_FORMAT, DEFAULT_POPOVER_PROPS, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { formatDistance, skyObjectName, skyObjectType, tw } from '@/shared/util'
import planetarySatelliteEphemeris from '../../../data/planetary-satellite-ephemeris.json'
import { BodyCoordinateInfo } from './BodyCoordinateInfo'
import { ConstellationSelect } from './ConstellationSelect'
import { MountDropdown } from './DeviceDropdown'
import { FilterableListbox } from './FilterableListBox'
import { type Icon, Icons } from './Icon'
import { IconButton } from './IconButton'
import { Link } from './Link'
import { Location } from './Location'
import { Modal } from './Modal'
import { Moon } from './Moon'
import { PlanetTypeSelect } from './PlanetTypeSelect'
import { SatelliteCategoryChipGroup } from './SatelliteCategoryChipGroup'
import { SatelliteGroupTypeChipGroup } from './SatelliteGroupTypeChipGroup'
import { SkyObjectNameTypeDropdown } from './SkyObjectNameTypeDropdown'
import { StellariumObjectTypeSelect } from './StellariumObjectTypeSelect'
import { Sun } from './Sun'
import { TextButton } from './TextButton'
import { ToggleButton } from './ToggleButton'

export const SkyAtlas = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { tab, location } = useSnapshot(atlas.state)
	const request = useSnapshot(atlas.state.request)

	const Footer = tab !== 'galaxy' ? <Link className='mt-1' href='https://ssd-api.jpl.nasa.gov/doc/horizons.html' label='NASA/JPL Horizons API' /> : null

	return (
		<>
			<Modal footer={Footer} header={<Header />} id='sky-atlas' maxWidth='456px' onHide={atlas.hide}>
				<div className='mt-0 flex flex-col gap-2'>
					<Activity mode={tab === 'sun' ? 'visible' : 'hidden'}>
						<SunTab />
					</Activity>
					<Activity mode={tab === 'moon' ? 'visible' : 'hidden'}>
						<MoonTab />
					</Activity>
					<Activity mode={tab === 'planet' ? 'visible' : 'hidden'}>
						<PlanetTab />
					</Activity>
					<Activity mode={tab === 'asteroid' ? 'visible' : 'hidden'}>
						<AsteroidTab />
					</Activity>
					<Activity mode={tab === 'galaxy' ? 'visible' : 'hidden'}>
						<GalaxyTab />
					</Activity>
					<Activity mode={tab === 'satellite' ? 'visible' : 'hidden'}>
						<SatelliteTab />
					</Activity>
				</div>
			</Modal>
			{location.show && <Location {...request.location} id='location-atlas' onClose={atlas.hideLocation} onCoordinateChange={atlas.updateLocation} />}
		</>
	)
})

const Header = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { tab } = useSnapshot(atlas.state)
	const { time } = useSnapshot(atlas.state.request)

	return (
		<div className='flex flex-row items-center justify-between gap-2'>
			<div className='flex justify-center items-center gap-1'>
				<TabPopover />
				<Bookmark />
			</div>
			<div className='flex-1 flex justify-center items-center gap-2'>
				<TimeBar key={`${time.utc}${time.offset}`} />
				<Tooltip content='Location' placement='bottom' showArrow>
					<IconButton color='primary' icon={Icons.MapMarker} onPointerUp={atlas.showLocation} variant='flat' />
				</Tooltip>
			</div>
			{(tab === 'planet' || tab === 'galaxy' || tab === 'satellite') && (
				<Popover className='max-w-140' {...DEFAULT_POPOVER_PROPS}>
					<Tooltip content='Filter' placement='bottom' showArrow>
						<div className='max-w-fit'>
							<PopoverTrigger>
								<IconButton color='secondary' icon={Icons.Filter} variant='flat' />
							</PopoverTrigger>
						</div>
					</Tooltip>
					<PopoverContent>
						<Activity mode={tab === 'planet' ? 'visible' : 'hidden'}>
							<PlanetFilter />
						</Activity>
						<Activity mode={tab === 'galaxy' ? 'visible' : 'hidden'}>
							<GalaxyFilter />
						</Activity>
						<Activity mode={tab === 'satellite' ? 'visible' : 'hidden'}>
							<SatelliteFilter />
						</Activity>
					</PopoverContent>
				</Popover>
			)}
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

const TABS = Object.keys(TAB_ICONS) as SkyAtlasTab[]

const TabPopover = memo(() => {
	const [isOpen, setOpen] = useState(false)
	const atlas = useMolecule(SkyAtlasMolecule)
	const { tab } = useSnapshot(atlas.state)

	const handleOnTabSelect = useCallback((tab: SkyAtlasTab) => {
		atlas.state.tab = tab
	}, [])

	const handleOnWheel = useCallback(
		(event: React.WheelEvent) => {
			if (event.deltaY === 0) return
			const index = event.deltaY < 0 ? (TABS.indexOf(tab) + 1) % TABS.length : (TABS.indexOf(tab) + TABS.length - 1) % TABS.length
			handleOnTabSelect(TABS[index])
		},
		[tab],
	)

	return (
		<Popover isOpen={isOpen} onOpenChange={setOpen} {...DEFAULT_POPOVER_PROPS}>
			<Tooltip className='capitalize' content={tab} placement='bottom' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton color='default' icon={TAB_ICONS[tab]} onWheel={handleOnWheel} />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<TabPopoverContent onTabSelect={handleOnTabSelect} />
			</PopoverContent>
		</Popover>
	)
})

interface TabPopoverContentProps {
	readonly onTabSelect: (tab: SkyAtlasTab) => void
}

const TabPopoverContent = memo(({ onTabSelect }: TabPopoverContentProps) => {
	return (
		<div className='inline-flex flex-row gap-2'>
			{Object.entries(TAB_ICONS).map(([key, icon]) => {
				return (
					<Tooltip className='capitalize' content={key} key={key} placement='bottom' showArrow>
						<IconButton icon={icon} onPointerUp={() => onTabSelect(key as never)} />
					</Tooltip>
				)
			})}
		</div>
	)
})

const SunTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

	const sun = useMolecule(SunMolecule)
	const { source, position, chart } = useSnapshot(sun.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<div className='relative min-h-[200px] max-h-[240px] col-span-full flex justify-center items-center'>
				<Sun onSourceChange={(source) => (sun.state.source = source)} source={source} />
				<div className='absolute top-auto left-0 p-0 text-xs'>
					<SolarEclipses />
				</div>
				<div className='absolute top-auto right-0 p-0 text-xs'>
					<Seasons />
				</div>
			</div>
			<EphemerisAndChart chart={chart} className='col-span-full' name='Sun' position={position} twilight={twilight} />
		</div>
	)
})

const SolarEclipses = memo(() => {
	const sun = useMolecule(SunMolecule)
	const { eclipses } = useSnapshot(sun.state)
	const { offset } = useSnapshot(sun.state.request.time)

	return (
		<div className='flex flex-col gap-0'>
			{eclipses.map((eclipse) => (
				<AstronomicalEvent format='YYYY-MM-DD HH:mm' icon={Icons.Sun} key={eclipse.time} label={eclipse.type} offset={offset} time={eclipse.time} />
			))}
		</div>
	)
})

const Seasons = memo(() => {
	const sun = useMolecule(SunMolecule)
	const { offset } = useSnapshot(sun.state.request.time)
	const { summer, spring, autumn, winter } = useSnapshot(sun.state.seasons)
	const { latitude } = useSnapshot(sun.state.request.location)
	const isSouthern = latitude < 0

	return (
		<div className='flex flex-col gap-0'>
			<AstronomicalEvent format='MM-DD HH:mm' icon={isSouthern ? Icons.Leaf : Icons.Flower} label={isSouthern ? 'AUTUMN/FALL' : 'SPRING'} offset={offset} time={spring} />
			<AstronomicalEvent format='MM-DD HH:mm' icon={isSouthern ? Icons.SnowFlake : Icons.Sun} label={isSouthern ? 'WINTER' : 'SUMMER'} offset={offset} time={summer} />
			<AstronomicalEvent format='MM-DD HH:mm' icon={isSouthern ? Icons.Flower : Icons.Leaf} label={isSouthern ? 'SPRING' : 'AUTUMN/FALL'} offset={offset} time={autumn} />
			<AstronomicalEvent format='MM-DD HH:mm' icon={isSouthern ? Icons.Sun : Icons.SnowFlake} label={isSouthern ? 'SUMMER' : 'WINTER'} offset={offset} time={winter} />
		</div>
	)
})

const MoonTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

	const moon = useMolecule(MoonMolecule)
	const { position, chart } = useSnapshot(moon.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<div className='relative min-h-[200px] max-h-[240px] col-span-full flex justify-center items-center'>
				<Moon />
				<div className='absolute top-auto left-0 p-0 text-xs'>
					<LunarEclipses />
					<LunarApsis />
				</div>
				<div className='absolute top-auto right-0 p-0 text-xs'>
					<MoonPhases />
				</div>
			</div>
			<EphemerisAndChart chart={chart} className='col-span-full' name='Moon' position={position} twilight={twilight} />
		</div>
	)
})

const MoonPhases = memo(() => {
	const moon = useMolecule(MoonMolecule)
	const { phases } = useSnapshot(moon.state)
	const { offset } = useSnapshot(moon.state.request.time)

	return (
		<div className='flex flex-col gap-0'>
			{phases.map(([phase, time]) =>
				phase === 'NEW' ? (
					<AstronomicalEvent format='DD HH:mm' icon={Icons.MoonNew} key={phase} label='NEW MOON' offset={offset} time={time} />
				) : phase === 'FIRST_QUARTER' ? (
					<AstronomicalEvent format='DD HH:mm' icon={Icons.MoonFirstQuarter} key={phase} label='FIRST QUARTER' offset={offset} time={time} />
				) : phase === 'FULL' ? (
					<AstronomicalEvent format='DD HH:mm' icon={Icons.MoonFull} key={phase} label='FULL MOON' offset={offset} time={time} />
				) : (
					<AstronomicalEvent format='DD HH:mm' icon={Icons.MoonLastQuarter} key={phase} label='LAST QUARTER' offset={offset} time={time} />
				),
			)}
		</div>
	)
})

const LunarEclipses = memo(() => {
	const moon = useMolecule(MoonMolecule)
	const { eclipses } = useSnapshot(moon.state)
	const { offset } = useSnapshot(moon.state.request.time)

	return (
		<div className='flex flex-col gap-0'>
			{eclipses.map((eclipse) => (
				<AstronomicalEvent format='YYYY-MM-DD HH:mm' icon={Icons.Moon} key={eclipse.time} label={eclipse.type} offset={offset} time={eclipse.startTime} />
			))}
		</div>
	)
})

const LunarApsis = memo(() => {
	const moon = useMolecule(MoonMolecule)
	const { apsis } = useSnapshot(moon.state)
	const { offset } = useSnapshot(moon.state.request.time)

	return (
		<div className='flex flex-col gap-0'>
			<AstronomicalEvent format='YYYY-MM-DD HH:mm' icon={Icons.Moon} label={`APOGEE (${formatDistance(apsis[0].distance)})`} offset={offset} time={apsis[0].time} />
			<AstronomicalEvent format='YYYY-MM-DD HH:mm' icon={Icons.Moon} label={`PERIGEE (${formatDistance(apsis[1].distance)})`} offset={offset} time={apsis[1].time} />
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

const PlanetTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight, bookmark } = useSnapshot(atlas.state)

	const planet = useMolecule(PlanetMolecule)
	const { code, position, chart, search } = useSnapshot(planet.state)
	const name = PLANETS.find((e) => e.code === code)?.name

	const items = useMemo(() => {
		const noSearch = !search.name.trim()
		const all = search.type === 'ALL'

		if (noSearch && all) return PLANETS

		const text = search.name.trim().toUpperCase()
		return PLANETS.filter((e) => (all || e.type === search.type) && (noSearch || e.name.toUpperCase().includes(text) || e.code.includes(text) || e.solution.includes(text)))
	}, [search.name, search.type])

	const handleOnFavoriteChange = useCallback(
		(favorite: boolean) => {
			atlas.bookmark('planet', name!, code!, favorite)
		},
		[name, code],
	)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<Listbox className='relative min-h-[200px] max-h-[240px] col-span-full' classNames={{ base: 'w-full', list: 'max-h-[190px] overflow-scroll' }} items={items} onAction={(key) => planet.select(key as never)} selectionMode='none'>
				{(planet) => (
					<ListboxItem description={planet.type} key={planet.code}>
						<span className='flex flex-row items-center justify-between'>
							<span>{planet.name}</span>
							<span className='text-xs'>{planet.solution}</span>
						</span>
					</ListboxItem>
				)}
			</Listbox>
			<EphemerisAndChart chart={chart} className='col-span-full' isFavorite={code ? isBookmarked(bookmark, 'planet', code) : undefined} name={name} onFavoriteChange={handleOnFavoriteChange} position={position} twilight={twilight} />
		</div>
	)
})

const AsteroidTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight, bookmark } = useSnapshot(atlas.state)

	const asteroid = useMolecule(AsteroidMolecule)
	const { tab, selected, position, chart } = useSnapshot(asteroid.state)

	const tags = useMemo(() => {
		const tags: EphemerisAndChartTag[] = []

		if (selected) {
			if (selected.orbitType) tags.push({ label: selected.orbitType, color: 'success' })
			if (selected.neo) tags.push({ label: 'NEO', color: 'warning' })
			if (selected.pha) tags.push({ label: 'PHA', color: 'danger' })
		}

		return tags
	}, [selected])

	const handleOnFavoriteChange = useCallback(
		(favorite: boolean) => {
			atlas.bookmark('asteroid', selected!.name, selected!.id, favorite)
		},
		[selected],
	)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<div className='relative min-h-[200px] max-h-[240px] col-span-full flex flex-col gap-2'>
				<Tabs className='w-full' classNames={{ panel: 'py-0' }} onSelectionChange={(value) => (asteroid.state.tab = value as never)} selectedKey={tab}>
					<Tab key='search' title='Search'>
						<AsteroidSearchTab />
					</Tab>
					<Tab key='closeApproaches' title='Close Approaches'>
						<AsteroidCloseApproachesTab />
					</Tab>
				</Tabs>
			</div>
			<EphemerisAndChart chart={chart} className='col-span-full' isFavorite={selected && isBookmarked(bookmark, 'asteroid', selected.id)} name={selected?.name} onFavoriteChange={handleOnFavoriteChange} position={position} tags={tags} twilight={twilight} />
		</div>
	)
})

const AsteroidSearchTab = memo(() => {
	const asteroid = useMolecule(AsteroidMolecule)
	const { loading, selected, list } = useSnapshot(asteroid.state)
	const { text } = useSnapshot(asteroid.state.search, { sync: true })

	return (
		<div className='w-full flex flex-col gap-0'>
			<div className='w-full flex flex-row items-center justify-center gap-2'>
				<Input className='flex-1' isClearable isDisabled={loading} label='Search' onValueChange={asteroid.updateSearch} placeholder='Enter the IAU number, designation, name or SPK ID' size='sm' value={text} />
				<IconButton color='primary' icon={Icons.Search} isDisabled={loading || !text} onPointerUp={asteroid.search} variant='light' />
			</div>
			{list ? (
				<Listbox className='mt-2 w-full' classNames={{ base: 'min-h-[90px] w-full', list: 'max-h-36 overflow-scroll' }} items={list} onAction={asteroid.select} selectionMode='single'>
					{(item) => (
						<ListboxItem description={item.pdes} key={item.pdes}>
							{item.name}
						</ListboxItem>
					)}
				</Listbox>
			) : (
				<Listbox className='mt-2 w-full' classNames={{ base: 'min-h-[90px] w-full', list: 'max-h-36 overflow-scroll' }} items={selected?.parameters ?? []} selectionMode='none'>
					{(parameter) => (
						<ListboxItem description={parameter.description} key={parameter.name}>
							<span className='flex items-center justify-between'>
								<span>{parameter.name}</span>
								<span>{parameter.value}</span>
							</span>
						</ListboxItem>
					)}
				</Listbox>
			)}
			<Link className='mt-1' href='https://ssd-api.jpl.nasa.gov/doc/sbdb.html' label='NASA/JPL Small-Body Database (SBDB) API' />
		</div>
	)
})

const AsteroidCloseApproachesTab = memo(() => {
	const asteroid = useMolecule(AsteroidMolecule)
	const { loading } = useSnapshot(asteroid.state)
	const { days, distance } = useSnapshot(asteroid.state.closeApproaches.request)
	const { result } = useSnapshot(asteroid.state.closeApproaches)
	const { offset } = useSnapshot(asteroid.state.request.time)

	return (
		<div className='w-full flex flex-col gap-0'>
			<div className='w-full flex flex-row items-center justify-center gap-2'>
				<NumberInput className='flex-1' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={loading} label='Days' maxValue={30} minValue={1} onValueChange={(value) => asteroid.updateCloseApproaches('days', value)} size='sm' value={days} />
				<NumberInput className='flex-1' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={loading} label='Distance (LD)' maxValue={100} minValue={0.1} onValueChange={(value) => asteroid.updateCloseApproaches('distance', value)} size='sm' step={0.1} value={distance} />
				<IconButton color='primary' icon={Icons.Search} isDisabled={loading} onPointerUp={asteroid.closeApproaches} variant='light' />
			</div>
			<Listbox className='mt-2 w-full' classNames={{ base: 'min-h-[90px] w-full', list: 'max-h-36 overflow-scroll' }} items={result} onAction={asteroid.select} selectionMode='single'>
				{(item) => (
					<ListboxItem description={`${item.distance.toFixed(3)} LD`} key={item.name}>
						<span className='flex items-center justify-between'>
							<span>{item.name}</span>
							<span>{formatTemporal(item.date, 'YYYY-MM-DD HH:mm', offset)}</span>
						</span>
					</ListboxItem>
				)}
			</Listbox>
			<Link href='https://ssd-api.jpl.nasa.gov/doc/cad.html' label='NASA/JPL SBDB Close Approach Data API' />
		</div>
	)
})

const GalaxyTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight, bookmark } = useSnapshot(atlas.state)

	const galaxy = useMolecule(GalaxyMolecule)
	const { position, chart, selected } = useSnapshot(galaxy.state)

	const handleOnFavoriteChange = useCallback(
		(favorite: boolean) => {
			const name = skyObjectName(position.names![0], position.constellation)
			atlas.bookmark('galaxy', name, selected!.id.toFixed(0), favorite)
		},
		[position, selected],
	)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<GalaxyTable />
			<GalaxyPaginator className='col-span-full absolute w-full' />
			<EphemerisAndChart chart={chart} className='col-span-full' isFavorite={selected && isBookmarked(bookmark, 'galaxy', selected!.id.toFixed(0))} onFavoriteChange={handleOnFavoriteChange} position={position} twilight={twilight} />
		</div>
	)
})

const GalaxyTable = memo(() => {
	const galaxy = useMolecule(GalaxyMolecule)
	const { sort } = useSnapshot(galaxy.state.request)
	const { result } = useSnapshot(galaxy.state)

	return (
		<Table className='relative min-h-[200px] max-h-[240px] col-span-full' onRowAction={(key) => galaxy.select(+(key as never))} onSortChange={(value) => galaxy.update('sort', value)} removeWrapper selectionMode='single' sortDescriptor={sort}>
			<TableHeader>
				<TableColumn key='name'>Name</TableColumn>
				<TableColumn allowsSorting className='text-center' key='magnitude'>
					Mag.
				</TableColumn>
				<TableColumn allowsSorting className='text-center' key='type'>
					Type
				</TableColumn>
				<TableColumn allowsSorting className='text-center' key='constellation'>
					Const.
				</TableColumn>
			</TableHeader>
			<TableBody items={result}>
				{(item) => (
					<TableRow key={item.id}>
						<TableCell className='whitespace-nowrap max-w-50 overflow-hidden'>{skyObjectName(item.name, item.constellation)}</TableCell>
						<TableCell className='text-center'>{item.magnitude}</TableCell>
						<TableCell className='text-center whitespace-nowrap max-w-40 overflow-hidden'>{skyObjectType(item.type)}</TableCell>
						<TableCell className='text-center'>{CONSTELLATION_LIST[item.constellation]}</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	)
})

const GalaxyPaginator = memo((props: React.ComponentProps<'div'>) => {
	const galaxy = useMolecule(GalaxyMolecule)
	const { page } = useSnapshot(galaxy.state.request)
	const { loading, result } = useSnapshot(galaxy.state)

	return <Paginator {...props} count={result.length} loading={loading} onNext={galaxy.next} onPrev={galaxy.prev} page={page} />
})

const SatelliteTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight, bookmark } = useSnapshot(atlas.state)

	const satellite = useMolecule(SatelliteMolecule)
	const { position, chart, selected } = useSnapshot(satellite.state)

	const handleOnFavoriteChange = useCallback(
		(favorite: boolean) => {
			atlas.bookmark('satellite', selected!.name, selected!.id.toFixed(0), favorite)
		},
		[selected],
	)

	return (
		<div className='grid grid-cols-12 gap-2 items-center relative'>
			<SatelliteTable />
			<SatellitePaginator className='col-span-full absolute w-full' />
			<EphemerisAndChart chart={chart} className='col-span-full' isFavorite={selected && isBookmarked(bookmark, 'satellite', selected.id.toFixed())} name={selected?.name} onFavoriteChange={handleOnFavoriteChange} position={position} twilight={twilight} />
		</div>
	)
})

const SatelliteTable = memo(() => {
	const satellite = useMolecule(SatelliteMolecule)
	const { sort } = useSnapshot(satellite.state.request)
	const { result } = useSnapshot(satellite.state)

	return (
		<Table className='relative min-h-[200px] max-h-[240px] col-span-full' onRowAction={(key) => satellite.select(+(key as never))} onSortChange={(value) => satellite.update('sort', value)} removeWrapper selectionMode='single' sortDescriptor={sort}>
			<TableHeader>
				<TableColumn allowsSorting className='text-center' key='id'>
					ID
				</TableColumn>
				<TableColumn allowsSorting className='text-center' key='name'>
					Name
				</TableColumn>
				<TableColumn className='text-center' key='group'>
					Group
				</TableColumn>
			</TableHeader>
			<TableBody items={result}>
				{(item) => (
					<TableRow key={item.id}>
						<TableCell className='whitespace-nowrap max-w-50 overflow-hidden'>{item.id}</TableCell>
						<TableCell className='text-center'>{item.name}</TableCell>
						<TableCell className='text-center whitespace-nowrap max-w-40 overflow-hidden'>{item.groups.join(', ')}</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	)
})

const SatellitePaginator = memo((props: React.ComponentProps<'div'>) => {
	const satellite = useMolecule(SatelliteMolecule)
	const { page } = useSnapshot(satellite.state.request)
	const { loading, result } = useSnapshot(satellite.state)

	return <Paginator {...props} count={result.length} loading={loading} onNext={satellite.next} onPrev={satellite.prev} page={page} />
})

interface PaginatorProps extends React.ComponentProps<'div'> {
	readonly page: number
	readonly count: number
	readonly loading?: boolean
	readonly isReadonly?: boolean
	readonly onPrev: VoidFunction
	readonly onNext: VoidFunction
}

function Paginator({ page, count, onPrev, onNext, loading = false, isReadonly = false, className, ...props }: PaginatorProps) {
	return (
		<div {...props} className={tw('flex flex-row items-center justify-center gap-3', className)}>
			<IconButton color='secondary' icon={Icons.ChevronLeft} isDisabled={page <= 1 || loading} onPointerUp={onPrev} />
			<NumberInput className='max-w-20' classNames={{ input: 'text-center' }} formatOptions={INTEGER_NUMBER_FORMAT} hideStepper isDisabled={loading || (page <= 1 && count < 4)} isReadOnly={isReadonly} minValue={1} size='sm' value={page} />
			<IconButton color='secondary' icon={Icons.ChevronRight} isDisabled={count < 4 || loading} onPointerUp={onNext} />
		</div>
	)
}

function filterBookmark(item: BookmarkItem, text: string) {
	return item.name.toLowerCase().includes(text) || item.type.includes(text)
}

function isBookmarked(bookmark: readonly Readonly<BookmarkItem>[], type: SkyAtlasTab, code: string) {
	return bookmark.some((e) => e.type === type && e.code === code)
}

const Bookmark = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { bookmark } = useSnapshot(atlas.state)

	const planet = useMolecule(PlanetMolecule)
	const asteroid = useMolecule(AsteroidMolecule)
	const galaxy = useMolecule(GalaxyMolecule)
	const satellite = useMolecule(SatelliteMolecule)

	const [open, setOpen] = useState(false)

	function handleOnAction(key: React.Key) {
		if (typeof key === 'string') {
			const [type, code] = key.split('-') as unknown as readonly [SkyAtlasTab, string]
			const item = bookmark.find((e) => e.type === type && e.code === code)

			if (item) {
				if (type === 'planet') planet.select(code, false)
				else if (type === 'asteroid') asteroid.select(code)
				else if (type === 'galaxy') galaxy.select(+code, false)
				else if (type === 'satellite') satellite.select(+code, false)

				atlas.state.tab = type

				setOpen(false)
			}
		}
	}

	function handleOnRemove(item: BookmarkItem) {
		atlas.bookmark(item.type, item.name, item.code, false)
	}

	return (
		<Popover className='max-w-110' isOpen={open} onOpenChange={setOpen} {...DEFAULT_POPOVER_PROPS}>
			<Tooltip content='Bookmarks' placement='bottom' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton color='warning' icon={Icons.Bookmark} />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<div className='w-full'>
					<FilterableListbox
						className='col-span-full'
						classNames={{ list: 'max-h-[200px] overflow-scroll', base: 'min-w-80' }}
						filter={filterBookmark}
						isVirtualized
						items={bookmark}
						minLengthToSearch={1}
						onAction={handleOnAction}
						selectionMode='none'
						variant='flat'
						virtualization={{
							maxListboxHeight: 200,
							itemHeight: 36,
						}}>
						{(item) => (
							<ListboxItem classNames={{ description: 'uppercase' }} description={item.type} endContent={<IconButton className='rounded-full' color='danger' icon={Icons.Trash} onPointerUp={() => handleOnRemove(item)} size='sm' />} key={`${item.type}-${item.code}`}>
								{item.name}
							</ListboxItem>
						)}
					</FilterableListbox>
				</div>
			</PopoverContent>
		</Popover>
	)
})

const ONE_MINUTE = 60 * 1000

const TimeBar = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { utc, offset } = useSnapshot(atlas.state.request.time)
	const { show, manual } = useSnapshot(atlas.state.calendar)

	const local = utc + offset * ONE_MINUTE

	const handleOnDateChange = useCallback((value: Temporal) => {
		atlas.updateTime(value - offset * ONE_MINUTE, offset)
	}, [])

	const handleOnOffsetChange = useCallback((value: number) => {
		atlas.updateTime(utc, value, manual)
	}, [])

	const handleOnOpenChange = useCallback((isOpen: boolean) => {
		atlas.state.calendar.show = isOpen
	}, [])

	return (
		<div className='inline-flex flex-row items-center gap-1'>
			<CalendarPopover date={local} isOpen={show} offset={offset} onDateChange={handleOnDateChange} onOffsetChange={handleOnOffsetChange} onOpenChange={handleOnOpenChange} />
			<Tooltip content={manual ? 'Play' : 'Pause'} placement='bottom' showArrow>
				{manual ? <IconButton color='warning' icon={Icons.TimerPlay} onPointerUp={() => atlas.updateTime(Date.now(), offset, false)} variant='flat' /> : <IconButton color='success' icon={Icons.TimerPause} onPointerUp={() => (atlas.state.calendar.manual = true)} variant='flat' />}
			</Tooltip>
		</div>
	)
})

interface CalendarPopoverProps {
	readonly date: Temporal
	readonly offset: number
	readonly onDateChange: (date: Temporal) => void
	readonly onOffsetChange: (offset: number) => void
	readonly isOpen?: boolean
	readonly onOpenChange?: (isOpen: boolean) => void
}

const CalendarPopover = memo(({ date, offset, onDateChange, onOffsetChange, isOpen, onOpenChange }: CalendarPopoverProps) => {
	const hour = temporalGet(date, 'h')
	const minute = temporalGet(date, 'm')

	function handleDateChange(date: ZonedDateTime) {
		onDateChange(date.toDate().getTime())
	}

	function handleOnHourChange(value: number) {
		onDateChange(temporalSet(date, value, 'h'))
	}

	function handleOnMinuteChange(value: number) {
		onDateChange(temporalSet(date, value, 'm'))
	}

	return (
		<Popover className='max-w-110' isOpen={isOpen} onOpenChange={onOpenChange} {...DEFAULT_POPOVER_PROPS}>
			<Tooltip content='Time' placement='bottom' showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<TextButton color='secondary' label={formatTemporal(date, 'YYYY-MM-DD HH:mm', 0)} startContent={<Icons.CalendarToday />} />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>
				<div className='grid grid-cols-12 gap-2 pb-2 max-w-[256px]'>
					<Calendar className='col-span-full' classNames={{ base: 'shadow-none' }} onChange={handleDateChange} showMonthAndYearPickers value={fromAbsolute(date, 'UTC')} />
					<div className='col-span-6 flex flex-row items-center justify-center gap-1'>
						<NumberInput className='max-w-20' formatOptions={INTEGER_NUMBER_FORMAT} maxValue={23} minValue={0} onValueChange={handleOnHourChange} value={hour} variant='bordered' />
						<span className='text-lg font-bold'>:</span>
						<NumberInput className='max-w-20' formatOptions={INTEGER_NUMBER_FORMAT} maxValue={59} minValue={0} onValueChange={handleOnMinuteChange} value={minute} variant='bordered' />
					</div>
					<div className='col-span-6 flex flex-row items-center justify-center gap-1'>
						<NumberInput className='w-fit' formatOptions={INTEGER_NUMBER_FORMAT} label='Timezone (min)' maxValue={720} minValue={-720} onValueChange={onOffsetChange} step={30} value={offset} variant='bordered' />
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
})

interface AstronomicalEventProps {
	readonly icon: Icon
	readonly label: string
	readonly time: Temporal
	readonly offset?: number
	readonly format: string
}

const AstronomicalEvent = memo(({ icon: Icon, label, time, offset, format }: AstronomicalEventProps) => {
	return (
		<div className='flex flex-col gap-0'>
			<span className='font-bold flex items-start gap-1'>
				<Icon />
				{label}
			</span>
			<span className='ps-6 mt-[-4px] mb-1'>{formatTemporal(time, format, offset)}</span>
		</div>
	)
})

interface EphemerisAndChartTag {
	readonly label: string
	readonly color: ChipProps['color']
}

interface EphemerisAndChartProps extends React.ComponentProps<'div'> {
	readonly name?: string
	readonly position: BodyPosition
	readonly chart: readonly number[]
	readonly twilight?: Twilight
	readonly tags?: EphemerisAndChartTag[]
	readonly isFavorite?: boolean
	readonly onFavoriteChange?: (favorite: boolean) => void
}

function makeTags(name: string | undefined, position: BodyPosition, extra?: EphemerisAndChartTag[]): EphemerisAndChartTag[] {
	const tags: EphemerisAndChartTag[] = []

	if (name) {
		tags.push({ label: name, color: 'primary' })
	} else if (position.names?.length) {
		position.names.forEach((name) => tags.push({ label: skyObjectName(name, position.constellation), color: 'primary' }))
	}

	if (extra?.length) {
		tags.push(...extra)
	}

	return tags
}

const EphemerisAndChart = memo(({ name, position, chart, twilight, tags, className, isFavorite, onFavoriteChange }: EphemerisAndChartProps) => {
	const [showChart, setShowChart] = useState(false)
	tags = useMemo(() => makeTags(name, position, tags), [name, position.constellation, position.names, tags])
	const deferredChart = useDeferredValue(chart, [])
	const data = useMemo(() => makeEphemerisChart(deferredChart, twilight), [deferredChart, twilight])
	const deferredData = useDeferredValue(data, [])

	return (
		<div className={tw('h-[140px] col-span-full relative flex flex-col justify-start items-center gap-1', className)}>
			<div className='w-full flex flex-row gap-2 text-start text-sm font-bold'>
				<ToggleButton color='primary' icon={Icons.Info} isSelected={!showChart} onPointerUp={() => setShowChart(false)} />
				<ToggleButton color='primary' icon={Icons.Chart} isSelected={showChart} onPointerUp={() => setShowChart(true)} />
				<div className='flex-1 justify-center items-center flex text-sm font-bold overflow-hidden'>
					<ScrollShadow className='w-full flex gap-1' hideScrollBar orientation='horizontal'>
						{tags?.map((tag) => (
							<Chip color={tag.color} key={tag.label} size='sm'>
								{tag.label}
							</Chip>
						))}
					</ScrollShadow>
				</div>
				{onFavoriteChange && (
					<Tooltip content={isFavorite ? 'Remove bookmark' : 'Add bookmark'} placement='bottom' showArrow>
						<IconButton color={isFavorite ? 'danger' : 'warning'} icon={isFavorite ? Icons.BookmarkRemove : Icons.BookmarkPlus} isDisabled={isFavorite === undefined} onPointerUp={() => onFavoriteChange(!isFavorite)} />
					</Tooltip>
				)}
			</div>
			<span className='w-full'>
				<Activity mode={showChart ? 'hidden' : 'visible'}>
					<EphemerisPosition position={position} />
				</Activity>
				<Activity mode={showChart ? 'visible' : 'hidden'}>
					<EphemerisChart data={deferredData} />
				</Activity>
			</span>
		</div>
	)
})

const PlanetFilter = memo(() => {
	const planet = useMolecule(PlanetMolecule)
	const { name, type } = useSnapshot(planet.state.search, { sync: true })

	return (
		<div className='min-w-77 grid grid-cols-12 gap-2 items-center p-2'>
			<Input className='col-span-full' isClearable onValueChange={(value) => planet.update('name', value)} placeholder='Search' value={name} />
			<PlanetTypeSelect className='col-span-full' onValueChange={(value) => planet.update('type', value)} value={type} />
		</div>
	)
})

const GalaxyFilter = memo(() => {
	const dso = useMolecule(GalaxyMolecule)
	const { nameType, magnitudeMin, magnitudeMax, constellations, types, visible, visibleAbove, radius } = useSnapshot(dso.state.request)
	const { name, rightAscension, declination } = useSnapshot(dso.state.request, { sync: true })
	const { loading } = useSnapshot(dso.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center p-2'>
			<Input className='col-span-full' isClearable onValueChange={(value) => dso.update('name', value)} placeholder='Search' startContent={<SkyObjectNameTypeDropdown color='secondary' onValueChange={(value) => dso.update('nameType', value)} value={nameType} />} value={name} />
			<ConstellationSelect className='col-span-6' onValueChange={(value) => dso.update('constellations', value)} value={constellations} />
			<StellariumObjectTypeSelect className='col-span-6' onValueChange={(value) => dso.update('types', value)} value={types} />
			<Input className='col-span-4' isDisabled={radius <= 0 || loading} label='RA' onValueChange={(value) => dso.update('rightAscension', value)} size='sm' value={rightAscension} />
			<Input className='col-span-4' isDisabled={radius <= 0 || loading} label='DEC' onValueChange={(value) => dso.update('declination', value)} size='sm' value={declination} />
			<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} label='Radius (°)' maxValue={360} minValue={0} onValueChange={(value) => dso.update('radius', value)} size='sm' step={0.1} value={radius} />
			<Slider
				className='col-span-5'
				getValue={(value) => `min: ${(value as number[])[0].toFixed(1)} max: ${(value as number[])[1].toFixed(1)}`}
				label='Magnitude'
				maxValue={30}
				minValue={-30}
				onChange={(value) => {
					dso.update('magnitudeMin', (value as number[])[0])
					dso.update('magnitudeMax', (value as number[])[1])
				}}
				step={0.1}
				value={[magnitudeMin, magnitudeMax]}
			/>
			<Checkbox className='col-span-4 w-full max-w-none flex justify-center' isSelected={visible} onValueChange={(value) => dso.update('visible', value)}>
				Show visible
			</Checkbox>
			<NumberInput className='col-span-3' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!visible || loading} label='Above (°)' maxValue={89} minValue={0} onValueChange={(value) => dso.update('visibleAbove', value)} size='sm' value={visibleAbove} />
			<div className='col-span-full flex flex-row items-center justify-center'>
				<Tooltip content='Filter' placement='bottom' showArrow>
					<IconButton color='primary' icon={Icons.Search} isDisabled={loading} onPointerUp={() => dso.search()} variant='flat' />
				</Tooltip>
			</div>
		</div>
	)
})

const SatelliteFilter = memo(() => {
	const satellite = useMolecule(SatelliteMolecule)
	const { groups, category } = useSnapshot(satellite.state.request)
	const { text } = useSnapshot(satellite.state.request, { sync: true })
	const { loading } = useSnapshot(satellite.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center p-2'>
			<Input className='col-span-full' isClearable label='Search' onValueChange={(value) => satellite.update('text', value)} size='sm' value={text} />
			<p className='col-span-full font-bold'>CATEGORY</p>
			<SatelliteCategoryChipGroup className='col-span-full' onValueChange={(value) => satellite.update('category', value)} value={category} />
			<p className='col-span-full font-bold'>GROUP</p>
			<SatelliteGroupTypeChipGroup category={category} className='col-span-full h-[200px]' onValueChange={(value) => satellite.update('groups', value)} value={groups} />
			<div className='col-span-full flex flex-row items-center justify-center gap-2'>
				<Tooltip content='Reset' placement='bottom' showArrow>
					<IconButton color='danger' icon={Icons.Restore} isDisabled={loading} onPointerUp={satellite.resetFilter} variant='flat' />
				</Tooltip>
				<Tooltip content='Filter' placement='bottom' showArrow>
					<IconButton color='primary' icon={Icons.Search} isDisabled={loading} onPointerUp={() => satellite.search()} variant='flat' />
				</Tooltip>
			</div>
		</div>
	)
})

interface EphemerisPositionProps {
	readonly position: BodyPosition
}

const EphemerisPosition = memo(({ position }: EphemerisPositionProps) => {
	const atlas = useMolecule(SkyAtlasMolecule)

	return (
		<div className='w-full grid grid-cols-12 gap-2 p-0'>
			<div className='col-span-full'>
				<BodyCoordinateInfo position={position} />
			</div>
			<div className='col-span-full flex items-center justify-center gap-2'>
				<MountDropdown color='primary' disallowNoneSelection icon={Icons.Sync} isDisabled={position.pierSide === 'NEITHER'} onValueChange={atlas.sync} tooltipContent='Sync' variant='flat' />
				<MountDropdown color='success' disallowNoneSelection isDisabled={position.pierSide === 'NEITHER'} onValueChange={atlas.goTo} tooltipContent='Go' variant='flat' />
				<Tooltip content='Frame' placement='bottom' showArrow>
					<IconButton color='secondary' icon={Icons.Image} isDisabled={position.pierSide === 'NEITHER'} onPointerUp={atlas.frame} variant='flat' />
				</Tooltip>
			</div>
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
	readonly data: EphemerisChartData[]
}

function chartTooltipContent({ active, payload }: TooltipContentProps<number, string>) {
	if (!active || !payload?.length || payload[0].name !== 'value') return null

	const item = payload[0].payload as EphemerisChartData
	const time = (+item.name + 720) % 1440
	const hour = (time / 1440) * 24
	const minute = (hour - Math.trunc(hour)) * 60

	return (
		<div className='px-1.5 py-0.5 inline-flex flex-col font-normal text-small shadow-small bg-default-100 rounded-small'>
			<span className='text-white font-bold'>
				{hour.toFixed(0).padStart(2, '0')}:{minute.toFixed(0).padStart(2, '0')}
			</span>
			<span className='text-foreground-600'>{item.value?.toFixed(3)}°</span>
		</div>
	)
}

function chartTickFormatter(value: unknown, i: number) {
	return `${((i + 12) % 24).toFixed(0).padStart(2, '0')}`
}

const DEFAULT_AREA_PROPS: Partial<AreaProps> = { dot: false, connectNulls: true, activeDot: false, fillOpacity: 0.3, isAnimationActive: false, stroke: 'transparent', type: 'monotone' }

const EphemerisChart = memo(({ data }: EphemerisChartProps) => {
	return (
		<ComposedChart data={data} height={120} margin={{ top: 0, right: 8, left: 0, bottom: 0 }} responsive>
			<XAxis dataKey='name' domain={[0, 1440]} fontSize={10} interval={59} tickFormatter={chartTickFormatter} tickMargin={6} />
			<YAxis domain={[0, 90]} width={25} />
			<Area dataKey='dayFirst' fill='#FFF176' {...DEFAULT_AREA_PROPS} />
			<Area dataKey='civilDusk' fill='#7986CB' {...DEFAULT_AREA_PROPS} />
			<Area dataKey='nauticalDusk' fill='#3F51B5' {...DEFAULT_AREA_PROPS} />
			<Area dataKey='astronomicalDusk' fill='#303F9F' {...DEFAULT_AREA_PROPS} />
			<Area dataKey='night' fill='#1A237E' {...DEFAULT_AREA_PROPS} />
			<Area dataKey='astronomicalDawn' fill='#303F9F' {...DEFAULT_AREA_PROPS} />
			<Area dataKey='nauticalDawn' fill='#3F51B5' {...DEFAULT_AREA_PROPS} />
			<Area dataKey='civilDawn' fill='#7986CB' {...DEFAULT_AREA_PROPS} />
			<Area dataKey='dayLast' fill='#FFF176' {...DEFAULT_AREA_PROPS} />
			<CartesianGrid stroke='#FFFFFF10' strokeDasharray='3 3' />
			<ChartTooltip content={chartTooltipContent} />
			<Line dataKey='value' dot={false} isAnimationActive={false} stroke='#F44336' strokeWidth={2} type='monotone' />
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
