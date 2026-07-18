import { useStore } from '@hooks/store.hook'
import { FlatWizardStoreContext } from '@shared/context'
import { flatWizardStore } from '@stores/flatwizard.store'
import { CameraCaptureStartPopover } from '@ui/CameraCaptureStartPopover'
import { Button } from '@ui/components/Button'
import { Chip } from '@ui/components/Chip'
import { NumberInput } from '@ui/components/NumberInput'
import { CameraDropdown } from '@ui/DeviceDropdown'
import { FilePickerInput } from '@ui/FilePickerInput'
import { Icons } from '@ui/Icon'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

export interface FlatWizardParams {
	readonly id: string
}

export const FlatWizard = memo(({ api, params }: IDockviewPanelProps<FlatWizardParams>) => {
	const flatWizard = useStore(() => flatWizardStore(params.id, api), [params.id])

	return (
		<FlatWizardStoreContext value={flatWizard}>
			<div className="grid grid-cols-12 items-center gap-2 p-3">
				<Camera />
				<Status />
				<Input />
				<Footer />
			</div>
		</FlatWizardStoreContext>
	)
})

const Camera = memo(() => {
	const flatWizard = useContext(FlatWizardStoreContext)
	const { camera, running } = useSnapshot(flatWizard.state)

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-center gap-2">
			<CameraDropdown showLabel disabled={running} value={camera} onValueChange={(value) => (flatWizard.state.camera = value)} endContent={<CameraDropdownEndContent />} />
		</div>
	)
})

const CameraDropdownEndContent = memo(() => {
	const flatWizard = useContext(FlatWizardStoreContext)
	const { camera } = useSnapshot(flatWizard.state)
	const { capture } = useSnapshot(flatWizard.state.request)

	return camera && <CameraCaptureStartPopover camera={camera} mode="flatWizard" onValueChange={flatWizard.updateCapture} value={capture} />
})

const Status = memo(() => {
	const flatWizard = useContext(FlatWizardStoreContext)
	const { median, state, message } = useSnapshot(flatWizard.state.event)
	const color = state === 'idle' ? 'default' : state === 'capturing' ? 'primary' : 'warning'

	return (
		<div className="col-span-full mt-2 flex min-w-0 flex-row items-center justify-between gap-2">
			<Chip color={color} size="sm">
				{state}
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
	const flatWizard = useContext(FlatWizardStoreContext)
	const { camera, running } = useSnapshot(flatWizard.state)
	const { minExposure, maxExposure, meanTarget, meanTolerance, path } = useSnapshot(flatWizard.state.request)

	const disabled = !camera?.connected || running
	const exposureMinValue = (camera?.exposure.min ?? 0) * 1000
	const exposureMaxValue = (camera?.exposure.max ?? 0) * 1000

	return (
		<>
			<FilePickerInput className="col-span-full" disabled={running} fullWidth id="flatwizard" mode="directory" onValueChange={flatWizard.setPath} value={path} />
			<NumberInput className="col-span-6" disabled={disabled} label="Min exposure (ms)" maxValue={exposureMaxValue} minValue={exposureMinValue} onValueChange={(value) => flatWizard.update('minExposure', value)} value={minExposure} />
			<NumberInput className="col-span-6" disabled={disabled} label="Max exposure (ms)" maxValue={exposureMaxValue} minValue={exposureMinValue} onValueChange={(value) => flatWizard.update('maxExposure', value)} value={maxExposure} />
			<NumberInput className="col-span-6" disabled={running} label="Mean target" maxValue={65536} minValue={0} onValueChange={(value) => flatWizard.update('meanTarget', value)} value={meanTarget} />
			<NumberInput className="col-span-6" disabled={running} fractionDigits={1} label="Mean tolerance (%)" maxValue={100} minValue={0} onValueChange={(value) => flatWizard.update('meanTolerance', value)} step={0.1} value={meanTolerance} />
		</>
	)
})

const Footer = memo(() => {
	const flatWizard = useContext(FlatWizardStoreContext)
	const { running, camera } = useSnapshot(flatWizard.state)
	const { path: saveAt } = useSnapshot(flatWizard.state.request)
	const canStart = camera?.connected === true && saveAt.trim().length > 0

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="danger" disabled={!running} label="Stop" onClick={flatWizard.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={!canStart} label="Start" loading={running} onClick={flatWizard.start} startContent={<Icons.Play />} />
		</div>
	)
})
