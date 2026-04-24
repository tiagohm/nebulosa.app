import type { MountTargetCoordinateType } from 'nebulosa/src/indi.device'
import { tw } from '../shared/util'
import { Radio } from './components/Radio'

export interface MountTargetCoordinateTypeRadioGroupProps extends React.ComponentProps<'div'> {
	readonly value: MountTargetCoordinateType
	readonly onValueChange: (value: MountTargetCoordinateType) => void
	readonly disabled?: boolean
}

export function MountTargetCoordinateTypeRadioGroup({ value, onValueChange, disabled, className, ...props }: MountTargetCoordinateTypeRadioGroupProps) {
	return (
		<div className={tw('flex items-start justify-center gap-1 flex-col', className)} {...props}>
			<Radio disabled={disabled} label="J2000" onValueChange={(value) => value && onValueChange('J2000')} value={value === 'J2000'} />
			<Radio disabled={disabled} label="JNOW" onValueChange={(value) => value && onValueChange('JNOW')} value={value === 'JNOW'} />
			<Radio disabled={disabled} label="HOR" onValueChange={(value) => value && onValueChange('ALTAZ')} value={value === 'ALTAZ'} />
			<Radio disabled={disabled} label="ECL" onValueChange={(value) => value && onValueChange('ECLIPTIC')} value={value === 'ECLIPTIC'} />
			<Radio disabled={disabled} label="GAL" onValueChange={(value) => value && onValueChange('GALACTIC')} value={value === 'GALACTIC'} />
		</div>
	)
}
