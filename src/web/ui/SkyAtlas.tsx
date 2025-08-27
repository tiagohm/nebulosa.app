import { Button, Checkbox, Input, NumberInput, Popover, PopoverContent, PopoverTrigger, Slider, Tab, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Tabs } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatALT, formatAZ, formatDEC, formatRA } from 'nebulosa/src/angle'
import { CONSTELLATION_LIST, CONSTELLATIONS } from 'nebulosa/src/constellation'
import { type Distance, toKilometer, toLightYear } from 'nebulosa/src/distance'
import { memo } from 'react'
import type { BodyPosition, SkyObjectSearchResult } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { SkyAtlasMolecule } from '@/molecules/skyatlas'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { ConstellationSelect } from './ConstellationSelect'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { SKY_OBJECT_NAME_TYPES, SkyObjectNameTypeDropdown } from './SkyObjectNameTypeDropdown'
import { StellariumObjectTypeSelect } from './StellariumObjectTypeSelect'

export const SkyAtlas = memo(() => {
	const skyAtlas = useMolecule(SkyAtlasMolecule)
	const { tab } = useSnapshot(skyAtlas.state)
	const { page, sort } = useSnapshot(skyAtlas.dsos.state.request, { sync: true })
	const { loading, result: dsosResult, selected, position } = useSnapshot(skyAtlas.dsos.state)

	return (
		<Modal
			header={
				<div className='flex flex-row items-center justify-between'>
					<span>Sky Atlas</span>
					{tab === 'dsos' && (
						<Popover className='max-w-160' placement='bottom' showArrow={true}>
							<PopoverTrigger>
								<Button color='secondary' isIconOnly variant='flat'>
									<Icons.Filter />
								</Button>
							</PopoverTrigger>
							<PopoverContent>{tab === 'dsos' && <DeepSkyObjectFilter />}</PopoverContent>
						</Popover>
					)}
				</div>
			}
			maxWidth='490px'
			name='sky-atlas'
			onClose={skyAtlas.close}>
			<div className='mt-0 flex flex-col gap-2'>
				<Tabs classNames={{ base: 'absolute top-[-42px] right-[88px] z-10', panel: 'pt-0' }} onSelectionChange={(value) => (skyAtlas.state.tab = value as never)} selectedKey={tab}>
					<Tab key='sun' title={<Icons.Sun />}></Tab>
					<Tab key='moon' title={<Icons.Moon />}></Tab>
					<Tab key='planets' title={<Icons.Planet />}></Tab>
					<Tab key='minor-planets' title={<Icons.Meteor />}></Tab>
					<Tab key='dsos' title={<Icons.Galaxy />}>
						<div className='grid grid-cols-12 gap-2 items-center'>
							<Table className='mt-3 col-span-full' onRowAction={(key) => skyAtlas.dsos.select(+(key as never))} onSortChange={(value) => skyAtlas.dsos.update('sort', value)} removeWrapper selectionMode='single' sortDescriptor={sort}>
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
											<TableCell className='whitespace-nowrap max-w-50 overflow-hidden'>{formatSkyObjectName(item)}</TableCell>
											<TableCell className='text-center'>{item.magnitude}</TableCell>
											<TableCell className='text-center whitespace-nowrap max-w-40 overflow-hidden'>{formatSkyObjectType(item.type)}</TableCell>
											<TableCell className='text-center'>{CONSTELLATION_LIST[item.constellation]}</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
							<div className='col-span-full flex flex-row items-center justify-center gap-3'>
								<Button color='secondary' isDisabled={page <= 1 || loading} isIconOnly onPointerUp={() => skyAtlas.dsos.update('page', page - 1)} variant='flat'>
									<Icons.ChevronLeft />
								</Button>
								<NumberInput className='max-w-20' classNames={{ input: 'text-center' }} formatOptions={INTEGER_NUMBER_FORMAT} hideStepper isDisabled={!dsosResult.length || loading} isWheelDisabled minValue={1} onValueChange={(value) => skyAtlas.dsos.update('page', value)} size='sm' value={page} />
								<Button color='secondary' isDisabled={!dsosResult.length || loading} isIconOnly onPointerUp={() => skyAtlas.dsos.update('page', page + 1)} variant='flat'>
									<Icons.ChevronRight />
								</Button>
							</div>
							{selected && (
								<div className='col-span-full'>
									<PositionOfBody item={selected} position={position} />
								</div>
							)}
						</div>
					</Tab>
					<Tab key='satellites' title={<Icons.Satellite />}></Tab>
				</Tabs>
			</div>
		</Modal>
	)
})

export const DeepSkyObjectFilter = memo(() => {
	const skyAtlas = useMolecule(SkyAtlasMolecule)
	const { name, nameType, magnitudeMin, magnitudeMax, constellations, types, visible, visibleAbove, rightAscension, declination, radius } = useSnapshot(skyAtlas.dsos.state.request, { sync: true })
	const { loading } = useSnapshot(skyAtlas.dsos.state)

	return (
		<div className='grid grid-cols-12 gap-2 items-center p-2'>
			<Input className='col-span-full' onValueChange={(value) => skyAtlas.dsos.update('name', value)} placeholder='Search' startContent={<SkyObjectNameTypeDropdown color='secondary' onValueChange={(value) => skyAtlas.dsos.update('nameType', value)} value={nameType} />} value={name} />
			<ConstellationSelect className='col-span-6' onValueChange={(value) => skyAtlas.dsos.update('constellations', value)} value={constellations} />
			<StellariumObjectTypeSelect className='col-span-6' onValueChange={(value) => skyAtlas.dsos.update('types', value)} value={types} />
			<Slider
				className='col-span-full sm:col-span-4'
				getValue={(value) => `min: ${(value as number[])[0].toFixed(1)} max: ${(value as number[])[1].toFixed(1)}`}
				label='Magnitude'
				maxValue={30}
				minValue={-30}
				onChange={(value) => {
					skyAtlas.dsos.update('magnitudeMin', (value as number[])[0])
					skyAtlas.dsos.update('magnitudeMax', (value as number[])[1])
				}}
				step={0.1}
				value={[magnitudeMin, magnitudeMax]}
			/>
			<Input className='col-span-4 sm:col-span-3' isDisabled={radius <= 0 || loading} label='RA' onValueChange={(value) => skyAtlas.dsos.update('rightAscension', value)} size='sm' value={rightAscension} />
			<Input className='col-span-4 sm:col-span-3' isDisabled={radius <= 0 || loading} label='DEC' onValueChange={(value) => skyAtlas.dsos.update('declination', value)} size='sm' value={declination} />
			<NumberInput className='col-span-4 sm:col-span-2' formatOptions={DECIMAL_NUMBER_FORMAT} label='Radius (°)' maxValue={360} minValue={0} onValueChange={(value) => skyAtlas.dsos.update('radius', value)} size='sm' step={0.1} value={radius} />
			<Checkbox className='col-span-5 sm:col-span-4' isSelected={visible} onValueChange={(value) => skyAtlas.dsos.update('visible', value)}>
				Show only visible
			</Checkbox>
			<NumberInput className='col-span-5 sm:col-span-3' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={!visible || loading} label='Visible above (°)' maxValue={89} minValue={0} onValueChange={(value) => skyAtlas.dsos.update('visibleAbove', value)} size='sm' value={visibleAbove} />
			<div className='col-span-2 sm:col-span-5 flex flex-row items-center justify-center'>
				<Button color='primary' isDisabled={loading} isIconOnly onPointerUp={() => skyAtlas.dsos.search()} variant='flat'>
					<Icons.Search />
				</Button>
			</div>
		</div>
	)
})

export interface PositionOfBodyProps {
	readonly position: BodyPosition
	readonly item?: SkyObjectSearchResult
}

export function PositionOfBody({ position, item }: PositionOfBodyProps) {
	return (
		<div className='w-full grid grid-cols-12 gap-2 p-0'>
			<div className='col-span-full text-center text-sm font-bold'>{position.names?.map((e) => formatSkyObjectName({ name: e, constellation: item!.constellation })).join(', ')}</div>
			<Input className='col-span-3 sm:col-span-3' isReadOnly label='RA' size='sm' value={formatRA(position.rightAscension)} />
			<Input className='col-span-3 sm:col-span-3' isReadOnly label='DEC' size='sm' value={formatDEC(position.declination)} />
			<Input className='col-span-3 sm:col-span-3' isReadOnly label='RA (J2000)' size='sm' value={formatRA(position.rightAscensionJ2000)} />
			<Input className='col-span-3 sm:col-span-3' isReadOnly label='DEC (J2000)' size='sm' value={formatDEC(position.declinationJ2000)} />
			<Input className='col-span-4 sm:col-span-3' isReadOnly label='AZ' size='sm' value={formatAZ(position.azimuth)} />
			<Input className='col-span-4 sm:col-span-3' isReadOnly label='ALT' size='sm' value={formatALT(position.altitude)} />
			<Input className='col-span-2 sm:col-span-2' isReadOnly label='Mag.' size='sm' value={position.magnitude.toFixed(2)} />
			<Input className='col-span-2 sm:col-span-2' isReadOnly label='Const.' size='sm' value={position.constellation} />
			<Input className='col-span-3 sm:col-span-2' isReadOnly label='Distance' size='sm' value={formatDistance(position.distance)} />
			<Input className='col-span-3 sm:col-span-2' isReadOnly label='Illuminated' size='sm' value={`${position.illuminated.toFixed(2)} %`} />
			<Input className='col-span-3 sm:col-span-2' isReadOnly label='Elongation' size='sm' value={`${position.elongation.toFixed(2)} °`} />
			<Input className='col-span-3 sm:col-span-2' isReadOnly label='Pier Side' size='sm' value={position.pierSide} />
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
	if (distance >= 63241.077084266280268653583182) return `${toLightYear(distance).toFixed(0)} ly`
	if (distance >= 1) return `${distance.toFixed(2)} au`
	if (distance <= 0) return '-'
	return `${(toKilometer(distance)).toFixed(0)} km`
}
