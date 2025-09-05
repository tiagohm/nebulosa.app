import { ButtonGroup, type ButtonGroupProps, type ButtonProps } from '@heroui/react'
import type { ExposureMode } from 'src/shared/types'
import { TextButton } from './TextButton'

export interface ExposureModeButtonGroupProps extends ButtonGroupProps, Pick<ButtonProps, 'color'> {
	readonly variant?: Exclude<ButtonProps['variant'], 'solid'>
	readonly value: ExposureMode
	readonly onValueChange: (mode: ExposureMode) => void
}

export function ExposureModeButtonGroup({ value, onValueChange, color = 'primary', variant = 'light', ...props }: ExposureModeButtonGroupProps) {
	return (
		<ButtonGroup {...props}>
			<TextButton color={color} label='Single' onPointerUp={() => onValueChange('SINGLE')} size='sm' variant={value === 'SINGLE' ? 'solid' : variant} />
			<TextButton color={color} label='Fixed' onPointerUp={() => onValueChange('FIXED')} size='sm' variant={value === 'FIXED' ? 'solid' : variant} />
			<TextButton color={color} label='Loop' onPointerUp={() => onValueChange('LOOP')} size='sm' variant={value === 'LOOP' ? 'solid' : variant} />
		</ButtonGroup>
	)
}
