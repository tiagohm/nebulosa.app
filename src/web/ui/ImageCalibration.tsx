import { ImageViewerStoreContext } from '@shared/context'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { FilePickerInput } from '@ui/FilePickerInput'
import { Icons } from '@ui/Icon'
import { memo, useContext, useEffect } from 'react'
import type { ImageCalibrationFile } from 'src/shared/types'
import { useSnapshot } from 'valtio'

export const ImageCalibration = memo(() => {
	const { calibration } = useContext(ImageViewerStoreContext)
	const { enabled, dark, flat, bias, darkFlat } = useSnapshot(calibration.state.calibration)

	useEffect(calibration.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Checkbox className="col-span-full" label="Enabled" onValueChange={(value) => (calibration.state.calibration.enabled = value)} value={enabled} />
			<CalibrationFile label="Dark" disabled={enabled} onEnabledChange={calibration.setDarkEnabled} onPathChange={calibration.setDarkPath} enabled={dark.enabled} path={dark.path} />
			<CalibrationFile label="Flat" disabled={enabled} onEnabledChange={calibration.setFlatEnabled} onPathChange={calibration.setFlatPath} enabled={flat.enabled} path={flat.path} />
			<CalibrationFile label="Bias" disabled={enabled} onEnabledChange={calibration.setBiasEnabled} onPathChange={calibration.setBiasPath} enabled={bias.enabled} path={bias.path} />
			<CalibrationFile label="Dark Flat" disabled={enabled} onEnabledChange={calibration.setDarkFlatEnabled} onPathChange={calibration.setDarkFlatPath} enabled={darkFlat.enabled} path={darkFlat.path} />
			<Footer />
		</div>
	)
})

interface CalibrationFileProps {
	readonly label: string
	readonly disabled: boolean
	readonly enabled: boolean
	readonly path?: string
	readonly onEnabledChange: (value: boolean) => void
	readonly onPathChange: (path?: string) => void
}

function CalibrationFile({ disabled, label, enabled, path, onEnabledChange, onPathChange }: CalibrationFileProps) {
	return (
		<div className="col-span-full flex min-w-0 flex-row gap-2">
			<Checkbox disabled={disabled} onValueChange={onEnabledChange} value={enabled} />
			<FilePickerInput fullWidth disabled={disabled} filter="*.{fits,fit,xisf}" onValueChange={onPathChange} placeholder={label} value={path} />
		</div>
	)
}

const Footer = memo(() => {
	const { calibration } = useContext(ImageViewerStoreContext)
	const { enabled, dark, flat, bias, darkFlat } = useSnapshot(calibration.state.calibration)
	const canApply = !enabled || hasEnabledCalibrationFile(dark) || hasEnabledCalibrationFile(flat) || hasEnabledCalibrationFile(bias) || hasEnabledCalibrationFile(darkFlat)

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="success" disabled={!canApply} label="Apply" onClick={calibration.apply} startContent={<Icons.Check />} />
		</div>
	)
})

function hasEnabledCalibrationFile(file: ImageCalibrationFile) {
	return file.enabled && file.path !== undefined && file.path.trim().length > 0
}
