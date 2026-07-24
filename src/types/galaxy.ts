import { CONSTELLATION_LIST, CONSTELLATIONS } from 'nebulosa/src/astronomy/coordinates/constellation'
import type { Constellation } from 'nebulosa/src/astronomy/coordinates/constellation'
import type { StarCatalogEntry } from 'nebulosa/src/catalogs/stars/catalog'
import type { StellariumObjectType } from 'nebulosa/src/devices/protocols/stellarium'
import type { Distance } from 'nebulosa/src/math/units/distance'
import type { Velocity } from 'nebulosa/src/math/units/velocity'
import { DEFAULT_POSITION_OF_BODY } from 'src/types/atlas'
import type { LocationAndTime } from 'src/types/atlas'

export interface SearchSkyObject extends LocationAndTime {
	readonly id?: number | string | readonly (number | string)[]
	readonly name?: string
	readonly nameType?: number
	readonly constellations?: readonly Constellation[]
	readonly types?: readonly StellariumObjectType[]
	readonly magnitudeMin?: number
	readonly magnitudeMax?: number
	readonly rightAscension?: string // hour
	readonly declination?: string // deg
	readonly radius?: number // deg
	readonly visible?: boolean
	readonly visibleAbove?: number // deg
	readonly page?: number
	readonly limit?: number
}

export interface SkyObjectSearchItem {
	readonly id: number
	readonly magnitude: number
	readonly type: StellariumObjectType
	readonly constellation: number
	readonly name: string
}

export interface SkyObject extends Omit<Required<StarCatalogEntry>, 'id' | 'epoch'> {
	readonly id: number
	readonly type: StellariumObjectType
	readonly distance: Distance
	readonly rv: Velocity
	readonly constellation: number
	readonly spmType?: string
	readonly name: string
}

export const DEFAULT_SKY_OBJECT_SEARCH: Required<SearchSkyObject> = {
	id: 0,
	name: '',
	nameType: -1,
	constellations: [],
	types: [],
	magnitudeMin: -30,
	magnitudeMax: 30,
	rightAscension: '00 00 00.00',
	declination: '+00 00 00.00',
	radius: 0,
	visible: false,
	visibleAbove: 0,
	...DEFAULT_POSITION_OF_BODY,
	page: 1,
	limit: 4,
}

export const DEFAULT_SKY_OBJECT_SEARCH_ITEM: SkyObjectSearchItem = {
	id: 0,
	type: 0,
	constellation: 0,
	magnitude: 0,
	name: '',
}

const SKY_OBJECT_TYPE_NAMES = [
	'Unknown',
	'Galaxy',
	'Active Galaxy',
	'Radio Galaxy',
	'Interacting Galaxy',
	'Quasar',
	'Star Cluster',
	'Open Star Cluster',
	'Globular Star Cluster',
	'Stellar Association',
	'Star Cloud',
	'Nebula',
	'Planetary Nebula',
	'Dark Nebula',
	'Reflection Nebula',
	'Bipolar Nebula',
	'Emission Nebula',
	'Cluster Associated With Nebulosity',
	'HII Region',
	'Supernova Remnant',
	'Interstellar Matter',
	'Emission Object',
	'Bl Lacertae Object',
	'Blazar',
	'Molecular Cloud',
	'Young Stellar Object',
	'Possible Quasar',
	'Possible Planetary Nebula',
	'Protoplanetary Nebula',
	'Star',
	'Symbiotic Star',
	'Emission Line Star',
	'Supernova Candidate',
	'Super Nova Remnant Candidate',
	'Cluster of Galaxies',
	'Part of Galaxy',
	'Region of the Sky',
] as const

// Formats the type of a sky object based on its type code
export function skyObjectType(type: StellariumObjectType) {
	return SKY_OBJECT_TYPE_NAMES[type] ?? 'Unknown'
}

export const SKY_OBJECT_NAME_TYPES = [
	['NAME'],
	['NGC'],
	['IC'],
	['BAYER'],
	['FLAMSTEED'],
	['HD'],
	['HR'],
	['HIP'],
	['MESSIER', 'M '],
	['CALDWELL', 'C '],
	['BARNARD', 'B '],
	['SHARPLESS', 'SH 2-'],
	['LBN'],
	['LDN'],
	['MELOTTE', 'Mel '],
	['COLLINDER', 'Cr '],
	['ARP', 'Arp '],
	['ABELL', 'Abell '],
	['PGC'],
	['TRUMPLER', 'Tr '],
	['STOCK', 'St '],
	['RUPRECHT', 'Ru '],
	['UGC'],
	['CED'],
	['RCW'],
	['VDB'],
	['VV'],
	['PK'],
	['PNG'],
	['ACO'],
	['ESO'],
	['SNRG'],
	['DWB'],
	['BENNETT', 'Bennett '],
	['DUNLOP', 'Dunlop '],
	['HERSHEL', 'Hershel '],
	['GUM', 'Gum '],
	['BOCHUM', 'Bochum '],
	['ALESSI', 'Alessi '],
	['ALICANTE', 'Alicante '],
	['ALTER', 'Alter '],
	['ANTALOVA', 'Antalova '],
	['APRIAMASWILI', 'Apriamaswili '],
	['ARP (CL)', 'Arp '],
	['BARHATOVA', 'Barhatova '],
	['BASEL', 'Basel '],
	['BERKELEY', 'Berkeley '],
	['BICA', 'Bica '],
	['BIURAKAN', 'Biurakan '],
	['BLANCO', 'Blanco '],
	['CHUPINA', 'Chupina '],
	['CZERNIK', 'Czernik '],
	['DANKS', 'Danks '],
	['DIAS', 'Dias '],
	['DJORG', 'Djorg '],
	['DOLIDZE-DZIM', 'Dolidze-Dzim '],
	['DOLIDZE', 'Dolidze '],
	['DUFAY', 'Dufay '],
	['FEINSTEIN', 'Feinstein '],
	['FERRERO', 'Ferrero '],
	['GRAFF', 'Graff '],
	['GULLIVER', 'Gulliver '],
	['HAFFNER', 'Haffner '],
	['HARVARD', 'Harvard '],
	['HAUTE-PROVENCE', 'Haute-Provence '],
	['HOGG', 'Hogg '],
	['ISKURZDAJAN', 'Iskurzdajan '],
	['JOHANSSON', 'Johansson '],
	['KHARCHENKO', 'Kharchenko '],
	['KING', 'King '],
	['KRON', 'Kron '],
	['LINDSAY', 'Lindsay '],
	['LODEN', 'Loden '],
	['LYNGA', 'Lynga '],
	['MAMAJEK', 'Mamajek '],
	['MOFFAT', 'Moffat '],
	['MRK', 'Mrk '],
	['PAL', 'Pal '],
	['PISMIS', 'Pismis '],
	['PLATAIS', 'Platais '],
	['ROSLUND', 'Roslund '],
	['SAURER', 'Saurer '],
	['SHER', 'Sher '],
	['SKIFF', 'Skiff '],
	['STEPHENSON', 'Stephenson '],
	['TERZAN', 'Terzan '],
	['TOMBAUGH', 'Tombaugh '],
	['TURNER', 'Turner '],
	['UPGREN', 'Upgren '],
	['WATERLOO', 'Waterloo '],
	['WESTERLUND', 'Westerlund '],
	['ZWICKY', 'Zwicky '],
] as const

// Formats the name of a sky object based on its catalog ID and constellation
export function skyObjectName(id: string | undefined | null, constellation: Constellation | number) {
	if (!id) return undefined

	const index = id.indexOf(':')

	if (index === -1) return id

	const catalog = +id.slice(0, index)
	const name = id.slice(index + 1)

	if (catalog === 0) return name
	if (catalog === 3 || catalog === 4) return `${name} ${CONSTELLATIONS[typeof constellation === 'number' ? CONSTELLATION_LIST[constellation] : constellation].iau}`
	const [type, prefix] = SKY_OBJECT_NAME_TYPES[catalog]
	return `${prefix ?? type + ' '}${name}`
}
