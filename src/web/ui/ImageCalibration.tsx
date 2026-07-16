import { ImageViewerStoreContext } from '@shared/context'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { FilePickerInput } from '@ui/FilePickerInput'
import { Icons } from '@ui/Icon'
import { memo, useContext, useEffect } from 'react'
import type { ImageCalibrationFile, ImageCalibrationFileType } from 'src/shared/types'
import { useSnapshot } from 'valtio'

export const ImageCalibration = memo(() => {
	const { calibration } = useContext(ImageViewerStoreContext)
	const { enabled } = useSnapshot(calibration.state.calibration)

	useEffect(calibration.mount, [])

	return (
		<div className="grid grid-cols-12 gap-2 p-3">
			<Checkbox className="col-span-full" label="Enabled" onValueChange={(value) => (calibration.state.calibration.enabled = value)} value={enabled} />
			<CalibrationFile calibrationEnabled={enabled} type="dark" />
			<CalibrationFile calibrationEnabled={enabled} type="flat" />
			<CalibrationFile calibrationEnabled={enabled} type="bias" />
			<CalibrationFile calibrationEnabled={enabled} type="darkFlat" />
			<Footer />
		</div>
	)
})

interface CalibrationFileProps {
	readonly calibrationEnabled: boolean
	readonly type: ImageCalibrationFileType
}

const CalibrationFile = memo(({ calibrationEnabled, type }: CalibrationFileProps) => {
	const { calibration } = useContext(ImageViewerStoreContext)
	const { enabled, path } = useSnapshot(calibration.state.calibration[type])
	const placeholder = type === 'dark' ? 'Dark' : type === 'flat' ? 'Flat' : type === 'bias' ? 'Bias' : 'Dark Flat'

	return (
		<div className="col-span-full flex min-w-0 flex-row gap-2">
			<Checkbox disabled={!calibrationEnabled} onValueChange={(value) => calibration.update(type, 'enabled', value)} value={enabled} />
			<FilePickerInput fullWidth disabled={!calibrationEnabled || !enabled} filter="*.{fits,fit,xisf}" id={`calibration-${calibration.viewer.image.id}-${type}`} onValueChange={(value) => calibration.update(type, 'path', value)} placeholder={placeholder} value={path} />
		</div>
	)
})

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
