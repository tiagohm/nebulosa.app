import type { Camera, Cover, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Rotator, Thermometer, Wheel } from 'nebulosa/src/indi.device'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { Connect, ImageInfo } from 'src/shared/types'

export type FilePickerMode = 'file' | 'directory' | 'save'

export type ImageSource = 'file' | 'framing' | 'camera'

export type TargetCoordinateAction = 'GOTO' | 'SYNC' | 'FRAME'

export interface Connection extends Connect {
	id: string
	name: string
	connectedAt?: number
}

export interface Image {
	readonly key: string
	readonly position: number
	readonly path: string
	readonly source: ImageSource
	readonly camera?: Camera
}

export interface ImageLoaded {
	readonly image: Image
	readonly info: ImageInfo
	readonly newImage: boolean
}

export interface ImageSolved {
	readonly image: Image
	readonly solution: PlateSolution
}

export interface DeviceTypeMap {
	readonly CAMERA: Camera
	readonly MOUNT: Mount
	readonly WHEEL: Wheel
	readonly FOCUSER: Focuser
	readonly ROTATOR: Rotator
	readonly FLAT_PANEL: FlatPanel
	readonly COVER: Cover
	readonly THERMOMETER: Thermometer
	readonly GUIDE_OUTPUT: GuideOutput
	readonly DEW_HEATER: DewHeater
}

export const DEFAULT_CONNECTION: Connection = {
	id: '0',
	name: 'Local',
	host: 'localhost',
	port: 7624,
	type: 'INDI',
	secured: false,
}

export const SKY_OBJECT_NAME_TYPES = [
	'ALL',
	'NAME',
	'NGC',
	'IC',
	'BAYER', // greek letters
	'FLAMSTEED', // ordered numbers
	'HD',
	'HR',
	'HIP',
	'MESSIER',
	'CALDWELL',
	'BARNARD',
	'SHARPLESS',
	'LBN',
	'LDN',
	'MELOTTE',
	'COLLINDER',
	'ARP',
	'ABELL',
	'PGC',
	'TRUMPLER',
	'STOCK',
	'RUPRECHT',
	'UGC',
	'CED',
	'RCW',
	'VDB',
	'VV',
	'PK',
	'PNG',
	'ACO',
	'ESO',
	'SNRG',
	'DWB',
	'BENNETT',
	'DUNLOP',
	'HERSHEL',
	'GUM',
	'BOCHUM',
	'ALESSI',
	'ALICANTE',
	'ALTER',
	'ANTALOVA',
	'APRIAMASWILI',
	'ARP (CL)',
	'BARHATOVA',
	'BASEL',
	'BERKELEY',
	'BICA',
	'BIURAKAN',
	'BLANCO',
	'CHUPINA',
	'CZERNIK',
	'DANKS',
	'DIAS',
	'DJORG',
	'DOLIDZE-DZIM',
	'DOLIDZE',
	'DUFAY',
	'FEINSTEIN',
	'FERRERO',
	'GRAFF',
	'GULLIVER',
	'HAFFNER',
	'HARVARD',
	'HAUTE-PROVENCE',
	'HOGG',
	'ISKURZDAJAN',
	'JOHANSSON',
	'KHARCHENKO',
	'KING',
	'KRON',
	'LINDSAY',
	'LODEN',
	'LYNGA',
	'MAMAJEK',
	'MOFFAT',
	'MRK',
	'PAL',
	'PISMIS',
	'PLATAIS',
	'ROSLUND',
	'SAURER',
	'SHER',
	'SKIFF',
	'STEPHENSON',
	'TERZAN',
	'TOMBAUGH',
	'TURNER',
	'UPGREN',
	'WATERLOO',
	'WESTERLUND',
	'ZWICKY',
] as const
