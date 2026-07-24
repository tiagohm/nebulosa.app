import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import { PLANET_TYPES } from 'src/types/planet'
import type { PlanetType } from 'src/types/planet'

const ITEMS = ['all', ...PLANET_TYPES] as const

const LABELS = [
	'All',
	'Planet',
	'Dwarf Planet',
	'Asteroid',
	'Comet',
	'Martian Satellite',
	'Jovian Regular Satellite',
	'Jovian Irregular Satellite',
	'Saturnian Regular Satellite',
	'Saturnian Inner Satellite',
	'Saturnian Irregular Satellite',
	'Uranian Regular Satellite',
	'Uranian Inner Satellite',
	'Uranian Irregular Satellite',
	'Neptunian Satellite',
	'Neptunian Irregular Satellite',
	'Pluto Satellite',
] as const

function PlanetTypeItem(item: PlanetType | 'all', i: number) {
	return <span>{LABELS[i]}</span>
}

export type PlanetTypeSelectProps = Omit<SelectProps<PlanetType | 'all'>, 'children' | 'items'>

export function PlanetTypeSelect({ label = 'Type', ...props }: PlanetTypeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{PlanetTypeItem}
		</Select>
	)
}
