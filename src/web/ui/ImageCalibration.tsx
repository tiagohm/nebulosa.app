import { Checkbox } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo, useCallback } from 'react'
import type { ImageCalibrationFileType } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { ImageCalibrationMolecule } from '@/molecules/image/calibration'
import { FilePickerInput } from './FilePickerInput'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

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
			<Checkbox className='col-span-full' isSelected={enabled} onValueChange={(value) => (calibration.state.calibration.enabled = value)}>
				Enabled
			</Checkbox>
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

	const updatePath = useCallback((value?: string) => calibration.update(type, 'path', value), [type])

	return (
		<div className='col-span-full flex flex-row gap-2'>
			<Checkbox isSelected={enabled} onValueChange={(value) => calibration.update(type, 'enabled', value)} />
			<FilePickerInput id={`calibration-${calibration.viewer.storageKey}-${type}`} isDisabled={!enabled} onValueChange={updatePath} placeholder={type} value={path} />
		</div>
	)
})

const Footer = memo(() => {
	const calibration = useMolecule(ImageCalibrationMolecule)

	return <TextButton color='success' label='Apply' onPointerUp={calibration.apply} startContent={<Icons.Check />} />
})
