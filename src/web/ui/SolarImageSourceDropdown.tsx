import { type ButtonProps, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import type { SolarImageSource } from 'src/shared/types'
import { TextButton } from './TextButton'

export interface SolarImageSourceDropdownProps extends Omit<ButtonProps, 'isIconOnly' | 'value'> {
	readonly value: SolarImageSource
	readonly onValueChange: (value: SolarImageSource) => void
}

const DROPDOWN_ITEM_LABEL: Record<SolarImageSource, string> = {
	AIA_193: 'AIA 193 Å',
	AIA_304: 'AIA 304 Å',
	AIA_171: 'AIA 171 Å',
	AIA_211: 'AIA 211 Å',
	AIA_131: 'AIA 131 Å',
	AIA_335: 'AIA 335 Å',
	AIA_094: 'AIA 094 Å',
	AIA_1600: 'AIA 1600 Å',
	AIA_1700: 'AIA 1700 Å',
	AIA_171_HMIB: 'AIA 171 Å & HMIB',
	HMI_MAGNETOGRAM: 'HMI Magnetogram',
	HMI_COLORIZED_MAGNETOGRAM: 'HMI Colorized Magnetogram',
	HMI_INTENSITYGRAM_COLORED: 'HMI Intensitygram Colored',
	HMI_INTENSITYGRAM_FLATTENED: 'HMI Intensitygram Flattened',
	HMI_INTENSITYGRAM: 'HMI Intensitygram',
	HMI_DOPPLERGRAM: 'HMI Dopplergram',
}

export function SolarImageSourceDropdown({ value, onValueChange, size = 'sm', variant = 'light', ...props }: SolarImageSourceDropdownProps) {
	return (
		<Dropdown shouldCloseOnBlur={false} showArrow>
			<DropdownTrigger>
				<TextButton label={DROPDOWN_ITEM_LABEL[value]} {...props} size={size} variant={variant} />
			</DropdownTrigger>
			<DropdownMenu className='max-h-60 overflow-auto no-scrollbar' onAction={(key) => onValueChange(key as SolarImageSource)} selectedKeys={new Set([value])} selectionMode='single'>
				{Object.entries(DROPDOWN_ITEM_LABEL).map(([key, label]) => (
					<DropdownItem key={key}>{label}</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	)
}
