import type { MountTargetCoordinateType } from 'nebulosa/src/indi.device'
import { tw } from '../shared/util'
import { Radio } from './components/Radio'

export interface MountTargetCoordinateTypeRadioGroupProps extends React.ComponentProps<'div'> {
	readonly value: MountTargetCoordinateType
	readonly onValueChange: (value: MountTargetCoordinateType) => void
}

export function MountTargetCoordinateTypeRadioGroup({ value, onValueChange, className, ...props }: MountTargetCoordinateTypeRadioGroupProps) {
	return (
		<div className={tw('flex items-start justify-center gap-1 flex-col', className)} {...props}>
			<Radio label='J2000' onValueChange={(value) => value && onValueChange('J2000')} value={value === 'J2000'} />
			<Radio label='JNOW' onValueChange={(value) => value && onValueChange('JNOW')} value={value === 'JNOW'} />
			<Radio label='HOR' onValueChange={(value) => value && onValueChange('ALTAZ')} value={value === 'ALTAZ'} />
			<Radio label='ECL' onValueChange={(value) => value && onValueChange('ECLIPTIC')} value={value === 'ECLIPTIC'} />
			<Radio label='GAL' onValueChange={(value) => value && onValueChange('GALACTIC')} value={value === 'GALACTIC'} />
		</div>
	)
}
