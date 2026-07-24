import { MultiSelect } from '@ui/components/MultiSelect'
import type { MultiSelectProps } from '@ui/components/MultiSelect'
import { CONSTELLATION_LIST, CONSTELLATIONS } from 'nebulosa/src/astronomy/coordinates/constellation'
import type { Constellation } from 'nebulosa/src/astronomy/coordinates/constellation'

export type ConstellationSelectProps = Omit<MultiSelectProps<Constellation>, 'children' | 'items'>

function ConstellationItem(item: Constellation) {
	return <span>{CONSTELLATIONS[item].name}</span>
}

export function ConstellationSelect({ label = 'Constellation', ...props }: ConstellationSelectProps) {
	return (
		<MultiSelect clearable label={label} items={CONSTELLATION_LIST} {...props}>
			{ConstellationItem}
		</MultiSelect>
	)
}
