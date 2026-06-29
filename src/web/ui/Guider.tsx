import { memo } from 'react'
import type { GuiderRemoteConnect } from 'src/shared/types'
import { guiderStore } from 'src/web/stores/guider.store'
import { useSnapshot } from 'valtio'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { Checkbox } from './components/Checkbox'
import { Chip } from './components/Chip'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { ConnectButton } from './ConnectButton'
import { CameraDropdown, GuideOutputDropdown } from './DeviceDropdown'
import { GuiderClientModeRadioGroup } from './GuiderClientModeRadioGroup'
import { Icons } from './Icon'
import { Modal } from './Modal'

function canConnectRemote({ host, port }: Pick<GuiderRemoteConnect, 'host' | 'port'>) {
	return host.trim().length > 0 && Number.isInteger(port) && port >= 80 && port <= 65535
}

export const Guider = memo(() => {
	const { show } = useSnapshot(guiderStore.state)

	if (!show) return null

	return (
		<Modal footer={<Footer />} header="Guider" id="guider" initialWidth="360px" onHide={guiderStore.hide} subHeader={<SubHeader />}>
			<Body />
		</Modal>
	)
})

const SubHeader = memo(() => {
	const { profile } = useSnapshot(guiderStore.state)

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
	const { connecting, connected, camera, guideOutput } = useSnapshot(guiderStore.state)
	const { host, port, mode } = useSnapshot(guiderStore.state.connection)
	const canConnect = mode === 'remote' ? canConnectRemote({ host, port }) : !!camera && !!guideOutput

	return (
		<>
			<div className="col-span-full flex flex-row items-center justify-center">
				<GuiderClientModeRadioGroup disabled={connected || connecting} horizontal onValueChange={(value) => guiderStore.updateConnection('mode', value)} value={mode} />
			</div>
			{mode === 'remote' ? (
				<>
					<TextInput className="col-span-7" disabled={connected || connecting} label="Host" maxLength={128} onValueChange={(value) => guiderStore.updateConnection('host', value)} placeholder="localhost" value={host} />
					<NumberInput className="col-span-3" disabled={connected || connecting} label="Port" maxValue={65535} minValue={80} onValueChange={(value) => guiderStore.updateConnection('port', value)} placeholder="4400" value={port} />
				</>
			) : (
				<DeviceChooser />
			)}
			<div className="col-span-2 flex flex-row items-center justify-center gap-2">
				<ConnectButton disabled={!canConnect || connecting} connected={connected} loading={connecting} onClick={guiderStore.connect} />
			</div>
		</>
	)
})

const DeviceChooser = memo(() => {
	const { camera, guideOutput, connected, connecting } = useSnapshot(guiderStore.state)
	const blocked = connected || connecting

	return (
		<div className="col-span-10 flex flex-row items-center justify-center gap-2">
			<CameraDropdown endContent={<CameraDropdownEndContent />} disabled={blocked} onValueChange={(value) => (guiderStore.state.camera = value)} showLabel value={camera} />
			<GuideOutputDropdown disabled={blocked} onValueChange={(value) => (guiderStore.state.guideOutput = value)} showLabel value={guideOutput} />
		</div>
	)
})

const CameraDropdownEndContent = memo(() => {
	const { camera } = useSnapshot(guiderStore.state)
	const { capture } = useSnapshot(guiderStore.state.connection)

	return camera && <CameraCaptureStartPopover camera={camera} mode="guider" onValueChange={guiderStore.updateCapture} value={capture} />
})

const Settle = memo(() => {
	const { connected } = useSnapshot(guiderStore.state)
	const { pixels, time, timeout } = useSnapshot(guiderStore.state.connection.dither.settle)

	return (
		<>
			<NumberInput className="col-span-6" disabled={connected} fractionDigits={1} label="Settle tolerance (px)" maxValue={25} minValue={1} onValueChange={(value) => guiderStore.updateSettle('pixels', value)} placeholder="1.5" step={0.1} value={pixels} />
			<NumberInput className="col-span-6" disabled={connected} label="Min settle time (s)" maxValue={60} minValue={1} onValueChange={(value) => guiderStore.updateSettle('time', value)} placeholder="10" value={time} />
			<NumberInput className="col-span-5" disabled={connected} label="Settle timeout (s)" maxValue={60} minValue={1} onValueChange={(value) => guiderStore.updateSettle('timeout', value)} placeholder="30" value={timeout} />
		</>
	)
})

const Dither = memo(() => {
	const { connected } = useSnapshot(guiderStore.state)
	const { amount, raOnly } = useSnapshot(guiderStore.state.connection.dither)

	return (
		<>
			<NumberInput className="col-span-4" disabled={connected} fractionDigits={1} label="Dither pixels (px)" maxValue={25} minValue={1} onValueChange={(value) => guiderStore.updateDither('amount', value)} placeholder="5" step={0.1} value={amount} />
			<Checkbox className="col-span-3" disabled={connected} label="RA only" onValueChange={(value) => guiderStore.updateDither('raOnly', value)} value={raOnly} />
		</>
	)
})

const Buttons = memo(() => {
	const { connected, running, looping, pendingCommand } = useSnapshot(guiderStore.state)
	const busy = pendingCommand !== undefined

	return (
		<div className="col-span-full flex flex-row items-center justify-center gap-2">
			<IconButton color="primary" disabled={!connected || looping || running || busy} icon={Icons.Reload} loading={pendingCommand === 'loop'} onClick={guiderStore.loop} tooltipContent="Loop exposures" />
			<IconButton color="warning" disabled={!connected || !looping || busy} icon={Icons.Star} loading={pendingCommand === 'findStar'} onClick={guiderStore.findStar} tooltipContent="Find guide star" />
			<IconButton color="success" disabled={!connected || running || busy} icon={Icons.Play} loading={pendingCommand === 'start'} onClick={guiderStore.start} tooltipContent="Start guiding" />
			<IconButton color="danger" disabled={!connected || (!running && !looping) || busy} icon={Icons.Stop} loading={pendingCommand === 'stop'} onClick={guiderStore.stop} tooltipContent="Stop guiding" />
		</div>
	)
})

const Status = memo(() => {
	const { state, snr, starMass, hfd } = useSnapshot(guiderStore.state.event)

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
	const { pendingCommand } = useSnapshot(guiderStore.state)
	const { rmsRA, rmsDEC } = useSnapshot(guiderStore.state.event)

	return (
		<div className="flex w-full items-center justify-center gap-2">
			<span>RA: {rmsRA.toFixed(2)}"</span>
			<span>DEC: {rmsDEC.toFixed(2)}"</span>
			<span>Total: {Math.hypot(rmsRA, rmsDEC).toFixed(2)}"</span>
			<IconButton color="primary" icon={Icons.Broom} loading={pendingCommand === 'clear'} onClick={guiderStore.clear} tooltipContent="Clear guide graph" />
		</div>
	)
})
