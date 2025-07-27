import { Button, Checkbox, Input, NumberInput, Slider, Tab, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Tabs } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { formatALT, formatAZ, formatDEC, formatRA } from 'nebulosa/src/angle'
import { CONSTELLATION_LIST, CONSTELLATIONS } from 'nebulosa/src/constellation'
import { type Distance, toKilometer, toLightYear } from 'nebulosa/src/distance'
import type { BodyPosition, SkyObjectSearchResult } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { SkyAtlasMolecule } from '@/molecules/skyatlas'
import { ConstellationSelect } from './ConstellationSelect'
import { Modal } from './Modal'
import { SKY_OBJECT_NAME_TYPES, SkyObjectNameTypeDropdown } from './SkyObjectNameTypeDropdown'
import { StellariumObjectTypeSelect } from './StellariumObjectTypeSelect'

export function SkyAtlas() {
	const skyAtlas = useMolecule(SkyAtlasMolecule)
	const dsos = useSnapshot(skyAtlas.dsos.state.request, { sync: true })
	const { loading, result: dsosResult, selected, position } = useSnapshot(skyAtlas.dsos.state)

	return (
		<Modal header='Sky Atlas' maxWidth='540px' name='sky-atlas' onClose={skyAtlas.close}>
			<div className='mt-0 flex flex-col gap-2'>
				<Tabs>
					<Tab title={<Tabler.IconSun />}></Tab>
					<Tab title={<Tabler.IconMoon />}></Tab>
					<Tab title={<Tabler.IconPlanet />}></Tab>
					<Tab title={<Tabler.IconComet />}></Tab>
					<Tab title={<Tabler.IconGalaxy />}>
						<div className='grid grid-cols-12 gap-2 items-center'>
							<Input
								className='col-span-6 sm:col-span-4'
								isDisabled={loading}
								onValueChange={(value) => skyAtlas.dsos.update('name', value)}
								placeholder='Search'
								startContent={<SkyObjectNameTypeDropdown color='secondary' onValueChange={(value) => skyAtlas.dsos.update('nameType', value)} value={dsos.nameType} />}
								value={dsos.name}
							/>
							<ConstellationSelect className='col-span-6 sm:col-span-4' isDisabled={loading} onValueChange={(value) => skyAtlas.dsos.update('constellations', value)} value={dsos.constellations} />
							<StellariumObjectTypeSelect className='col-span-6 sm:col-span-4' isDisabled={loading} onValueChange={(value) => skyAtlas.dsos.update('types', value)} value={dsos.types} />
							<Slider
								className='col-span-6 sm:col-span-4'
								getValue={(value) => `min: ${(value as number[])[0].toFixed(1)} max: ${(value as number[])[1].toFixed(1)}`}
								isDisabled={loading}
								label='Magnitude'
								maxValue={30}
								minValue={-30}
								onChange={(value) => {
									skyAtlas.dsos.update('magnitudeMin', (value as number[])[0])
									skyAtlas.dsos.update('magnitudeMax', (value as number[])[1])
								}}
								step={0.1}
								value={[dsos.magnitudeMin, dsos.magnitudeMax]}
							/>
							<Input className='col-span-4 sm:col-span-3' isDisabled={dsos.radius <= 0 || loading} label='RA' onValueChange={(value) => skyAtlas.dsos.update('rightAscension', value)} size='sm' value={dsos.rightAscension} />
							<Input className='col-span-4 sm:col-span-3' isDisabled={dsos.radius <= 0 || loading} label='DEC' onValueChange={(value) => skyAtlas.dsos.update('declination', value)} size='sm' value={dsos.declination} />
							<NumberInput className='col-span-4 sm:col-span-2' isDisabled={loading} label='Radius (°)' maxValue={360} minValue={0} onValueChange={(value) => skyAtlas.dsos.update('radius', value)} size='sm' step={0.1} value={dsos.radius} />
							<Checkbox className='col-span-5 sm:col-span-4' isDisabled={loading} isSelected={dsos.visible} onValueChange={(value) => skyAtlas.dsos.update('visible', value)}>
								Show only visible
							</Checkbox>
							<NumberInput className='col-span-5 sm:col-span-3' isDisabled={!dsos.visible || loading} label='Visible above (°)' maxValue={89} minValue={0} onValueChange={(value) => skyAtlas.dsos.update('visibleAbove', value)} size='sm' value={dsos.visibleAbove} />
							<div className='col-span-2 sm:col-span-5 flex flex-row items-center justify-center'>
								<Button color='primary' isDisabled={loading} isIconOnly onPointerUp={() => skyAtlas.dsos.search()} variant='flat'>
									<Lucide.Search size={18} />
								</Button>
							</div>
							<Table className='mt-3 col-span-full' onRowAction={(key) => skyAtlas.dsos.select(+(key as never))} onSortChange={(value) => skyAtlas.dsos.update('sort', value)} removeWrapper selectionMode='single' sortDescriptor={dsos.sort}>
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
								<TableBody items={dsosResult}>
									{(item) => (
										<TableRow key={item.id}>
											<TableCell>{formatSkyObjectName(item)}</TableCell>
											<TableCell className='text-center'>{item.magnitude}</TableCell>
											<TableCell className='text-center'>{formatSkyObjectType(item.type)}</TableCell>
											<TableCell className='text-center'>{CONSTELLATION_LIST[item.constellation]}</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
							<div className='col-span-full flex flex-row items-center justify-center gap-3'>
								<Button color='secondary' isDisabled={dsos.page <= 1 || loading} isIconOnly onPointerUp={() => skyAtlas.dsos.update('page', dsos.page - 1)} variant='flat'>
									<Lucide.ChevronLeft size={18} />
								</Button>
								<NumberInput className='max-w-20' classNames={{ input: 'text-center' }} hideStepper={true} isDisabled={!dsosResult.length || loading} onValueChange={(value) => skyAtlas.dsos.update('page', value)} size='sm' step={1} value={dsos.page} />
								<Button color='secondary' isDisabled={!dsosResult.length || loading} isIconOnly onPointerUp={() => skyAtlas.dsos.update('page', dsos.page + 1)} variant='flat'>
									<Lucide.ChevronRight size={18} />
								</Button>
							</div>
							{selected && (
								<div className='col-span-full'>
									<PositionOfBody item={selected} position={position} />
								</div>
							)}
						</div>
					</Tab>
					<Tab title={<Tabler.IconSatellite />}></Tab>
				</Tabs>
			</div>
		</Modal>
	)
}

export interface PositionOfBodyProps {
	readonly position: BodyPosition
	readonly item?: SkyObjectSearchResult
}

export function PositionOfBody({ position, item }: PositionOfBodyProps) {
	return (
		<div className='w-full grid grid-cols-12 gap-2 p-0'>
			<div className='col-span-full text-center text-sm font-bold'>{position.names?.map((e) => formatSkyObjectName({ name: e, constellation: item!.constellation })).join(', ')}</div>
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='RA' size='sm' value={formatRA(position.rightAscension)} />
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='DEC' size='sm' value={formatDEC(position.declination)} />
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='RA (J2000)' size='sm' value={formatRA(position.rightAscensionJ2000)} />
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='DEC (J2000)' size='sm' value={formatDEC(position.declinationJ2000)} />
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='AZ' size='sm' value={formatAZ(position.azimuth)} />
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='ALT' size='sm' value={formatALT(position.altitude)} />
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='Magnitude' size='sm' value={position.magnitude.toFixed(2)} />
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='Constellation' size='sm' value={position.constellation} />
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='Distance' size='sm' value={formatDistance(position.distance)} />
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='Illuminated (%)' size='sm' value={position.illuminated.toFixed(2)} />
			<Input className='col-span-6 sm:col-span-3' isReadOnly label='Elongation (°)' size='sm' value={position.elongation.toFixed(2)} />
		</div>
	)
}

function formatSkyObjectName(item: Pick<SkyObjectSearchResult, 'name' | 'constellation'>) {
	const [type, name] = item.name.split(':')
	const typeId = +type

	if (typeId === 0) return name
	if (typeId === 3 || typeId === 4) return `${name} ${CONSTELLATIONS[CONSTELLATION_LIST[item.constellation]].iau}`
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
	return `${SKY_OBJECT_NAME_TYPES[typeId + 1]} ${name}`
}

function formatSkyObjectType(type: SkyObjectSearchResult['type']) {
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
	if (distance >= 63241.077084266280268653583182) return `${toLightYear(distance).toFixed(2)} ly`
	if (distance >= 1) return `${distance} au`
	return `${(toKilometer(distance)).toFixed(3)} km`
}
