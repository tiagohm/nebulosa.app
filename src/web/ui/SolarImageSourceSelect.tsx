import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import { SOLAR_IMAGE_SOURCES } from 'src/types/sun'
import type { SolarImageSource } from 'src/types/sun'

const LABELS = ['AIA 193 Å', 'AIA 304 Å', 'AIA 171 Å', 'AIA 211 Å', 'AIA 131 Å', 'AIA 335 Å', 'AIA 094 Å', 'AIA 1600 Å', 'AIA 1700 Å', 'AIA 171 Å & HMIB', 'HMI Magnetogram', 'HMI Colorized Magnetogram', 'HMI Intensitygram', 'HMI Intensitygram Colored', 'HMI Intensitygram Flattened', 'HMI Dopplergram'] as const

function SolarImageSourceItem(item: SolarImageSource, i: number) {
	return <span>{LABELS[i]}</span>
}

export type SolarImageSourceSelectProps = Omit<SelectProps<SolarImageSource>, 'children' | 'items'>

export function SolarImageSourceSelect({ ...props }: SolarImageSourceSelectProps) {
	return (
		<Select items={SOLAR_IMAGE_SOURCES} {...props}>
			{SolarImageSourceItem}
		</Select>
	)
}
