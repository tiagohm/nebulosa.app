import { SelectItem } from '@heroui/react'
import type { CfaPattern } from 'nebulosa/src/image.types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function CfaPatternSelect({ label = 'CFA Pattern', ...props }: Omit<EnumSelectProps<CfaPattern | 'AUTO'>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='AUTO'>Auto</SelectItem>
			<SelectItem key='RGGB'>RGGB</SelectItem>
			<SelectItem key='BGGR'>BGGR</SelectItem>
			<SelectItem key='GBRG'>GBRG</SelectItem>
			<SelectItem key='GRBG'>GRBG</SelectItem>
			<SelectItem key='GRGB'>GRGB</SelectItem>
			<SelectItem key='GBGR'>GBGR</SelectItem>
			<SelectItem key='RGBG'>RGBG</SelectItem>
			<SelectItem key='BGRG'>BGRG</SelectItem>
		</EnumSelect>
	)
}
