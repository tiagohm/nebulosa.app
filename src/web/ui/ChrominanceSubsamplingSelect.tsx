import { SelectItem } from '@heroui/react'
import type { ChrominanceSubsampling } from 'nebulosa/src/jpeg'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export interface ChrominanceSubsamplingSelectProps extends Omit<EnumSelectProps<ChrominanceSubsampling>, 'children'> {}

export function ChrominanceSubsamplingSelect({ label = 'Chrominance Subsampling', ...props }: ChrominanceSubsamplingSelectProps) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='4:4:4'>4:4:4</SelectItem>
			<SelectItem key='4:2:2'>4:2:2</SelectItem>
			<SelectItem key='4:2:0'>4:2:0</SelectItem>
			<SelectItem key='GRAY'>Gray</SelectItem>
			<SelectItem key='4:4:0'>4:4:0</SelectItem>
			<SelectItem key='4:1:1'>4:1:1</SelectItem>
			<SelectItem key='4:4:1'>4:4:1</SelectItem>
		</EnumSelect>
	)
}
