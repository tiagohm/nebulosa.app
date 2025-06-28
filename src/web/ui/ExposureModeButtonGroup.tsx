import { Button, ButtonGroup, type ButtonGroupProps, type ButtonProps } from '@heroui/react'
import type { ExposureMode } from 'src/api/types'

export interface ExposureModeButtonGroupProps extends ButtonGroupProps, Pick<ButtonProps, 'color'> {
	readonly variant?: Exclude<ButtonProps['variant'], 'solid'>
	readonly value: ExposureMode
	readonly onValueChange: (mode: ExposureMode) => void
}

export function ExposureModeButtonGroup({ value, onValueChange, color = 'primary', variant = 'light', ...props }: ExposureModeButtonGroupProps) {
	return (
		<ButtonGroup {...props}>
			<Button color={color} onPointerUp={() => onValueChange('SINGLE')} size='sm' variant={value === 'SINGLE' ? 'solid' : variant}>
				Single
			</Button>
			<Button color={color} onPointerUp={() => onValueChange('FIXED')} size='sm' variant={value === 'FIXED' ? 'solid' : variant}>
				Fixed
			</Button>
			<Button color={color} onPointerUp={() => onValueChange('LOOP')} size='sm' variant={value === 'LOOP' ? 'solid' : variant}>
				Loop
			</Button>
		</ButtonGroup>
	)
}
