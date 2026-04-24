import type { PlanetType } from 'src/shared/types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = [
	'ALL',
	'PLANET',
	'DWARF_PLANET',
	'ASTEROID',
	'COMET',
	'MARTIAN_SATELLITE',
	'JOVIAN_REGULAR_SATELLITE',
	'JOVIAN_IRREGULAR_SATELLITE',
	'SATURNIAN_REGULAR_SATELLITE',
	'SATURNIAN_INNER_SATELLITE',
	'SATURNIAN_IRREGULAR_SATELLITE',
	'URANIAN_REGULAR_SATELLITE',
	'URANIAN_INNER_SATELLITE',
	'URANIAN_IRREGULAR_SATELLITE',
	'NEPTUNIAN_SATELLITE',
	'NEPTUNIAN_IRREGULAR_SATELLITE',
	'PLUTO_SATELLITE',
] as const

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

const PlanetTypeItem: SelectItemRenderer<PlanetType | 'ALL'> = (_, i) => <span>{LABELS[i]}</span>

export type PlanetTypeSelectProps = Omit<SelectProps<PlanetType | 'ALL'>, 'children' | 'items'>

export function PlanetTypeSelect({ label = 'Type', ...props }: PlanetTypeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{PlanetTypeItem}
		</Select>
	)
}
