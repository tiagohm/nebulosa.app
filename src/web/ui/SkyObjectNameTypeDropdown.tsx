import { Button, type ButtonProps, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'

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

export interface SkyObjectNameTypeDropdownProps extends Omit<ButtonProps, 'isIconOnly' | 'value'> {
	readonly value: number
	readonly onValueChange: (value: number) => void
}

export function SkyObjectNameTypeDropdown({ value, onValueChange, size = 'sm', variant = 'light', ...props }: SkyObjectNameTypeDropdownProps) {
	return (
		<Dropdown showArrow>
			<DropdownTrigger>
				<Button {...props} size={size} variant={variant}>
					{SKY_OBJECT_NAME_TYPES[value + 1]}
				</Button>
			</DropdownTrigger>
			<DropdownMenu className='max-h-60 overflow-auto no-scrollbar' onAction={(key) => onValueChange(+key)} selectedKeys={new Set([`${value}`])} selectionMode='single'>
				{SKY_OBJECT_NAME_TYPES.map((name, i) => (
					<DropdownItem key={i - 1}>{name}</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	)
}
