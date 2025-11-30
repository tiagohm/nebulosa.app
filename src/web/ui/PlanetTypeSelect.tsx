import { SelectItem } from '@heroui/react'
import type { PlanetType } from 'src/shared/types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function PlanetTypeSelect({ label = 'Type', ...props }: Omit<EnumSelectProps<PlanetType | 'ALL'>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='ALL'>All</SelectItem>
			<SelectItem key='PLANET'>Planet</SelectItem>
			<SelectItem key='DWARF_PLANET'>Dwarf Planet</SelectItem>
			<SelectItem key='ASTEROID'>Asteroid</SelectItem>
			<SelectItem key='COMET'>Comet</SelectItem>
			<SelectItem key='MARTIAN_SATELLITE'>Martian Satellite</SelectItem>
			<SelectItem key='JOVIAN_REGULAR_SATELLITE'>Jovian Regular Satellite</SelectItem>
			<SelectItem key='JOVIAN_IRREGULAR_SATELLITE'>Jovian Irregular Satellite</SelectItem>
			<SelectItem key='SATURNIAN_REGULAR_SATELLITE'>Saturnian Regular Satellite</SelectItem>
			<SelectItem key='SATURNIAN_INNER_SATELLITE'>Saturnian Inner Satellite</SelectItem>
			<SelectItem key='SATURNIAN_IRREGULAR_SATELLITE'>Saturnian Irregular Satellite</SelectItem>
			<SelectItem key='URANIAN_REGULAR_SATELLITE'>Uranian Regular Satellite</SelectItem>
			<SelectItem key='URANIAN_INNER_SATELLITE'>Uranian Inner Satellite</SelectItem>
			<SelectItem key='URANIAN_IRREGULAR_SATELLITE'>Uranian Irregular Satellite</SelectItem>
			<SelectItem key='NEPTUNIAN_SATELLITE'>Neptunian Satellite</SelectItem>
			<SelectItem key='NEPTUNIAN_IRREGULAR_SATELLITE'>Neptunian Irregular Satellite</SelectItem>
			<SelectItem key='PLUTO_SATELLITE'>Pluto Satellite</SelectItem>
		</EnumSelect>
	)
}
