import { CONSTELLATION_LIST, CONSTELLATIONS, type Constellation } from 'nebulosa/src/constellation'
import { type MultiSelectProps, MultiSelect } from './components/MultiSelect'

export type ConstellationSelectProps = Omit<MultiSelectProps<Constellation>, 'children' | 'items'>

function ConstellationItem(c: Constellation) {
	return <span>{CONSTELLATIONS[c].name}</span>
}

export function ConstellationSelect({ label = 'Constellation', ...props }: ConstellationSelectProps) {
	return (
		<MultiSelect clearable label={label} items={CONSTELLATION_LIST} {...props}>
			{ConstellationItem}
		</MultiSelect>
	)
}
