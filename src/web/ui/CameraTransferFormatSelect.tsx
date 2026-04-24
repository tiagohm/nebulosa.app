import type { CameraTransferFormat } from 'nebulosa/src/indi.device'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['FITS', 'XISF'] as const
const LABELS = ['FITS', 'XISF'] as const

const CameraTransferFormatItem: SelectItemRenderer<CameraTransferFormat> = (_, i) => <span>{LABELS[i]}</span>

export type CameraTransferFormatSelectProps = Omit<SelectProps<CameraTransferFormat>, 'children' | 'items'>

export function CameraTransferFormatSelect({ label = 'Transfer Format', ...props }: CameraTransferFormatSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{CameraTransferFormatItem}
		</Select>
	)
}
