import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { ImageCalibrationFile, ImageCalibrationFileType } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { ImageCalibrationMolecule } from '@/molecules/image/calibration'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { FilePickerInput } from './FilePickerInput'
import { Icons } from './Icon'
import { Modal } from './Modal'

export const ImageCalibration = memo(() => {
	const calibration = useMolecule(ImageCalibrationMolecule)

	return (
		<Modal footer={<Footer />} header="Calibration" id={`calibration-${calibration.viewer.storageKey}`} maxWidth="264px" onHide={calibration.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const calibration = useMolecule(ImageCalibrationMolecule)
	const { enabled } = useSnapshot(calibration.state.calibration)

	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<Checkbox className="col-span-full" label="Enabled" onValueChange={(value) => (calibration.state.calibration.enabled = value)} value={enabled} />
			<CalibrationFile calibrationEnabled={enabled} type="dark" />
			<CalibrationFile calibrationEnabled={enabled} type="flat" />
			<CalibrationFile calibrationEnabled={enabled} type="bias" />
			<CalibrationFile calibrationEnabled={enabled} type="darkFlat" />
		</div>
	)
})

interface CalibrationFileProps {
	readonly calibrationEnabled: boolean
	readonly type: ImageCalibrationFileType
}

const CalibrationFile = memo(({ calibrationEnabled, type }: CalibrationFileProps) => {
	const calibration = useMolecule(ImageCalibrationMolecule)
	const { enabled, path } = useSnapshot(calibration.state.calibration[type])

	return (
		<div className="col-span-full flex min-w-0 flex-row gap-2">
			<Checkbox disabled={!calibrationEnabled} onValueChange={(value) => calibration.update(type, 'enabled', value)} value={enabled} />
			<FilePickerInput disabled={!calibrationEnabled || !enabled} filter="*.{fits,fit,xisf}" id={`calibration-${calibration.viewer.storageKey}-${type}`} onValueChange={(value) => calibration.update(type, 'path', value)} placeholder={CALIBRATION_FILE_LABELS[type]} value={path} />
		</div>
	)
})

const Footer = memo(() => {
	const calibration = useMolecule(ImageCalibrationMolecule)
	const { enabled, dark, flat, bias, darkFlat } = useSnapshot(calibration.state.calibration)
	const canApply = !enabled || hasEnabledCalibrationFile(dark) || hasEnabledCalibrationFile(flat) || hasEnabledCalibrationFile(bias) || hasEnabledCalibrationFile(darkFlat)

	return <Button color="success" disabled={!canApply} label="Apply" onClick={calibration.apply} startContent={<Icons.Check />} />
})

const CALIBRATION_FILE_LABELS = {
	dark: 'Dark',
	flat: 'Flat',
	bias: 'Bias',
	darkFlat: 'Dark Flat',
} satisfies Record<ImageCalibrationFileType, string>

function hasEnabledCalibrationFile(file: ImageCalibrationFile) {
	return file.enabled && file.path !== undefined && file.path.trim().length > 0
}
