import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { PHD2RemoteConnect } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { PHD2Molecule } from '@/molecules/phd2'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { Checkbox } from './components/Checkbox'
import { Chip } from './components/Chip'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { ConnectButton } from './ConnectButton'
import { CameraDropdown, GuideOutputDropdown } from './DeviceDropdown'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { PHD2ClientModeRadioGroup } from './PHD2ClientModeRadioGroup'

function canConnectRemote({ host, port }: Pick<PHD2RemoteConnect, 'host' | 'port'>) {
	return host.trim().length > 0 && Number.isInteger(port) && port >= 80 && port <= 65535
}

export const PHD2 = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)

	return (
		<Modal footer={<Footer />} header="PHD2" id="phd2" maxWidth="360px" onHide={phd2.hide} subHeader={<SubHeader />}>
			<Body />
		</Modal>
	)
})

const SubHeader = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { profile } = useSnapshot(phd2.state)

	return <span>{profile}</span>
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<Connection />
		<Settle />
		<Dither />
		<Buttons />
		<Status />
	</div>
))

const Connection = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { connecting, connected, camera, guideOutput } = useSnapshot(phd2.state)
	const { host, port, mode } = useSnapshot(phd2.state.connection)
	const canConnect = mode === 'remote' ? canConnectRemote({ host, port }) : !!camera && !!guideOutput

	return (
		<>
			<div className="col-span-full flex flex-row items-center justify-center">
				<PHD2ClientModeRadioGroup disabled={connected || connecting} horizontal onValueChange={(value) => phd2.updateConnection('mode', value)} value={mode} />
			</div>
			{mode === 'remote' ? (
				<>
					<TextInput className="col-span-7" disabled={connected || connecting} label="Host" maxLength={128} onValueChange={(value) => phd2.updateConnection('host', value)} placeholder="localhost" value={host} />
					<NumberInput className="col-span-3" disabled={connected || connecting} label="Port" maxValue={65535} minValue={80} onValueChange={(value) => phd2.updateConnection('port', value)} placeholder="4400" value={port} />
				</>
			) : (
				<DeviceChooser />
			)}
			<div className="col-span-2 flex flex-row items-center justify-center gap-2">
				<ConnectButton disabled={!canConnect || connecting} connected={connected} loading={connecting} onClick={phd2.connect} />
			</div>
		</>
	)
})

const DeviceChooser = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { camera, guideOutput, connected, connecting } = useSnapshot(phd2.state)
	const blocked = connected || connecting

	return (
		<div className="col-span-10 flex flex-row items-center justify-center gap-2">
			<CameraDropdown endContent={<CameraDropdownEndContent />} disabled={blocked} onValueChange={(value) => (phd2.state.camera = value)} showLabel value={camera} />
			<GuideOutputDropdown disabled={blocked} onValueChange={(value) => (phd2.state.guideOutput = value)} showLabel value={guideOutput} />
		</div>
	)
})

const CameraDropdownEndContent = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { camera } = useSnapshot(phd2.state)
	const { capture } = useSnapshot(phd2.state.connection)

	return camera && <CameraCaptureStartPopover camera={camera} mode="guider" onValueChange={phd2.updateCapture} value={capture} />
})

const Settle = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { connected } = useSnapshot(phd2.state)
	const { pixels, time, timeout } = useSnapshot(phd2.state.connection.dither.settle)

	return (
		<>
			<NumberInput className="col-span-6" disabled={connected} fractionDigits={1} label="Settle tolerance (px)" maxValue={25} minValue={1} onValueChange={(value) => phd2.updateSettle('pixels', value)} placeholder="1.5" step={0.1} value={pixels} />
			<NumberInput className="col-span-6" disabled={connected} label="Min settle time (s)" maxValue={60} minValue={1} onValueChange={(value) => phd2.updateSettle('time', value)} placeholder="10" value={time} />
			<NumberInput className="col-span-5" disabled={connected} label="Settle timeout (s)" maxValue={60} minValue={1} onValueChange={(value) => phd2.updateSettle('timeout', value)} placeholder="30" value={timeout} />
		</>
	)
})

const Dither = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { connected } = useSnapshot(phd2.state)
	const { amount, raOnly } = useSnapshot(phd2.state.connection.dither)

	return (
		<>
			<NumberInput className="col-span-4" disabled={connected} fractionDigits={1} label="Dither pixels (px)" maxValue={25} minValue={1} onValueChange={(value) => phd2.updateDither('amount', value)} placeholder="5" step={0.1} value={amount} />
			<Checkbox className="col-span-3" disabled={connected} label="RA only" onValueChange={(value) => phd2.updateDither('raOnly', value)} value={raOnly} />
		</>
	)
})

const Buttons = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { connected, running, looping, pendingCommand } = useSnapshot(phd2.state)
	const busy = pendingCommand !== undefined

	return (
		<div className="col-span-full flex flex-row items-center justify-center gap-2">
			<IconButton color="primary" disabled={!connected || looping || running || busy} icon={Icons.Reload} loading={pendingCommand === 'loop'} onClick={phd2.loop} tooltipContent="Loop exposures" />
			<IconButton color="warning" disabled={!connected || !looping || busy} icon={Icons.Star} loading={pendingCommand === 'findStar'} onClick={phd2.findStar} tooltipContent="Find guide star" />
			<IconButton color="success" disabled={!connected || running || busy} icon={Icons.Play} loading={pendingCommand === 'start'} onClick={phd2.start} tooltipContent="Start guiding" />
			<IconButton color="danger" disabled={!connected || (!running && !looping) || busy} icon={Icons.Stop} loading={pendingCommand === 'stop'} onClick={phd2.stop} tooltipContent="Stop guiding" />
		</div>
	)
})

const Status = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { state, snr, starMass, hfd } = useSnapshot(phd2.state.event)

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-center gap-1">
			<Chip size="sm" color="primary">
				{state}
			</Chip>
			<Chip size="sm" color="success">
				SNR: {snr.toFixed(0)}
			</Chip>
			<Chip size="sm" color="warning">
				HFD: {hfd.toFixed(2)}
			</Chip>
			<Chip size="sm" color="secondary">
				Star mass: {starMass.toFixed(0)}
			</Chip>
		</div>
	)
})

const Footer = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { pendingCommand } = useSnapshot(phd2.state)
	const { rmsRA, rmsDEC } = useSnapshot(phd2.state.event)

	return (
		<div className="flex w-full items-center justify-center gap-2">
			<span>RA: {rmsRA.toFixed(2)}"</span>
			<span>DEC: {rmsDEC.toFixed(2)}"</span>
			<span>Total: {Math.hypot(rmsRA, rmsDEC).toFixed(2)}"</span>
			<IconButton color="primary" icon={Icons.Broom} loading={pendingCommand === 'clear'} onClick={phd2.clear} tooltipContent="Clear guide graph" />
		</div>
	)
})
