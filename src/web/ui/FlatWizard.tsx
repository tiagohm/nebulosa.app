import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { FlatWizardState } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { FlatWizardMolecule } from '@/molecules/flatwizard'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { Button } from './components/Button'
import { Chip, type ChipProps } from './components/Chip'
import { NumberInput } from './components/NumberInput'
import { CameraDropdown } from './DeviceDropdown'
import { FilePickerInput } from './FilePickerInput'
import { Icons } from './Icon'
import { Modal } from './Modal'

const MEAN_MAX_VALUE = 65535

const FLAT_WIZARD_STATE_LABELS = {
	IDLE: 'idle',
	CAPTURING: 'capturing',
	COMPUTING: 'computing',
} satisfies Record<FlatWizardState, string>

const FLAT_WIZARD_STATE_COLORS = {
	IDLE: 'default',
	CAPTURING: 'primary',
	COMPUTING: 'warning',
} satisfies Record<FlatWizardState, NonNullable<ChipProps['color']>>

export const FlatWizard = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)

	return (
		<Modal footer={<Footer />} header="Flat Wizard" id="flatwizard" maxWidth="376px" onHide={flatWizard.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<Devices />
		<Status />
		<Input />
	</div>
))

const Devices = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)
	const { running, camera } = useSnapshot(flatWizard.state)

	return (
		<div className="col-span-full flex flex-row items-center justify-center gap-2">
			<CameraDropdown endContent={<CameraDropdownEndContent />} disabled={running} onValueChange={(value) => (flatWizard.state.camera = value)} showLabel value={camera} />
		</div>
	)
})

const Status = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)
	const { median, state, message } = useSnapshot(flatWizard.state.event)

	return (
		<div className="col-span-full mt-2 flex min-w-0 flex-row items-center justify-between gap-2">
			<Chip color={FLAT_WIZARD_STATE_COLORS[state]} size="sm">
				{FLAT_WIZARD_STATE_LABELS[state]}
			</Chip>
			{median > 0 && (
				<Chip color="secondary" size="sm">
					{median.toFixed(0)}
				</Chip>
			)}
			{message && <span className="min-w-0 flex-1 truncate text-right text-xs text-neutral-400">{message}</span>}
		</div>
	)
})

const Input = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)
	const { camera, running } = useSnapshot(flatWizard.state)
	const { minExposure, maxExposure, meanTarget, meanTolerance, path } = useSnapshot(flatWizard.state.request)

	const disabled = !camera?.connected || running
	const exposureMinValue = (camera?.exposure.min ?? 0) * 1000
	const exposureMaxValue = (camera?.exposure.max ?? 0) * 1000

	return (
		<>
			<FilePickerInput className="col-span-full" disabled={running} fullWidth id="flatwizard" mode="directory" onValueChange={flatWizard.updatePath} value={path} />
			<NumberInput className="col-span-6" disabled={disabled} label="Min exposure (ms)" maxValue={exposureMaxValue} minValue={exposureMinValue} onValueChange={(value) => flatWizard.update('minExposure', value)} value={minExposure} />
			<NumberInput className="col-span-6" disabled={disabled} label="Max exposure (ms)" maxValue={exposureMaxValue} minValue={exposureMinValue} onValueChange={(value) => flatWizard.update('maxExposure', value)} value={maxExposure} />
			<NumberInput className="col-span-6" disabled={running} label="Mean target" maxValue={MEAN_MAX_VALUE} minValue={0} onValueChange={(value) => flatWizard.update('meanTarget', value)} value={meanTarget} />
			<NumberInput className="col-span-6" disabled={running} fractionDigits={1} label="Mean tolerance (%)" maxValue={100} minValue={0} onValueChange={(value) => flatWizard.update('meanTolerance', value)} step={0.1} value={meanTolerance} />
		</>
	)
})

const Footer = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)
	const { running, camera } = useSnapshot(flatWizard.state)
	const { path: saveAt } = useSnapshot(flatWizard.state.request)
	const canStart = camera?.connected === true && saveAt.trim().length > 0

	return (
		<>
			<Button color="danger" disabled={!running} label="Stop" onClick={flatWizard.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={!canStart} label="Start" loading={running} onClick={flatWizard.start} startContent={<Icons.Play />} />
		</>
	)
})

const CameraDropdownEndContent = memo(() => {
	const flatWizard = useMolecule(FlatWizardMolecule)
	const { camera } = useSnapshot(flatWizard.state)
	const { capture } = useSnapshot(flatWizard.state.request)

	return camera && <CameraCaptureStartPopover camera={camera} mode="flatWizard" onValueChange={flatWizard.updateCapture} value={capture} />
})
