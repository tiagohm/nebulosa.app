import { Button, Calendar, Checkbox, Chip, type ChipProps, Input, Listbox, ListboxItem, NumberInput, Popover, PopoverContent, PopoverTrigger, ScrollShadow, Slider, Tab, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Tabs, Tooltip } from '@heroui/react'
import { fromAbsolute, type ZonedDateTime } from '@internationalized/date'
import { useMolecule } from 'bunshi/react'
import { clsx } from 'clsx'
import { formatALT, formatAZ, formatDEC, formatRA } from 'nebulosa/src/angle'
import { RAD2DEG } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST } from 'nebulosa/src/constellation'
import { formatTemporal, type Temporal, temporalGet, temporalSet } from 'nebulosa/src/temporal'
import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react'
import { Area, CartesianGrid, Tooltip as ChartTooltip, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { type BodyPosition, EMPTY_TWILIGHT, type Twilight } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { AsteroidMolecule, GalaxyMolecule, MoonMolecule, PlanetMolecule, SatelliteMolecule, SkyAtlasMolecule, SunMolecule } from '@/molecules/skyatlas'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { formatDistance, formatSkyObjectName, formatSkyObjectType } from '@/shared/util'
import { ConstellationSelect } from './ConstellationSelect'
import { type Icon, Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'
import { Moon } from './Moon'
import { MountDropdown } from './MountDropdown'
import { PoweredBy } from './PoweredBy'
import { SatelliteGroupTypeChipGroup } from './SatelliteGroupTypeChipGroup'
import { SkyObjectNameTypeDropdown } from './SkyObjectNameTypeDropdown'
import { StellariumObjectTypeSelect } from './StellariumObjectTypeSelect'
import { Sun } from './Sun'
import { TextButton } from './TextButton'

export const SkyAtlas = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { tab } = useSnapshot(atlas.state)
	const { time } = useSnapshot(atlas.state.request)

	const Header = useMemo(
		() => (
			<div className='flex flex-row items-center justify-between'>
				<span>Sky Atlas</span>
				<div className='flex-1 flex justify-center items-center'>
					<TimeBar key={`${time.utc}${time.offset}`} />
				</div>
				{(tab === 'galaxy' || tab === 'satellite') && (
					<Popover className='max-w-140' placement='bottom' showArrow>
						<Tooltip content='Filter' placement='bottom'>
							<div className='max-w-fit'>
								<PopoverTrigger>
									<IconButton color='secondary' icon={Icons.Filter} variant='flat' />
								</PopoverTrigger>
							</div>
						</Tooltip>
						<PopoverContent>
							{tab === 'galaxy' && <GalaxyFilter />}
							{tab === 'satellite' && <SatelliteFilter />}
						</PopoverContent>
					</Popover>
				)}
			</div>
		),
		[tab],
	)

	const Footer = useMemo(() => {
		return tab !== 'galaxy' ? <PoweredBy className='mt-1' href='https://ssd-api.jpl.nasa.gov/doc/horizons.html' label='NASA/JPL Horizons API' /> : <span />
	}, [tab !== 'galaxy'])

	return (
		<Modal footer={Footer} header={Header} id='sky-atlas' maxWidth='450px' onHide={atlas.hide}>
			<div className='mt-0 flex flex-col gap-2'>
				<Tabs classNames={{ base: 'absolute left-[-2px] top-[8px] z-1', panel: 'w-full pt-0' }} isVertical onSelectionChange={(value) => (atlas.state.tab = value as never)} selectedKey={tab}>
					<Tab key='sun' title={<Icons.Sun />}>
						<SunTab />
					</Tab>
					<Tab key='moon' title={<Icons.Moon />}>
						<MoonTab />
					</Tab>
					<Tab key='planet' title={<Icons.Planet />}>
						<PlanetTab />
					</Tab>
					<Tab key='asteroid' title={<Icons.Meteor />}>
						<AsteroidTab />
					</Tab>
					<Tab key='galaxy' title={<Icons.Galaxy />}>
						<GalaxyTab />
					</Tab>
					<Tab key='satellite' title={<Icons.Satellite />}>
						<SatelliteTab />
					</Tab>
				</Tabs>
			</div>
		</Modal>
	)
})

export const SunTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

	const sun = useMolecule(SunMolecule)
	const { source, position, chart } = useSnapshot(sun.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<div className='ml-11 relative min-h-[200px] max-h-[240px] col-span-full flex justify-center items-center'>
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

export const SolarEclipses = memo(() => {
	const sun = useMolecule(SunMolecule)
	const { eclipses } = useSnapshot(sun.state)

	return (
		<div className='flex flex-col gap-0'>
			{eclipses.map((eclipse) => (
				<AstronomicalEvent format='YYYY-MM-DD HH:mm' icon={Icons.Sun} key={eclipse.time} label={eclipse.type} time={eclipse.time} />
			))}
		</div>
	)
})

export const Seasons = memo(() => {
	const sun = useMolecule(SunMolecule)
	const { summer, spring, autumn, winter } = useSnapshot(sun.state.seasons)
	const isSouthern = sun.state.request.location.latitude < 0

	return (
		<div className='flex flex-col gap-0'>
			{isSouthern ? <AstronomicalEvent format='MM-DD HH:mm' icon={Icons.Leaf} label='AUTUMN/FALL' time={spring} /> : <AstronomicalEvent format='MM-DD HH:mm' icon={Icons.Flower} label='SPRING' time={autumn} />}
			{isSouthern ? <AstronomicalEvent format='MM-DD HH:mm' icon={Icons.SnowFlake} label='WINTER' time={summer} /> : <AstronomicalEvent format='MM-DD HH:mm' icon={Icons.Sun} label='SUMMER' time={winter} />}
			{isSouthern ? <AstronomicalEvent format='MM-DD HH:mm' icon={Icons.Flower} label='SPRING' time={autumn} /> : <AstronomicalEvent format='MM-DD HH:mm' icon={Icons.Leaf} label='AUTUMN/FALL' time={spring} />}
			{isSouthern ? <AstronomicalEvent format='MM-DD HH:mm' icon={Icons.Sun} label='SUMMER' time={winter} /> : <AstronomicalEvent format='MM-DD HH:mm' icon={Icons.SnowFlake} label='WINTER' time={summer} />}
		</div>
	)
})

export const MoonTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

	const moon = useMolecule(MoonMolecule)
	const { position, chart } = useSnapshot(moon.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<div className='ml-11 relative min-h-[200px] max-h-[240px] col-span-full flex justify-center items-center'>
				<Moon />
				<div className='absolute top-auto left-0 p-0 text-xs'>
					<LunarEclipses />
				</div>
				<div className='absolute top-auto right-0 p-0 text-xs'>
					<MoonPhases />
				</div>
			</div>
			<EphemerisAndChart chart={chart} className='col-span-full' name='Moon' position={position} twilight={twilight} />
		</div>
	)
})

export const MoonPhases = memo(() => {
	const moon = useMolecule(MoonMolecule)
	const { phases } = useSnapshot(moon.state)

	return (
		<div className='flex flex-col gap-0'>
			{phases.map(([phase, time]) =>
				phase === 0 ? (
					<AstronomicalEvent format='DD HH:mm' icon={Icons.MoonNew} key={phase} label='NEW MOON' time={time} />
				) : phase === 1 ? (
					<AstronomicalEvent format='DD HH:mm' icon={Icons.MoonFirstQuarter} key={phase} label='FIRST QUARTER' time={time} />
				) : phase === 2 ? (
					<AstronomicalEvent format='DD HH:mm' icon={Icons.MoonFull} key={phase} label='FULL MOON' time={time} />
				) : (
					<AstronomicalEvent format='DD HH:mm' icon={Icons.MoonLastQuarter} key={phase} label='LAST QUARTER' time={time} />
				),
			)}
		</div>
	)
})

export const LunarEclipses = memo(() => {
	const moon = useMolecule(MoonMolecule)
	const { eclipses } = useSnapshot(moon.state)

	return (
		<div className='flex flex-col gap-0'>
			{eclipses.map((eclipse) => (
				<AstronomicalEvent format='YYYY-MM-DD HH:mm' icon={Icons.Moon} key={eclipse.startTime} label={eclipse.type} time={eclipse.startTime} />
			))}
		</div>
	)
})

const PLANETS = [
	{ name: 'Mercury', type: 'PLANET', code: '199' },
	{ name: 'Venus', type: 'PLANET', code: '299' },
	{ name: 'Mars', type: 'PLANET', code: '499' },
	{ name: 'Jupiter', type: 'PLANET', code: '599' },
	{ name: 'Saturn', type: 'PLANET', code: '699' },
	{ name: 'Uranus', type: 'PLANET', code: '799' },
	{ name: 'Neptune', type: 'PLANET', code: '899' },
	{ name: 'Pluto', type: 'DWARF_PLANET', code: '999' },
	{ name: 'Phobos', type: 'MOON_OF_MARS', code: '401' },
	{ name: 'Deimos', type: 'MOON_OF_MARS', code: '402' },
	{ name: 'Io', type: 'MOON_OF_JUPITER', code: '501' },
	{ name: 'Europa', type: 'MOON_OF_JUPITER', code: '402' },
	{ name: 'Ganymede', type: 'MOON_OF_JUPITER', code: '403' },
	{ name: 'Callisto', type: 'MOON_OF_JUPITER', code: '504' },
	{ name: 'Mimas', type: 'MOON_OF_SATURN', code: '601' },
	{ name: 'Enceladus', type: 'MOON_OF_SATURN', code: '602' },
	{ name: 'Tethys', type: 'MOON_OF_SATURN', code: '603' },
	{ name: 'Dione', type: 'MOON_OF_SATURN', code: '604' },
	{ name: 'Rhea', type: 'MOON_OF_SATURN', code: '605' },
	{ name: 'Titan', type: 'MOON_OF_SATURN', code: '606' },
	{ name: 'Hyperion', type: 'MOON_OF_SATURN', code: '607' },
	{ name: 'Iapetus', type: 'MOON_OF_SATURN', code: '608' },
	{ name: 'Ariel', type: 'MOON_OF_URANUS', code: '701' },
	{ name: 'Umbriel', type: 'MOON_OF_URANUS', code: '702' },
	{ name: 'Titania', type: 'MOON_OF_URANUS', code: '703' },
	{ name: 'Oberon', type: 'MOON_OF_URANUS', code: '704' },
	{ name: 'Miranda', type: 'MOON_OF_URANUS', code: '705' },
	{ name: 'Triton', type: 'MOON_OF_NEPTUNE', code: '801' },
	{ name: 'Charon', type: 'MOON_OF_PLUTO', code: '901' },
	{ name: '1 Ceres', type: 'DWARF_PLANET', code: '1;' },
	{ name: '90377 Sedna', type: 'DWARF_PLANET', code: '90377;' },
	{ name: '136199 Eris', type: 'DWARF_PLANET', code: '136199;' },
	{ name: '2 Pallas', type: 'ASTEROID', code: '2;' },
	{ name: '3 Juno', type: 'ASTEROID', code: '3;' },
	{ name: '4 Vesta', type: 'ASTEROID', code: '4;' },
] as const

export const PlanetTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

	const planet = useMolecule(PlanetMolecule)
	const { code, position, chart } = useSnapshot(planet.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<Listbox className='pl-10 relative min-h-[200px] max-h-[240px] col-span-full' classNames={{ base: 'w-full', list: 'max-h-[190px] overflow-scroll' }} items={PLANETS} onAction={(key) => planet.select(key as never)} selectionMode='none'>
				{(planet) => (
					<ListboxItem description={planet.type} key={planet.code}>
						{planet.name}
					</ListboxItem>
				)}
			</Listbox>
			<EphemerisAndChart chart={chart} className='col-span-full' name={PLANETS.find((e) => e.code === code)?.name} position={position} twilight={twilight} />
		</div>
	)
})

export const AsteroidTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

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

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<div className='pl-10 relative min-h-[200px] max-h-[240px] col-span-full flex flex-col gap-2'>
				<Tabs className='w-full' classNames={{ panel: 'py-0' }} onSelectionChange={(value) => (asteroid.state.tab = value as never)} selectedKey={tab}>
					<Tab key='search' title='Search'>
						<AsteroidSearchTab />
					</Tab>
					<Tab key='closeApproaches' title='Close Approaches'>
						<AsteroidCloseApproachesTab />
					</Tab>
				</Tabs>
			</div>
			<EphemerisAndChart chart={chart} className='col-span-full' name={selected?.name} position={position} tags={tags} twilight={twilight} />
		</div>
	)
})

export const AsteroidSearchTab = memo(() => {
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
				<Listbox className='mt-2 w-full' classNames={{ base: 'min-h-[90px] w-full', list: 'max-h-[117px] overflow-scroll' }} items={list} onAction={asteroid.select} selectionMode='single'>
					{(item) => (
						<ListboxItem description={item.pdes} key={item.pdes}>
							{item.name}
						</ListboxItem>
					)}
				</Listbox>
			) : (
				<Listbox className='mt-2 w-full' classNames={{ base: 'min-h-[90px] w-full', list: 'max-h-[117px] overflow-scroll' }} items={selected?.parameters ?? []} selectionMode='none'>
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
			<PoweredBy className='mt-1' href='https://ssd-api.jpl.nasa.gov/doc/sbdb.html' label='NASA/JPL Small-Body Database (SBDB) API' />
		</div>
	)
})

export const AsteroidCloseApproachesTab = memo(() => {
	const asteroid = useMolecule(AsteroidMolecule)
	const { loading } = useSnapshot(asteroid.state)
	const { days, distance } = useSnapshot(asteroid.state.closeApproaches.request, { sync: true })
	const { result } = useSnapshot(asteroid.state.closeApproaches)

	return (
		<div className='w-full flex flex-col gap-0'>
			<div className='w-full flex flex-row items-center justify-center gap-2'>
				<NumberInput className='flex-1' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={loading} label='Days' maxValue={30} minValue={1} onValueChange={(value) => asteroid.updateCloseApproaches('days', value)} size='sm' value={days} />
				<NumberInput className='flex-1' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={loading} label='Distance (LD)' maxValue={100} minValue={0.1} onValueChange={(value) => asteroid.updateCloseApproaches('distance', value)} size='sm' step={0.1} value={distance} />
				<IconButton color='primary' icon={Icons.Search} isDisabled={loading} onPointerUp={asteroid.closeApproaches} variant='light' />
			</div>
			<Listbox className='mt-2 w-full' classNames={{ base: 'min-h-[90px] w-full', list: 'max-h-[117px] overflow-scroll' }} items={result} onAction={asteroid.select} selectionMode='single'>
				{(item) => (
					<ListboxItem description={`${item.distance.toFixed(3)} LD`} key={item.name}>
						<span className='flex items-center justify-between'>
							<span>{item.name}</span>
							<span>{formatTemporal(item.date, 'YYYY-MM-DD HH:mm')}</span>
						</span>
					</ListboxItem>
				)}
			</Listbox>
			<PoweredBy href='https://ssd-api.jpl.nasa.gov/doc/cad.html' label='NASA/JPL SBDB Close Approach Data API' />
		</div>
	)
})

export const GalaxyTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

	const galaxy = useMolecule(GalaxyMolecule)
	const { sort } = useSnapshot(galaxy.state.request, { sync: true })
	const { result, position, chart } = useSnapshot(galaxy.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<Table className='pl-11 relative min-h-[200px] max-h-[240px] col-span-full' onRowAction={(key) => galaxy.select(+(key as never))} onSortChange={(value) => galaxy.update('sort', value)} removeWrapper selectionMode='single' sortDescriptor={sort}>
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
							<TableCell className='whitespace-nowrap max-w-50 overflow-hidden'>{formatSkyObjectName(item.name, item.constellation)}</TableCell>
							<TableCell className='text-center'>{item.magnitude}</TableCell>
							<TableCell className='text-center whitespace-nowrap max-w-40 overflow-hidden'>{formatSkyObjectType(item.type)}</TableCell>
							<TableCell className='text-center'>{CONSTELLATION_LIST[item.constellation]}</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
			<GalaxyPaginator className='col-span-full absolute w-full' />
			<EphemerisAndChart chart={chart} className='col-span-full' position={position} twilight={twilight} />
		</div>
	)
})

export const GalaxyPaginator = memo((props: React.HTMLAttributes<HTMLDivElement>) => {
	const galaxy = useMolecule(GalaxyMolecule)
	const { page } = useSnapshot(galaxy.state.request, { sync: true })
	const { loading, result } = useSnapshot(galaxy.state)

	return <Paginator {...props} count={result.length} loading={loading} onNext={galaxy.next} onPrev={galaxy.prev} page={page} />
})

export const SatelliteTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

	const satellite = useMolecule(SatelliteMolecule)
	const { result, position, chart } = useSnapshot(satellite.state)
	const { name } = useSnapshot(satellite.state.request.position)

	return (
		<div className='grid grid-cols-12 gap-2 items-center relative'>
			<Table className='pl-11 relative min-h-[200px] max-h-[240px] col-span-full' onRowAction={(key) => satellite.select(+(key as never))} removeWrapper selectionMode='single'>
				<TableHeader>
					<TableColumn className='text-center' key='id'>
						ID
					</TableColumn>
					<TableColumn className='text-center' key='name'>
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
			<SatellitePaginator className='col-span-full absolute w-full' />
			<EphemerisAndChart chart={chart} className='col-span-full' name={name} position={position} twilight={twilight} />
		</div>
	)
})

export const SatellitePaginator = memo((props: React.HTMLAttributes<HTMLDivElement>) => {
	const satellite = useMolecule(SatelliteMolecule)
	const { loading, result, page } = useSnapshot(satellite.state)

	return <Paginator {...props} count={result.length} isReadonly loading={loading} onNext={satellite.next} onPrev={satellite.prev} page={page} />
})

export interface PaginatorProps extends React.HTMLAttributes<HTMLDivElement> {
	readonly page: number
	readonly count: number
	readonly loading?: boolean
	readonly isReadonly?: boolean
	readonly onPrev: VoidFunction
	readonly onNext: VoidFunction
}

export function Paginator({ page, count, onPrev, onNext, loading = false, isReadonly = false, className, ...props }: PaginatorProps) {
	return (
		<div {...props} className={clsx('flex flex-row items-center justify-center gap-3', className)}>
			<IconButton color='secondary' icon={Icons.ChevronLeft} isDisabled={page <= 1 || loading} onPointerUp={onPrev} />
			<NumberInput className='max-w-20' classNames={{ input: 'text-center' }} formatOptions={INTEGER_NUMBER_FORMAT} hideStepper isDisabled={loading} isReadOnly={isReadonly} minValue={1} size='sm' value={page} />
			<IconButton color='secondary' icon={Icons.ChevronRight} isDisabled={count < 4 || loading} onPointerUp={onNext} />
		</div>
	)
}

const ONE_MINUTE = 60 * 1000

export const TimeBar = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { utc, offset } = useSnapshot(atlas.state.request.time)
	const { show, manual } = useSnapshot(atlas.state.calendar)

	const local = utc + offset * ONE_MINUTE

	const handleOnDateChange = useCallback((value: Temporal) => {
		atlas.updateTime(value - offset * ONE_MINUTE)
	}, [])

	const handleOnOpenChange = useCallback((isOpen: boolean) => {
		atlas.state.calendar.show = isOpen
	}, [])

	return (
		<div className='mt-1 inline-flex flex-row items-center gap-1'>
			<CalendarPopover date={local} isOpen={show} onDateChange={handleOnDateChange} onOpenChange={handleOnOpenChange} />
			<Tooltip content='Now' placement='bottom'>
				<IconButton color='success' icon={Icons.CalendarRefresh} isDisabled={!manual} onPointerUp={() => atlas.updateTime(Date.now(), false)} />
			</Tooltip>
		</div>
	)
})

export interface CalendarPopoverProps {
	readonly date: Temporal
	readonly onDateChange: (date: Temporal) => void
	readonly isOpen?: boolean
	readonly onOpenChange?: (isOpen: boolean) => void
}

export const CalendarPopover = memo(({ date, onDateChange, isOpen, onOpenChange }: CalendarPopoverProps) => {
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
		<Popover className='max-w-110' isOpen={isOpen} onOpenChange={onOpenChange} placement='bottom' showArrow>
			<PopoverTrigger>
				<TextButton color='secondary' label={formatTemporal(date, 'YYYY-MM-DD HH:mm')} startContent={<Icons.CalendarToday />} />
			</PopoverTrigger>
			<PopoverContent>
				<div className='grid grid-cols-12 gap-2 pb-2'>
					<Calendar className='col-span-full' classNames={{ base: 'shadow-none' }} onChange={handleDateChange} showMonthAndYearPickers value={fromAbsolute(date, 'UTC')} />
					<div className='col-span-full flex flex-row items-center justify-center gap-1'>
						<NumberInput className='max-w-20' formatOptions={INTEGER_NUMBER_FORMAT} maxValue={23} minValue={0} onValueChange={handleOnHourChange} value={hour} variant='bordered' />
						<span className='text-lg font-bold'>:</span>
						<NumberInput className='max-w-20' formatOptions={INTEGER_NUMBER_FORMAT} maxValue={59} minValue={0} onValueChange={handleOnMinuteChange} value={minute} variant='bordered' />
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
})

export interface AstronomicalEventProps {
	readonly icon: Icon
	readonly label: string
	readonly time: Temporal
	readonly format: string
}

export const AstronomicalEvent = memo(({ icon: Icon, label, time, format }: AstronomicalEventProps) => {
	return (
		<div className='flex flex-col gap-0'>
			<span className='font-bold flex items-start gap-1'>
				<Icon />
				{label}
			</span>
			<span className='ps-6 mt-[-4px] mb-1'>{formatTemporal(time, format)}</span>
		</div>
	)
})

export interface EphemerisAndChartTag {
	readonly label: string
	readonly color: ChipProps['color']
}

export interface EphemerisAndChartProps extends React.HTMLAttributes<HTMLDivElement> {
	readonly name?: string
	readonly position: BodyPosition
	readonly chart: readonly number[]
	readonly twilight?: Twilight
	readonly tags?: EphemerisAndChartTag[]
}

function makeTags(name: string | undefined, position: BodyPosition, extra?: EphemerisAndChartTag[]): EphemerisAndChartTag[] {
	const tags: EphemerisAndChartTag[] = []

	if (name) {
		tags.push({ label: name, color: 'primary' })
	} else if (position.names?.length) {
		position.names.forEach((name) => tags.push({ label: formatSkyObjectName(name, position.constellation), color: 'primary' }))
	}

	if (extra?.length) {
		tags.push(...extra)
	}

	return tags
}

export const EphemerisAndChart = memo(({ name, position, chart, twilight, tags, className }: EphemerisAndChartProps) => {
	const [showChart, setShowChart] = useState(false)

	tags = useMemo(() => makeTags(name, position, tags), [name, position.constellation, position.names, tags])
	const deferredChart = useDeferredValue(chart, [])
	const data = useMemo(() => makeEphemerisChart(deferredChart, twilight), [deferredChart, twilight])
	const deferredData = useDeferredValue(data, [])

	return (
		<div className={clsx('h-[160px] col-span-full relative flex flex-col justify-start items-center gap-1', className)}>
			<div className='w-full flex flex-row gap-2 text-start text-sm font-bold'>
				<Button className='rounded-full' color='primary' isIconOnly onPointerUp={() => setShowChart(false)} variant={showChart ? 'light' : 'flat'}>
					<Icons.Info />
				</Button>
				<Button className='rounded-full' color='primary' isIconOnly onPointerUp={() => setShowChart(true)} variant={showChart ? 'flat' : 'light'}>
					<Icons.Chart />
				</Button>
				<div className='flex-1 justify-center items-center flex text-sm font-bold overflow-hidden'>
					<ScrollShadow className='w-full flex gap-1' hideScrollBar orientation='horizontal'>
						{tags?.map((tag) => (
							<Chip color={tag.color} key={tag.label} size='sm'>
								{tag.label}
							</Chip>
						))}
					</ScrollShadow>
				</div>
			</div>
			<span className='w-full absolute top-[42px] left-0' style={{ visibility: showChart ? 'hidden' : 'visible' }}>
				<EphemerisPosition position={position} />
			</span>
			<span className='w-full absolute top-[42px] left-0' style={{ visibility: showChart ? 'visible' : 'hidden' }}>
				<EphemerisChart data={deferredData} />
			</span>
		</div>
	)
})

export const GalaxyFilter = memo(() => {
	const dso = useMolecule(GalaxyMolecule)
	const { name, nameType, magnitudeMin, magnitudeMax, constellations, types, visible, visibleAbove, rightAscension, declination, radius } = useSnapshot(dso.state.request, { sync: true })
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
				<Tooltip content='Filter' placement='bottom'>
					<IconButton color='primary' icon={Icons.Search} isDisabled={loading} onPointerUp={() => dso.search()} variant='flat' />
				</Tooltip>
			</div>
		</div>
	)
})

export const SatelliteFilter = memo(() => {
	const satellite = useMolecule(SatelliteMolecule)
	const { text, groups } = useSnapshot(satellite.state.request.search, { sync: true })
	const { loading } = useSnapshot(satellite.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center p-2'>
			<Input className='col-span-full' isClearable label='Search' onValueChange={(value) => satellite.update('text', value)} size='sm' value={text} />
			<SatelliteGroupTypeChipGroup className='col-span-full h-[200px]' onValueChange={(value) => satellite.update('groups', value)} value={groups} />
			<div className='col-span-full flex flex-row items-center justify-center gap-2'>
				<Tooltip content='Reset' placement='bottom'>
					<IconButton color='danger' icon={Icons.Restore} isDisabled={loading} onPointerUp={satellite.reset} variant='flat' />
				</Tooltip>
				<Tooltip content='Filter' placement='bottom'>
					<IconButton color='primary' icon={Icons.Search} isDisabled={loading} onPointerUp={satellite.search} variant='flat' />
				</Tooltip>
			</div>
		</div>
	)
})

export interface EphemerisPositionProps {
	readonly position: BodyPosition
}

export const EphemerisPosition = memo(({ position }: EphemerisPositionProps) => {
	const atlas = useMolecule(SkyAtlasMolecule)

	return (
		<div className='w-full grid grid-cols-12 gap-2 p-0'>
			<Input className='col-span-3' isReadOnly label='RA' size='sm' value={formatRA(position.rightAscension)} />
			<Input className='col-span-3' isReadOnly label='DEC' size='sm' value={formatDEC(position.declination)} />
			<Input className='col-span-3' isReadOnly label='RA (J2000)' size='sm' value={formatRA(position.rightAscensionJ2000)} />
			<Input className='col-span-3' isReadOnly label='DEC (J2000)' size='sm' value={formatDEC(position.declinationJ2000)} />
			<Input className='col-span-3' isReadOnly label='AZ' size='sm' value={formatAZ(position.azimuth)} />
			<Input className='col-span-3' isReadOnly label='ALT' size='sm' value={formatALT(position.altitude)} />
			<Input className='col-span-2' isReadOnly label='Mag.' size='sm' value={position.magnitude?.toFixed(2) ?? '-'} />
			<Input className='col-span-2' isReadOnly label='Const.' size='sm' value={position.constellation} />
			<Input className='col-span-2' isReadOnly label='Illum.' size='sm' value={`${position.illuminated.toFixed(1)} %`} />
			<Input className='col-span-4' isReadOnly label='Dist.' size='sm' value={formatDistance(position.distance)} />
			<Input className='col-span-2' isReadOnly label='Elong.' size='sm' value={`${position.elongation.toFixed(1)} °`} />
			<Input className='col-span-2' isReadOnly label='Pier' size='sm' value={position.pierSide === 'NEITHER' ? 'N' : position.pierSide} />
			<div className='col-span-4 flex items-center justify-center gap-2'>
				<MountDropdown allowEmpty={false} onValueChange={atlas.syncTo} tooltipContent='Sync'>
					{(value, color, isDisabled) => <IconButton color='primary' icon={Icons.Sync} isDisabled={isDisabled} variant='flat' />}
				</MountDropdown>
				<MountDropdown allowEmpty={false} onValueChange={atlas.goTo} tooltipContent='Go To'>
					{(value, color, isDisabled) => <IconButton color='success' icon={Icons.Telescope} isDisabled={isDisabled} variant='flat' />}
				</MountDropdown>
				<Tooltip content='Frame' placement='bottom'>
					<IconButton color='secondary' icon={Icons.Image} isDisabled={position.pierSide === 'NEITHER'} onPointerUp={atlas.frame} variant='flat' />
				</Tooltip>
			</div>
		</div>
	)
})

export interface EphemerisChartData {
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

export interface EphemerisChartProps {
	readonly data: EphemerisChartData[]
}

export const EphemerisChart = memo(({ data }: EphemerisChartProps) => {
	function tickFormatter(value: unknown, i: number) {
		return `${((i + 12) % 24).toFixed(0).padStart(2, '0')}`
	}

	return (
		<ComposedChart data={data} height={140} margin={{ top: 0, right: 8, left: 0, bottom: 0 }} width={412}>
			<XAxis dataKey='name' domain={[0, 1440]} fontSize={10} interval={59} tickFormatter={tickFormatter} tickMargin={6} />
			<YAxis domain={[0, 90]} width={25} />
			<Area activeDot={false} connectNulls dataKey='dayFirst' dot={false} fill='#FFF176' fillOpacity={0.3} isAnimationActive={false} stroke='transparent' type='monotone' />
			<Area activeDot={false} connectNulls dataKey='civilDusk' dot={false} fill='#7986CB' fillOpacity={0.3} isAnimationActive={false} stroke='transparent' type='monotone' />
			<Area activeDot={false} connectNulls dataKey='nauticalDusk' dot={false} fill='#3F51B5' fillOpacity={0.3} isAnimationActive={false} stroke='transparent' type='monotone' />
			<Area activeDot={false} connectNulls dataKey='astronomicalDusk' dot={false} fill='#303F9F' fillOpacity={0.3} isAnimationActive={false} stroke='transparent' type='monotone' />
			<Area activeDot={false} connectNulls dataKey='night' dot={false} fill='#1A237E' fillOpacity={0.3} isAnimationActive={false} stroke='transparent' type='monotone' />
			<Area activeDot={false} connectNulls dataKey='astronomicalDawn' dot={false} fill='#303F9F' fillOpacity={0.3} isAnimationActive={false} stroke='transparent' type='monotone' />
			<Area activeDot={false} connectNulls dataKey='nauticalDawn' dot={false} fill='#3F51B5' fillOpacity={0.3} isAnimationActive={false} stroke='transparent' type='monotone' />
			<Area activeDot={false} connectNulls dataKey='civilDawn' dot={false} fill='#7986CB' fillOpacity={0.3} isAnimationActive={false} stroke='transparent' type='monotone' />
			<Area activeDot={false} connectNulls dataKey='dayLast' dot={false} fill='#FFF176' fillOpacity={0.3} isAnimationActive={false} stroke='transparent' type='monotone' />
			<CartesianGrid stroke='#FFFFFF10' strokeDasharray='3 3' />
			<ChartTooltip />
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
