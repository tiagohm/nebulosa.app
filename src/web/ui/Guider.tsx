import { useStore } from '@hooks/store.hook'
import { CameraCaptureStoreContext, GuiderStoreContext } from '@shared/context'
import { CameraCaptureStartPopover } from '@ui/CameraCaptureStartPopover'
import { Checkbox } from '@ui/components/Checkbox'
import { Chip } from '@ui/components/Chip'
import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { TextInput } from '@ui/components/TextInput'
import { ConnectButton } from '@ui/ConnectButton'
import { CameraDropdown, GuideOutputDropdown } from '@ui/DeviceDropdown'
import { GuiderClientModeRadioGroup } from '@ui/GuiderClientModeRadioGroup'
import { Icons } from '@ui/Icon'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useContext } from 'react'
import { guiderStore } from 'src/web/stores/guider.store'
import { useSnapshot } from 'valtio'
import { canConnectRemote } from '#/guider'

export const Guider = memo(({ api }: IDockviewPanelProps) => {
	const guider = useStore(() => guiderStore(api), [api.id])

	return (
		<GuiderStoreContext value={guider}>
			<div className="grid grid-cols-12 items-center gap-2 p-3">
				<Connection />
				<Settle />
				<Dither />
				<Command />
				<Status />
				<Footer />
			</div>
		</GuiderStoreContext>
	)
})

const Connection = memo(() => {
	const guider = useContext(GuiderStoreContext)
	const { connecting, connected } = useSnapshot(guider.state)
	const { mode } = useSnapshot(guider.state.connection)

	return (
		<>
			<div className="col-span-full flex flex-col items-center justify-center gap-3">
				<GuiderClientModeRadioGroup disabled={connected || connecting} horizontal onValueChange={guider.setConnectionMode} value={mode} />
				{mode === 'remote' ? <RemoteConnection /> : <LocalConnection />}
			</div>
		</>
	)
})

const RemoteConnection = memo(() => {
	const guider = useContext(GuiderStoreContext)
	const { connection, connecting, connected } = useSnapshot(guider.state)
	const canConnect = canConnectRemote(connection)

	return (
		<div className="flex flex-1 items-center gap-2">
			<TextInput className="col-span-7" disabled={connected || connecting} label="Host" maxLength={128} onValueChange={guider.setConnectionHost} placeholder="localhost" value={connection.host} />
			<NumberInput className="col-span-3" disabled={connected || connecting} label="Port" maxValue={65535} minValue={80} onValueChange={guider.setConnectionPort} placeholder="4400" value={connection.port} />
			<ConnectButton disabled={!canConnect || connecting} connected={connected} loading={connecting} onClick={guider.connect} />
		</div>
	)
})

const LocalConnection = memo(() => {
	const guider = useContext(GuiderStoreContext)
	const { connecting, connected, camera, guideOutput } = useSnapshot(guider.state)
	const canConnect = camera !== undefined && guideOutput !== undefined

	return (
		<div className="flex flex-1 items-center gap-2">
			<DeviceChooser />
			<ConnectButton disabled={!canConnect || connecting} connected={connected} loading={connecting} onClick={guider.connect} />
		</div>
	)
})

const DeviceChooser = memo(() => {
	const guider = useContext(GuiderStoreContext)
	const { camera, guideOutput, connected, connecting } = useSnapshot(guider.state)
	const blocked = connected || connecting

	return (
		<div className="col-span-10 flex flex-row items-center justify-center gap-2">
			<CameraDropdown endContent={<CameraDropdownEndContent />} disabled={blocked} onValueChange={(value) => (guider.state.camera = value)} showLabel value={camera} />
			<GuideOutputDropdown disabled={blocked} onValueChange={(value) => (guider.state.guideOutput = value)} showLabel value={guideOutput} />
		</div>
	)
})

const CameraDropdownEndContent = memo(() => {
	const guider = useContext(GuiderStoreContext)
	const { camera } = useSnapshot(guider.state)

	return (
		camera && (
			<CameraCaptureStoreContext value={guider.capture}>
				<CameraCaptureStartPopover camera={camera} mode="guider" />
			</CameraCaptureStoreContext>
		)
	)
})

const Settle = memo(() => {
	const guider = useContext(GuiderStoreContext)
	const { connected } = useSnapshot(guider.state)
	const { pixels, time, timeout } = useSnapshot(guider.state.connection.dither.settle)

	return (
		<>
			<NumberInput className="col-span-6" disabled={connected} fractionDigits={1} label="Settle tolerance (px)" maxValue={25} minValue={1} onValueChange={guider.setSettlePixels} placeholder="1.5" step={0.1} value={pixels} />
			<NumberInput className="col-span-6" disabled={connected} label="Min settle time (s)" maxValue={60} minValue={1} onValueChange={guider.setSettleTime} placeholder="10" value={time} />
			<NumberInput className="col-span-5" disabled={connected} label="Settle timeout (s)" maxValue={60} minValue={1} onValueChange={guider.setSettleTimeout} placeholder="30" value={timeout} />
		</>
	)
})

const Dither = memo(() => {
	const guider = useContext(GuiderStoreContext)
	const { connected } = useSnapshot(guider.state)
	const { amount, raOnly } = useSnapshot(guider.state.connection.dither)

	return (
		<>
			<NumberInput className="col-span-4" disabled={connected} fractionDigits={1} label="Dither pixels (px)" maxValue={25} minValue={1} onValueChange={guider.setDitherAmount} placeholder="5" step={0.1} value={amount} />
			<Checkbox className="col-span-3" disabled={connected} label="RA only" onValueChange={guider.setDitherRaOnly} value={raOnly} />
		</>
	)
})

const Command = memo(() => {
	const guider = useContext(GuiderStoreContext)
	const { connected, pendingCommand } = useSnapshot(guider.state)
	const { state } = useSnapshot(guider.state.event)
	const looping = state === 'looping'
	const busy = pendingCommand !== undefined
	const blocked = !connected || busy

	return (
		<div className="col-span-full flex flex-row items-center justify-center gap-2">
			<IconButton color="primary" disabled={blocked || state !== 'idle'} icon={Icons.Reload} loading={pendingCommand === 'loop'} onClick={guider.loop} tooltipContent="Loop exposures" />
			<IconButton color="warning" disabled={blocked || !looping} icon={Icons.Star} loading={pendingCommand === 'findStar'} onClick={guider.findStar} tooltipContent="Find guide star" />
			<IconButton color="success" disabled={blocked || (!looping && state !== 'starLost')} icon={Icons.Play} loading={pendingCommand === 'start'} onClick={guider.start} tooltipContent="Start guiding" />
			<IconButton color="danger" disabled={blocked || state === 'idle'} icon={Icons.Stop} loading={pendingCommand === 'stop'} onClick={guider.stop} tooltipContent="Stop guiding" />
		</div>
	)
})

const Status = memo(() => {
	const guider = useContext(GuiderStoreContext)
	const { state, snr, starMass, hfd } = useSnapshot(guider.state.event)

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
	const guider = useContext(GuiderStoreContext)
	const { pendingCommand } = useSnapshot(guider.state)
	const { rmsRA, rmsDEC } = useSnapshot(guider.state.event)

	return (
		<div className="col-span-full flex flex-row items-center justify-center gap-2">
			<span>RA: {rmsRA.toFixed(2)}"</span>
			<span>DEC: {rmsDEC.toFixed(2)}"</span>
			<span>Total: {Math.hypot(rmsRA, rmsDEC).toFixed(2)}"</span>
			<IconButton color="primary" icon={Icons.Broom} loading={pendingCommand === 'clear'} onClick={guider.clear} tooltipContent="Clear guide graph" />
		</div>
	)
})
