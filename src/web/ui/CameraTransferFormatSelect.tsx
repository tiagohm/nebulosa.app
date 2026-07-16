import { Select, type SelectProps } from '@ui/components/Select'
import type { CameraTransferFormat } from 'nebulosa/src/devices/indi/device'

const ITEMS = ['FITS', 'XISF'] as const
const LABELS = ['FITS', 'XISF'] as const

function CameraTransferFormatItem(item: CameraTransferFormat, i: number) {
	return <span>{LABELS[i]}</span>
}

export type CameraTransferFormatSelectProps = Omit<SelectProps<CameraTransferFormat>, 'children' | 'items'>

export function CameraTransferFormatSelect({ label = 'Transfer Format', ...props }: CameraTransferFormatSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{CameraTransferFormatItem}
		</Select>
	)
}
