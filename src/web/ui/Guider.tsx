import { CameraCaptureStoreContext } from '@shared/context'
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
import { memo, useEffect } from 'react'
import type { GuiderRemoteConnect } from 'src/shared/types'
import { guiderStore } from 'src/web/stores/guider.store'
import { useSnapshot } from 'valtio'

export const Guider = memo(() => {
	useEffect(guiderStore.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Connection />
			<Settle />
			<Dither />
			<Buttons />
			<Status />
			<Footer />
		</div>
	)
})

const Connection = memo(() => {
	const { connecting, connected } = useSnapshot(guiderStore.state)
	const { mode } = useSnapshot(guiderStore.state.connection)

	return (
		<>
			<div className="col-span-full flex flex-col items-center justify-center gap-3">
				<GuiderClientModeRadioGroup disabled={connected || connecting} horizontal onValueChange={(value) => guiderStore.updateConnection('mode', value)} value={mode} />
				{mode === 'remote' ? <RemoteConnection /> : <LocalConnection />}
			</div>
		</>
	)
})

const RemoteConnection = memo(() => {
	const { connecting, connected } = useSnapshot(guiderStore.state)
	const { connection } = useSnapshot(guiderStore.state)
	const canConnect = canConnectRemote(connection)

	return (
		<div className="flex flex-1 items-center gap-2">
			<TextInput className="col-span-7" disabled={connected || connecting} label="Host" maxLength={128} onValueChange={(value) => guiderStore.updateConnection('host', value)} placeholder="localhost" value={connection.host} />
			<NumberInput className="col-span-3" disabled={connected || connecting} label="Port" maxValue={65535} minValue={80} onValueChange={(value) => guiderStore.updateConnection('port', value)} placeholder="4400" value={connection.port} />
			<ConnectButton disabled={!canConnect || connecting} connected={connected} loading={connecting} onClick={guiderStore.connect} />
		</div>
	)
})

const LocalConnection = memo(() => {
	const { connecting, connected, camera, guideOutput } = useSnapshot(guiderStore.state)
	const canConnect = camera !== undefined && guideOutput !== undefined

	return (
		<div className="flex flex-1 items-center gap-2">
			<DeviceChooser />
			<ConnectButton disabled={!canConnect || connecting} connected={connected} loading={connecting} onClick={guiderStore.connect} />
		</div>
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

	return (
		camera && (
			<CameraCaptureStoreContext value={guiderStore.capture}>
				<CameraCaptureStartPopover camera={camera} mode="guider" />
			</CameraCaptureStoreContext>
		)
	)
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
		<div className="col-span-full flex flex-row items-center justify-center gap-2">
			<span>RA: {rmsRA.toFixed(2)}"</span>
			<span>DEC: {rmsDEC.toFixed(2)}"</span>
			<span>Total: {Math.hypot(rmsRA, rmsDEC).toFixed(2)}"</span>
			<IconButton color="primary" icon={Icons.Broom} loading={pendingCommand === 'clear'} onClick={guiderStore.clear} tooltipContent="Clear guide graph" />
		</div>
	)
})

function canConnectRemote({ host, port }: Pick<GuiderRemoteConnect, 'host' | 'port'>) {
	return host.trim().length > 0 && Number.isInteger(port) && port >= 80 && port <= 65535
}
