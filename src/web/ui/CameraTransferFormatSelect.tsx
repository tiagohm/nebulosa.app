import type { CameraTransferFormat } from 'nebulosa/src/indi.device'
import { Select, type SelectProps } from './components/Select'

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
