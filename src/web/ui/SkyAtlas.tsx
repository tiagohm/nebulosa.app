import { Button, Checkbox, Chip, type ChipProps, Input, Listbox, ListboxItem, NumberInput, Popover, PopoverContent, PopoverTrigger, ScrollShadow, Slider, Tab, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Tabs, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatALT, formatAZ, formatDEC, formatRA } from 'nebulosa/src/angle'
import { RAD2DEG } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST, CONSTELLATIONS, type Constellation } from 'nebulosa/src/constellation'
import { type Distance, toKilometer, toLightYear } from 'nebulosa/src/distance'
import { formatTemporal } from 'nebulosa/src/temporal'
import { memo, useDeferredValue, useMemo, useState } from 'react'
import { Area, CartesianGrid, Tooltip as ChartTooltip, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { type BodyPosition, EMPTY_TWILIGHT, type SkyObjectSearchItem, type Twilight } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { AsteroidMolecule, GalaxyMolecule, MoonMolecule, PlanetMolecule, SatelliteMolecule, SkyAtlasMolecule, SunMolecule } from '@/molecules/skyatlas'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { ConstellationSelect } from './ConstellationSelect'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'
import { Moon } from './Moon'
import { MountDropdown } from './MountDropdown'
import { SatelliteGroupTypeSelect } from './SatelliteGroupTypeSelect'
import { SKY_OBJECT_NAME_TYPES, SkyObjectNameTypeDropdown } from './SkyObjectNameTypeDropdown'
import { StellariumObjectTypeSelect } from './StellariumObjectTypeSelect'
import { Sun } from './Sun'

export const SkyAtlas = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { tab } = useSnapshot(atlas.state)

	const Header = (
		<div className='flex flex-row items-center justify-between'>
			<span>Sky Atlas</span>
			{(tab === 'galaxy' || tab === 'satellite') && (
				<Popover className='max-w-140' placement='bottom' showArrow>
					<PopoverTrigger>
						<Button color='secondary' isIconOnly variant='flat'>
							<Icons.Filter />
						</Button>
					</PopoverTrigger>
					<PopoverContent>
						{tab === 'galaxy' && <GalaxyFilter />}
						{tab === 'satellite' && <SatelliteFilter />}
					</PopoverContent>
				</Popover>
			)}
		</div>
	)

	return (
		<Modal header={Header} maxWidth='450px' name='sky-atlas' onHide={atlas.hide}>
			<div className='mt-0 flex flex-col gap-2'>
				<Tabs classNames={{ base: 'absolute top-[-42px] right-[88px] z-10', panel: 'pt-0' }} onSelectionChange={(value) => (atlas.state.tab = value as never)} selectedKey={tab}>
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
			<div className='relative col-span-full flex justify-center items-center'>
				<Sun onSourceChange={(source) => (sun.state.source = source)} source={source} />
				<div className='absolute top-auto left-0 p-0 text-xs'>
					<SolarEclipses />
				</div>
				<div className='absolute top-auto right-0 p-0 text-xs'>
					<Seasons />
				</div>
			</div>
			<div className='col-span-full'>
				<EphemerisAndChart chart={chart} name='Sun' position={position} twilight={twilight} />
			</div>
		</div>
	)
})

export const SolarEclipses = memo(() => {
	const sun = useMolecule(SunMolecule)
	const { eclipses } = useSnapshot(sun.state)

	return (
		<div className='flex flex-col gap-0'>
			{eclipses.map((eclipse) => (
				<>
					<span className='font-bold flex items-center gap-1'>
						<Icons.Sun />
						{eclipse.type}
					</span>
					<span className='ps-6 mt-[-4px] mb-1'>{formatTemporal(eclipse.time, 'YYYY-MM-DD HH:mm')}</span>
				</>
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
			<span className='font-bold flex items-center gap-1'>
				{isSouthern ? <Icons.Flower /> : <Icons.Leaf />}
				{isSouthern ? 'SPRING' : 'AUTUMN/FALL'}
			</span>
			<span className='ps-6 mt-[-4px] mb-1'>{formatTemporal(isSouthern ? autumn : spring, 'MM-DD HH:mm')}</span>
			<span className='font-bold flex items-center gap-1'>
				{isSouthern ? <Icons.Sun /> : <Icons.SnowFlake />}
				{isSouthern ? 'SUMMER' : 'WINTER'}
			</span>
			<span className='ps-6 mt-[-4px]'>{formatTemporal(isSouthern ? winter : summer, 'MM-DD HH:mm')}</span>
			<span className='font-bold flex items-center gap-1'>
				{isSouthern ? <Icons.Leaf /> : <Icons.Flower />}
				{isSouthern ? 'AUTUMN/FALL' : 'SPRING'}
			</span>
			<span className='ps-6 mt-[-4px] mb-1'>{formatTemporal(isSouthern ? spring : autumn, 'MM-DD HH:mm')}</span>
			<span className='font-bold flex items-center gap-1'>
				{isSouthern ? <Icons.SnowFlake /> : <Icons.Sun />}
				{isSouthern ? 'WINTER' : 'SUMMER'}
			</span>
			<span className='ps-6 mt-[-4px] mb-1'>{formatTemporal(isSouthern ? summer : winter, 'MM-DD HH:mm')}</span>
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
			<div className='relative col-span-full flex justify-center items-center'>
				<Moon />
				<div className='absolute top-auto left-0 p-0 text-xs'>
					<LunarEclipses />
				</div>
				<div className='absolute top-auto right-0 p-0 text-xs'>
					<MoonPhases />
				</div>
			</div>
			<div className='col-span-full'>
				<EphemerisAndChart chart={chart} name='Moon' position={position} twilight={twilight} />
			</div>
		</div>
	)
})

export const MoonPhases = memo(() => {
	const moon = useMolecule(MoonMolecule)
	const { phases } = useSnapshot(moon.state)

	return (
		<div className='flex flex-col gap-0'>
			{phases.map(([phase, time]) => (
				<>
					<span className='font-bold flex items-center gap-1'>
						{phase === 0 ? <Icons.MoonNew /> : phase === 1 ? <Icons.MoonFirstQuarter /> : phase === 2 ? <Icons.MoonFull /> : <Icons.MoonLastQuarter />}
						{phase === 0 ? 'NEW MOON' : phase === 1 ? 'FIRST QUARTER' : phase === 2 ? 'FULL MOON' : 'LAST QUARTER'}
					</span>
					<span className='ps-6 mt-[-4px] mb-1'>{formatTemporal(time, 'DD HH:mm')}</span>
				</>
			))}
		</div>
	)
})

export const LunarEclipses = memo(() => {
	const moon = useMolecule(MoonMolecule)
	const { eclipses } = useSnapshot(moon.state)

	return (
		<div className='flex flex-col gap-0'>
			{eclipses.map((eclipse) => (
				<>
					<span className='font-bold flex items-center gap-1'>
						<Icons.Moon />
						{eclipse.type}
					</span>
					<span className='ps-6 mt-[-4px] mb-1'>{formatTemporal(eclipse.startTime, 'YYYY-MM-DD HH:mm')}</span>
				</>
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
			<Listbox className='col-span-full' classNames={{ base: 'w-full', list: 'max-h-[200px] overflow-scroll' }} items={PLANETS} onAction={(key) => planet.select(key as never)} selectionMode='none'>
				{(planet) => (
					<ListboxItem description={planet.type} key={planet.code}>
						{planet.name}
					</ListboxItem>
				)}
			</Listbox>
			<div className='col-span-full'>
				<EphemerisAndChart chart={chart} name={PLANETS.find((e) => e.code === code)?.name} position={position} twilight={twilight} />
			</div>
		</div>
	)
})

export const AsteroidTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

	const asteroid = useMolecule(AsteroidMolecule)
	const { loading, selected, position, chart } = useSnapshot(asteroid.state)
	const { text: searchText } = useSnapshot(asteroid.state.search, { sync: true })

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
			<div className='col-span-full flex flex-col gap-2'>
				<Tabs className='w-full' classNames={{ panel: 'pt-0' }}>
					<Tab key='search' title='Search'>
						<div className='w-full flex flex-col gap-2'>
							<div className='w-full flex flex-row items-center justify-center gap-2'>
								<Input className='w-full' isDisabled={loading} label='Search' onValueChange={(value) => asteroid.update('text', value)} placeholder='Enter the IAU number, designation, name or SPK ID' size='sm' value={searchText} />
								<IconButton color='primary' icon={Icons.Search} isDisabled={loading || !searchText} isIconOnly onPointerUp={asteroid.search} variant='light' />
							</div>
							<Listbox className='w-full' classNames={{ base: 'w-full', list: 'max-h-[156px] overflow-scroll' }} items={selected?.parameters ?? []} selectionMode='none'>
								{(parameter) => (
									<ListboxItem description={parameter.description} key={parameter.name}>
										<span className='flex items-center justify-between'>
											<span>{parameter.name}</span>
											<span>{parameter.value}</span>
										</span>
									</ListboxItem>
								)}
							</Listbox>
						</div>
					</Tab>
				</Tabs>
			</div>
			<div className='col-span-full'>
				<EphemerisAndChart chart={chart} name={selected?.name} position={position} tags={tags} twilight={twilight} />
			</div>
		</div>
	)
})

export const GalaxyTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

	const galaxy = useMolecule(GalaxyMolecule)
	const { page, sort } = useSnapshot(galaxy.state.request, { sync: true })
	const { loading, result, position, chart } = useSnapshot(galaxy.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<Table className='mt-3 col-span-full' onRowAction={(key) => galaxy.select(+(key as never))} onSortChange={(value) => galaxy.update('sort', value)} removeWrapper selectionMode='single' sortDescriptor={sort}>
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
			<div className='col-span-full flex flex-row items-center justify-center gap-3'>
				<Button color='secondary' isDisabled={page <= 1 || loading} isIconOnly onPointerUp={galaxy.prev} variant='flat'>
					<Icons.ChevronLeft />
				</Button>
				<NumberInput className='max-w-20' classNames={{ input: 'text-center' }} formatOptions={INTEGER_NUMBER_FORMAT} hideStepper isDisabled={!result.length || loading} isWheelDisabled minValue={1} onValueChange={(value) => galaxy.update('page', value)} size='sm' value={page} />
				<Button color='secondary' isDisabled={!result.length || loading} isIconOnly onPointerUp={galaxy.next} variant='flat'>
					<Icons.ChevronRight />
				</Button>
			</div>
			<div className='col-span-full'>
				<EphemerisAndChart chart={chart} position={position} twilight={twilight} />
			</div>
		</div>
	)
})

export const SatelliteTab = memo(() => {
	const atlas = useMolecule(SkyAtlasMolecule)
	const { twilight } = useSnapshot(atlas.state)

	const satellite = useMolecule(SatelliteMolecule)
	// biome-ignore format: don't break lines
	const { loading, result, position, chart, page, request: { position: { name } } } = useSnapshot(satellite.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center'>
			<Table className='mt-3 col-span-full' onRowAction={(key) => satellite.select(+(key as never))} removeWrapper selectionMode='single'>
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
			<div className='col-span-full flex flex-row items-center justify-center gap-3'>
				<Button color='secondary' isDisabled={page <= 1 || loading} isIconOnly onPointerUp={satellite.prev} variant='flat'>
					<Icons.ChevronLeft />
				</Button>
				<NumberInput className='max-w-20' classNames={{ input: 'text-center' }} formatOptions={INTEGER_NUMBER_FORMAT} hideStepper isDisabled={!result.length || loading} isReadOnly minValue={1} size='sm' value={page} />
				<Button color='secondary' isDisabled={!result.length || loading} isIconOnly onPointerUp={satellite.next} variant='flat'>
					<Icons.ChevronRight />
				</Button>
			</div>
			<div className='col-span-full'>
				<EphemerisAndChart chart={chart} name={name} position={position} twilight={twilight} />
			</div>
		</div>
	)
})

export interface EphemerisAndChartTag {
	readonly label: string
	readonly color: ChipProps['color']
}

export interface EphemerisAndChartProps {
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
		position.names.forEach((name) => tags.push({ label: skyObjectName(name, position.constellation), color: 'primary' }))
	}

	if (extra?.length) {
		tags.push(...extra)
	}

	return tags
}

export const EphemerisAndChart = memo(({ name, position, chart, twilight, tags }: EphemerisAndChartProps) => {
	const [showChart, setShowChart] = useState(false)

	tags = useMemo(() => makeTags(name, position, tags), [name, position.constellation, position.names, tags])
	const deferredChart = useDeferredValue(chart, [])
	const data = useMemo(() => makeEphemerisChart(deferredChart, twilight), [deferredChart, twilight])
	const deferredData = useDeferredValue(data, [])

	return (
		<div className='h-[150px] col-span-full relative flex flex-col justify-start items-center gap-1'>
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
			<Input className='col-span-full' onValueChange={(value) => dso.update('name', value)} placeholder='Search' startContent={<SkyObjectNameTypeDropdown color='secondary' onValueChange={(value) => dso.update('nameType', value)} value={nameType} />} value={name} />
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
				<IconButton color='primary' icon={Icons.Search} isDisabled={loading} isIconOnly onPointerUp={() => dso.search()} variant='flat' />
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
			<Input className='col-span-6' label='Search' onValueChange={(value) => satellite.update('text', value)} value={text} />
			<SatelliteGroupTypeSelect className='col-span-6' onValueChange={(value) => satellite.update('groups', value)} value={groups} />
			<div className='col-span-full flex flex-row items-center justify-center'>
				<IconButton color='primary' icon={Icons.Search} isDisabled={loading} isIconOnly onPointerUp={() => satellite.search()} variant='flat' />
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
			<Input className='col-span-3' isReadOnly label='Dist.' size='sm' value={formatDistance(position.distance)} />
			<Input className='col-span-2' isReadOnly label='Elong.' size='sm' value={`${position.elongation.toFixed(1)} °`} />
			<Input className='col-span-2' isReadOnly label='Pier' size='sm' value={position.pierSide === 'NEITHER' ? 'N' : position.pierSide} />
			<div className='col-span-5 flex items-center justify-center gap-2'>
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
		<ComposedChart data={data} height={150} margin={{ top: 0, right: 8, left: 0, bottom: 0 }} width={412}>
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

function skyObjectName(id: string, constellation: Constellation | number) {
	const [type, name] = id.split(':')
	const typeId = +type

	if (typeId === 0) return name
	if (typeId === 3 || typeId === 4) return `${name} ${CONSTELLATIONS[typeof constellation === 'number' ? CONSTELLATION_LIST[constellation] : constellation].iau}`
	if (typeId === 8) return `M ${name}`
	if (typeId === 9) return `C ${name}`
	if (typeId === 10) return `B ${name}`
	if (typeId === 11) return `SH 2-${name}`
	if (typeId === 14) return `Mel ${name}`
	if (typeId === 15) return `Cr ${name}`
	if (typeId === 16) return `Arp ${name}`
	if (typeId === 17) return `Abell ${name}`
	if (typeId === 19) return `Tr ${name}`
	if (typeId === 20) return `St ${name}`
	if (typeId === 21) return `Ru ${name}`
	if (typeId === 33) return `Bennett ${name}`
	if (typeId === 34) return `Dunlop ${name}`
	if (typeId === 35) return `Hershel ${name}`
	if (typeId === 36) return `Gum ${name}`
	if (typeId === 37) return `Bochum ${name}`
	if (typeId === 38) return `Alessi ${name}`
	if (typeId === 39) return `Alicante ${name}`
	if (typeId === 40) return `Alter ${name}`
	if (typeId === 41) return `Antalova ${name}`
	if (typeId === 42) return `Apriamaswili ${name}`
	if (typeId === 43) return `Arp ${name}`
	if (typeId === 44) return `Barhatova ${name}`
	if (typeId === 45) return `Basel ${name}`
	if (typeId === 46) return `Berkeley ${name}`
	if (typeId === 47) return `Bica ${name}`
	if (typeId === 48) return `Biurakan ${name}`
	if (typeId === 49) return `Blanco ${name}`
	if (typeId === 50) return `Chupina ${name}`
	if (typeId === 51) return `Czernik ${name}`
	if (typeId === 52) return `Danks ${name}`
	if (typeId === 53) return `Dias ${name}`
	if (typeId === 54) return `Djorg ${name}`
	if (typeId === 55) return `Dolidze-Dzim ${name}`
	if (typeId === 56) return `Dolidze ${name}`
	if (typeId === 57) return `Dufay ${name}`
	if (typeId === 58) return `Feinstein ${name}`
	if (typeId === 59) return `Ferrero ${name}`
	if (typeId === 60) return `Graff ${name}`
	if (typeId === 61) return `Gulliver ${name}`
	if (typeId === 62) return `Haffner ${name}`
	if (typeId === 63) return `Harvard ${name}`
	if (typeId === 64) return `Haute-Provence ${name}`
	if (typeId === 65) return `Hogg ${name}`
	if (typeId === 66) return `Iskurzdajan ${name}`
	if (typeId === 67) return `Johansson ${name}`
	if (typeId === 68) return `Kharchenko ${name}`
	if (typeId === 69) return `King ${name}`
	if (typeId === 70) return `Kron ${name}`
	if (typeId === 71) return `Lindsay ${name}`
	if (typeId === 72) return `Loden ${name}`
	if (typeId === 73) return `Lynga ${name}`
	if (typeId === 74) return `Mamajek ${name}`
	if (typeId === 75) return `Moffat ${name}`
	if (typeId === 76) return `Mrk ${name}`
	if (typeId === 77) return `Pal ${name}`
	if (typeId === 78) return `Pismis ${name}`
	if (typeId === 79) return `Platais ${name}`
	if (typeId === 80) return `Roslund ${name}`
	if (typeId === 81) return `Saurer ${name}`
	if (typeId === 82) return `Sher ${name}`
	if (typeId === 83) return `Skiff ${name}`
	if (typeId === 84) return `Stephenson ${name}`
	if (typeId === 85) return `Terzan ${name}`
	if (typeId === 86) return `Tombaugh ${name}`
	if (typeId === 87) return `Turner ${name}`
	if (typeId === 88) return `Upgren ${name}`
	if (typeId === 89) return `Waterloo ${name}`
	if (typeId === 90) return `Westerlund ${name}`
	if (typeId === 91) return `Zwicky ${name}`
	return `${SKY_OBJECT_NAME_TYPES[typeId + 1]} ${name}`
}

function skyObjectType(type: SkyObjectSearchItem['type']) {
	if (type === 1) return 'Galaxy'
	if (type === 2) return 'Active Galaxy'
	if (type === 3) return 'Radio Galaxy'
	if (type === 4) return 'Interacting Galaxy'
	if (type === 5) return 'Quasar'
	if (type === 6) return 'Star Cluster'
	if (type === 7) return 'Open Star Cluster'
	if (type === 8) return 'Globular Star Cluster'
	if (type === 9) return 'Stellar Association'
	if (type === 10) return 'Star Cloud'
	if (type === 11) return 'Nebula'
	if (type === 12) return 'Planetary Nebula'
	if (type === 13) return 'Dark Nebula'
	if (type === 14) return 'Reflection Nebula'
	if (type === 15) return 'Bipolar Nebula'
	if (type === 16) return 'Emission Nebula'
	if (type === 17) return 'Cluster Associated With Nebulosity'
	if (type === 18) return 'HII Region'
	if (type === 19) return 'Supernova Remnant'
	if (type === 20) return 'Interstellar Matter'
	if (type === 21) return 'Emission Object'
	if (type === 22) return 'Bl Lacertae Object'
	if (type === 23) return 'Blazar'
	if (type === 24) return 'Molecular Cloud'
	if (type === 25) return 'Young Stellar Object'
	if (type === 26) return 'Possible Quasar'
	if (type === 27) return 'Possible Planetary Nebula'
	if (type === 28) return 'Protoplanetary Nebula'
	if (type === 29) return 'Star'
	if (type === 30) return 'Symbiotic Star'
	if (type === 31) return 'Emission Line Star'
	if (type === 32) return 'Supernova Candidate'
	if (type === 33) return 'Super Nova Remnant Candidate'
	if (type === 34) return 'Cluster of Galaxies'
	if (type === 35) return 'Part of Galaxy'
	if (type === 36) return 'Region of the Sky'
	return 'Unknown'
}

function formatDistance(distance: Distance) {
	if (distance >= 63241.077084266280268653583182) return `${toLightYear(distance).toFixed(0)} ly`
	if (distance >= 1) return `${distance.toFixed(2)} AU`
	if (distance <= 0) return '0'
	return `${(toKilometer(distance)).toFixed(0)} km`
}
