import { SelectItem } from '@heroui/react'
import type { CameraTransferFormat } from 'nebulosa/src/indi.device'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function CameraTransferFormatSelect({ label = 'Transfer Format', ...props }: Omit<EnumSelectProps<CameraTransferFormat>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='FITS'>FITS</SelectItem>
			<SelectItem key='XISF'>XISF</SelectItem>
		</EnumSelect>
	)
}
