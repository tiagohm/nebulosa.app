import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { ImageCalibrationFileType } from 'src/shared/types'
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
		<Modal footer={<Footer />} header='Calibration' id={`calibration-${calibration.viewer.storageKey}`} maxWidth='264px' onHide={calibration.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const calibration = useMolecule(ImageCalibrationMolecule)
	const { enabled } = useSnapshot(calibration.state.calibration)

	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Checkbox className='col-span-full' label='Enabled' onValueChange={(value) => (calibration.state.calibration.enabled = value)} value={enabled} />
			<CalibrationFile type='dark' />
			<CalibrationFile type='flat' />
			<CalibrationFile type='bias' />
			<CalibrationFile type='darkFlat' />
		</div>
	)
})

interface CalibrationFileProps {
	readonly type: ImageCalibrationFileType
}

const CalibrationFile = memo(({ type }: CalibrationFileProps) => {
	const calibration = useMolecule(ImageCalibrationMolecule)
	const { enabled, path } = useSnapshot(calibration.state.calibration[type])

	return (
		<div className='col-span-full flex flex-row gap-2'>
			<Checkbox onValueChange={(value) => calibration.update(type, 'enabled', value)} value={enabled} />
			<FilePickerInput id={`calibration-${calibration.viewer.storageKey}-${type}`} isDisabled={!enabled} onValueChange={(value) => calibration.update(type, 'path', value)} placeholder={type} value={path} />
		</div>
	)
})

const Footer = memo(() => {
	const calibration = useMolecule(ImageCalibrationMolecule)

	return <Button color='success' label='Apply' onPointerUp={calibration.apply} startContent={<Icons.Check />} />
})
