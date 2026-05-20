import { formatDEC, formatRA } from 'nebulosa/src/angle'
import { memo, useContext, useEffect, useMemo } from 'react'
import type { TppaState } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { CameraDeviceContext, TppaStoreContext, MountDeviceContext } from '../shared/context'
import { equipmentStore } from '../store/equipment.store'
import { tppaStore } from '../store/tppa.store'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { Chip, type ChipProps } from './components/Chip'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { PlateSolverSelect } from './PlateSolverSelect'
import { PlateSolveStartPopover } from './PlateSolveStartPopover'
import { TppaDirectionSelect } from './TppaDirectionSelect'

const TPPA_STATE_LABELS = {
	IDLE: 'idle',
	WAITING: 'waiting',
	MOVING: 'moving',
	CAPTURING: 'capturing',
	SOLVING: 'solving',
	ALIGNING: 'aligning',
	SETTLING: 'settling',
} satisfies Record<TppaState, string>

const TPPA_STATE_COLORS = {
	IDLE: 'default',
	WAITING: 'warning',
	MOVING: 'secondary',
	CAPTURING: 'primary',
	SOLVING: 'primary',
	ALIGNING: 'success',
	SETTLING: 'warning',
} satisfies Record<TppaState, NonNullable<ChipProps['color']>>

export const Tppa = memo(() => {
	const camera = useContext(CameraDeviceContext)
	const mount = useContext(MountDeviceContext)
	const tppa = useMemo(() => tppaStore(camera, mount), [camera, mount])
	useEffect(tppa.mount, [tppa])

	return (
		<TppaStoreContext value={tppa}>
			<Modal footer={<Footer />} header="Three-Point Polar Alignment" id="tppa" maxWidth="416px" onHide={tppa.hide}>
				<Body />
			</Modal>
		</TppaStoreContext>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<CameraAndMount />
		<Status />
		<Inputs />
		<Result />
	</div>
))

const CameraAndMount = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { capture } = useSnapshot(tppa.state.request)
	const { connected: cameraConnected } = useSnapshot(tppa.state.camera)
	const { connected: mountConnected } = useSnapshot(tppa.state.mount)

	const CameraStartContent = <ConnectButton connected={cameraConnected} onClick={() => equipmentStore.connect(tppa.state.camera)} size="sm" />
	const MountStartContent = <ConnectButton connected={mountConnected} onClick={() => equipmentStore.connect(tppa.state.mount)} size="sm" />
	const CameraEndContent = <CameraCaptureStartPopover camera={tppa.state.camera} mode="tppa" onValueChange={tppa.updateCapture} value={capture} />

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-between">
			<TextInput readOnly label="Camera" value={tppa.state.camera.name} startContent={CameraStartContent} endContent={CameraEndContent} />
			<TextInput readOnly label="Mount" value={tppa.state.mount.name} startContent={MountStartContent} />
		</div>
	)
})

const Status = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { event } = useSnapshot(tppa.state)
	const { state, solved, solver } = event

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-between">
			<Chip color={TPPA_STATE_COLORS[state]} size="sm">
				{TPPA_STATE_LABELS[state]}
			</Chip>
			<div className="flex flex-row items-center gap-1">
				<Chip color="warning" size="sm">
					Step: {event.step}
				</Chip>
				<Chip color={solved ? 'success' : 'danger'} size="sm">
					RA: {formatRA(solver.rightAscension)}
				</Chip>
				<Chip color={solved ? 'success' : 'danger'} size="sm">
					DEC: {formatDEC(solver.declination)}
				</Chip>
			</div>
		</div>
	)
})

const Inputs = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { running } = useSnapshot(tppa.state)
	const { direction, moveDuration, compensateRefraction, maxAttempts, delayBeforeCapture } = useSnapshot(tppa.state.request)
	const { type } = useSnapshot(tppa.state.request.solver)

	return (
		<>
			<PlateSolverSelect className="col-span-6" disabled={running} endContent={<PlateSolverSelectEndContent />} onValueChange={(value) => tppa.updateSolver('type', value)} value={type} />
			<NumberInput className="col-span-3" disabled={running} label="Move for (s)" maxValue={60} minValue={1} onValueChange={(value) => tppa.update('moveDuration', value)} value={moveDuration} />
			<TppaDirectionSelect className="col-span-3" disabled={running} onValueChange={(value) => tppa.update('direction', value)} value={direction} />
			<NumberInput className="col-span-4" disabled={running} label="Max attempts" maxValue={30} minValue={3} onValueChange={(value) => tppa.update('maxAttempts', value)} value={maxAttempts} />
			<NumberInput className="col-span-5" disabled={running} label="Delay before capture (s)" maxValue={120} minValue={0} onValueChange={(value) => tppa.update('delayBeforeCapture', value)} value={delayBeforeCapture} />
			<Checkbox className="col-span-full" disabled={running} label="Compensate refraction" onValueChange={(value) => tppa.update('compensateRefraction', value)} value={compensateRefraction} />
		</>
	)
})

const PlateSolverSelectEndContent = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { running } = useSnapshot(tppa.state)
	const { type, radius, focalLength, pixelSize } = useSnapshot(tppa.state.request.solver)

	return <PlateSolveStartPopover disabled={running} focalLength={focalLength} onValueChange={tppa.updateSolver} pixelSize={pixelSize} radius={radius} type={type} />
})

const Result = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { event } = useSnapshot(tppa.state)

	return (
		<>
			<div className="col-span-6 mt-3 flex flex-col items-center gap-0">
				<span className="font-bold">Azimuth</span>
				<span className="text-3xl">{formatDEC(event.error.azimuth)}</span>
			</div>
			<div className="col-span-6 mt-3 flex flex-col items-center gap-0">
				<span className="font-bold">Altitude</span>
				<span className="text-3xl">{formatDEC(event.error.altitude)}</span>
			</div>
		</>
	)
})

const Footer = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { running, camera, mount } = useSnapshot(tppa.state)

	return (
		<>
			<Button color="danger" disabled={!running} label="Stop" onClick={tppa.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={running || !camera?.connected || !mount?.connected} label="Start" loading={running} onClick={tppa.start} startContent={<Icons.Play />} />
		</>
	)
})
