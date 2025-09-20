import { SelectItem } from '@heroui/react'
import type { StellariumObjectType } from 'nebulosa/src/stellarium'
import { EnumMultipleSelect, type EnumMultipleSelectProps } from './EnumMultipleSelect'

const TYPES: readonly [StellariumObjectType, string, string][] = [
	[29, 'Star', 'S'],
	[6, 'Star Cluster', 'SC'],
	[7, 'Open Star Cluster', 'OC'],
	[8, 'Globular Star Cluster', 'GC'],
	[11, 'Nebula', 'N'],
	[12, 'Planetary Nebula', 'PN'],
	[13, 'Dark Nebula', 'DN'],
	[14, 'Reflection Nebula', 'RN'],
	[15, 'Bipolar Nebula', 'BN'],
	[16, 'Emission Nebula', 'EN'],
	[18, 'HII Region', 'HII'],
	[10, 'Star Cloud', 'SCL'],
	[1, 'Galaxy', 'G'],
	[2, 'Active Galaxy', 'AG'],
	[3, 'Radio Galaxy', 'RG'],
	[4, 'Interacting Galaxy', 'IG'],
	[5, 'Quasar', 'Q'],
	[9, 'Stellar Association', 'SA'],
	[17, 'Cluster Associated with Nebulosity', 'CAN'],
	[19, 'Supernova Remnant', 'SNR'],
	[20, 'Interstellar Matter', 'ISM'],
	[21, 'Emission Object', 'EO'],
	[22, 'BL Lacertae Object', 'BL'],
	[23, 'Blazar', 'BLZ'],
	[24, 'Molecular Cloud', 'MCL'],
	[25, 'Young Stellar Object', 'YSO'],
	[26, 'Possible Quasar', 'PQ'],
	[27, 'Possible Planetary Nebula', 'PPN'],
	[28, 'Protoplanetary Nebula', 'PPN'],
	[32, 'Supernova Candidate', 'SNC'],
	[33, 'Super Nova Remnant Candidate', 'SNRC'],
	[34, 'Cluster of Galaxies', 'CG'],
	[35, 'Part of Galaxy', 'PG'],
	[36, 'Region of the Sky', 'RS'],
]

export interface StellariumObjectTypeSelectProps extends Omit<EnumMultipleSelectProps, 'children' | 'value' | 'onValueChange'> {
	readonly value: readonly StellariumObjectType[]
	readonly onValueChange: (value: StellariumObjectType[]) => void
}

export function StellariumObjectTypeSelect({ label = 'Type', value, onValueChange, ...props }: StellariumObjectTypeSelectProps) {
	return (
		<EnumMultipleSelect
			{...props}
			classNames={{ trigger: '!min-h-[48.75px]' }}
			isClearable
			label={label}
			onValueChange={(value) => onValueChange(value.map((e) => +e))}
			placeholder='All'
			renderValue={(items) => {
				return <div className='mt-2 flex flex-nowrap gap-2'>{items.map((item) => TYPES.find((e) => e[0] === +(item.key as never))![2]).join(', ')}</div>
			}}
			value={value.map((e) => e.toFixed(0))}>
			{TYPES.map(([key, name]) => (
				<SelectItem key={key}>{name}</SelectItem>
			))}
		</EnumMultipleSelect>
	)
}
