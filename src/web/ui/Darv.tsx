import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { DarvState } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { DarvMolecule } from '@/molecules/darv'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { Button } from './components/Button'
import { Chip, type ChipProps } from './components/Chip'
import { NumberInput } from './components/NumberInput'
import { CameraDropdown, MountDropdown } from './DeviceDropdown'
import { HemisphereSelect } from './HemisphereSelect'
import { Icons } from './Icon'
import { Modal } from './Modal'

const DARV_STATE_LABELS = {
	IDLE: 'idle',
	WAITING: 'waiting',
	FORWARDING: 'forwarding',
	BACKWARDING: 'backwarding',
} satisfies Record<DarvState, string>

const DARV_STATE_COLORS = {
	IDLE: 'default',
	WAITING: 'warning',
	FORWARDING: 'primary',
	BACKWARDING: 'secondary',
} satisfies Record<DarvState, NonNullable<ChipProps['color']>>

export const Darv = memo(() => {
	const darv = useMolecule(DarvMolecule)

	return (
		<Modal footer={<Footer />} header="Drift Alignment by Robert Vice" id="darv" maxWidth="360px" onHide={darv.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<DeviceChooser />
		<Status />
		<Input />
	</div>
))

const DeviceChooser = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { running, camera, mount } = useSnapshot(darv.state)

	return (
		<div className="col-span-full flex flex-row items-center justify-center gap-2">
			<CameraDropdown endContent={<CameraDropdownEndContent />} disabled={running} onValueChange={(value) => (darv.state.camera = value)} showLabel value={camera} />
			<MountDropdown disabled={running} onValueChange={(value) => (darv.state.mount = value)} showLabel value={mount} />
		</div>
	)
})

const Status = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { state } = useSnapshot(darv.state.event)

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-between">
			<Chip color={DARV_STATE_COLORS[state]} size="sm">
				{DARV_STATE_LABELS[state]}
			</Chip>
		</div>
	)
})

const Input = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { running } = useSnapshot(darv.state)
	const { hemisphere, duration, initialPause } = useSnapshot(darv.state.request)

	return (
		<>
			<NumberInput className="col-span-4" disabled={running} label="Initial pause (s)" maxValue={60} minValue={1} onValueChange={(value) => darv.update('initialPause', value)} value={initialPause} />
			<NumberInput className="col-span-4" disabled={running} label="Drift for (s)" maxValue={1200} minValue={1} onValueChange={(value) => darv.update('duration', value)} value={duration} />
			<HemisphereSelect className="col-span-4" disabled={running} onValueChange={(value) => darv.update('hemisphere', value)} value={hemisphere} />
		</>
	)
})

const CameraDropdownEndContent = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { camera } = useSnapshot(darv.state)
	const { capture } = useSnapshot(darv.state.request)

	return camera && <CameraCaptureStartPopover camera={camera} mode="darv" onValueChange={darv.updateCapture} value={capture} />
})

const Footer = memo(() => {
	const darv = useMolecule(DarvMolecule)
	const { running, camera, mount } = useSnapshot(darv.state)

	return (
		<>
			<Button color="danger" disabled={!running} label="Stop" onClick={darv.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={!camera?.connected || !mount?.connected} label="Start" loading={running} onClick={darv.start} startContent={<Icons.Play />} />
		</>
	)
})
