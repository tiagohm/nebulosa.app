import { ButtonGroup, type ButtonGroupProps } from '@heroui/react'
import type { ExposureMode } from 'src/shared/types'
import { Button, type ButtonProps } from './components/Button'

export interface ExposureModeButtonGroupProps extends Omit<ButtonGroupProps, 'color' | 'variant'>, Pick<ButtonProps, 'color'> {
	readonly variant?: Exclude<ButtonProps['variant'], 'solid'>
	readonly value: ExposureMode
	readonly onValueChange: (mode: ExposureMode) => void
}

export function ExposureModeButtonGroup({ value, onValueChange, color = 'primary', variant = 'ghost', ...props }: ExposureModeButtonGroupProps) {
	return (
		<ButtonGroup {...props}>
			<Button color={color} label='Single' onPointerUp={() => onValueChange('SINGLE')} size='sm' variant={value === 'SINGLE' ? 'solid' : variant} />
			<Button color={color} label='Fixed' onPointerUp={() => onValueChange('FIXED')} size='sm' variant={value === 'FIXED' ? 'solid' : variant} />
			<Button color={color} label='Loop' onPointerUp={() => onValueChange('LOOP')} size='sm' variant={value === 'LOOP' ? 'solid' : variant} />
		</ButtonGroup>
	)
}
