import { memo, useContext, useEffect, useMemo } from 'react'
import type { DarvState } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { CameraDeviceContext, DarvStoreContext, MountDeviceContext } from '../shared/context'
import { darvStore } from '../store/darv.store'
import { equipmentStore } from '../store/equipment.store'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { Button } from './components/Button'
import { Chip, type ChipProps } from './components/Chip'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { ConnectButton } from './ConnectButton'
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
	const camera = useContext(CameraDeviceContext)
	const mount = useContext(MountDeviceContext)
	const darv = useMemo(() => darvStore(camera, mount), [camera, mount])
	useEffect(darv.mount, [darv])

	return (
		<DarvStoreContext value={darv}>
			<Modal footer={<Footer />} header="Drift Alignment by Robert Vice" id="darv" maxWidth="360px" onHide={darv.hide}>
				<Body />
			</Modal>
		</DarvStoreContext>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<CameraAndMount />
		<Status />
		<Input />
	</div>
))

const CameraAndMount = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { capture } = useSnapshot(darv.state.request)
	const { connected: cameraConnected } = useSnapshot(darv.state.camera)
	const { connected: mountConnected } = useSnapshot(darv.state.mount)

	const CameraStartContent = <ConnectButton connected={cameraConnected} onClick={() => equipmentStore.connect(darv.state.camera)} size="sm" />
	const MountStartContent = <ConnectButton connected={mountConnected} onClick={() => equipmentStore.connect(darv.state.mount)} size="sm" />
	const CameraEndContent = <CameraCaptureStartPopover camera={darv.state.camera} mode="darv" onValueChange={darv.updateCapture} value={capture} />

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-between">
			<TextInput readOnly label="Camera" value={darv.state.camera.name} startContent={CameraStartContent} endContent={CameraEndContent} />
			<TextInput readOnly label="Mount" value={darv.state.mount.name} startContent={MountStartContent} />
		</div>
	)
})

const Status = memo(() => {
	const darv = useContext(DarvStoreContext)
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
	const darv = useContext(DarvStoreContext)
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

const Footer = memo(() => {
	const darv = useContext(DarvStoreContext)
	const { running, camera, mount } = useSnapshot(darv.state)

	return (
		<>
			<Button color="danger" disabled={!running} label="Stop" onClick={darv.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={!camera?.connected || !mount?.connected} label="Start" loading={running} onClick={darv.start} startContent={<Icons.Play />} />
		</>
	)
})
