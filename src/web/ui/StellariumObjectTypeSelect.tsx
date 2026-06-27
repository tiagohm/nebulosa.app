import type { StellariumObjectType } from 'nebulosa/src/devices/protocols/stellarium'
import { MultiSelect, type MultiSelectProps } from './components/MultiSelect'

const ITEMS: readonly StellariumObjectType[] = [29, 6, 7, 8, 11, 12, 13, 14, 15, 16, 18, 10, 1, 2, 3, 4, 5, 9, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 32, 33, 34, 35, 36] as const
// oxfmt-ignore
const LABELS = ['Unknown', 'Galaxy', 'Active Galaxy', 'Radio Galaxy', 'Interacting Galaxy', 'Quasar', 'Star Cluster', 'Open Star Cluster', 'Globular Star Cluster', 'Stellar Association', 'Star Cloud', 'Nebula', 'Planetary Nebula', 'Dark Nebula', 'Reflection Nebula', 'Bipolar Nebula', 'Emission Nebula', 'Cluster Associated with Nebulosity', 'HII Region', 'Supernova Remnant', 'Interstellar Matter', 'Emission Object', 'BL Lacertae Object', 'Blazar', 'Molecular Cloud', 'Young Stellar Object', 'Possible Quasar', 'Possible Planetary Nebula', 'Protoplanetary Nebula', 'Star', 'Symbiotic Star', 'Emission Line Star', 'Supernova Candidate', 'Super Nova Remnant Candidate', 'Cluster of Galaxies', 'Part of Galaxy', 'Region of the Sky'] as const

export type StellariumObjectTypeSelectProps = Omit<MultiSelectProps<StellariumObjectType>, 'children' | 'items'>

function StellariumObjectTypeItem(item: StellariumObjectType) {
	return <span>{LABELS[item]}</span>
}

export function StellariumObjectTypeSelect({ label = 'Type', ...props }: StellariumObjectTypeSelectProps) {
	return (
		<MultiSelect clearable label={label} items={ITEMS} {...props}>
			{StellariumObjectTypeItem}
		</MultiSelect>
	)
}
