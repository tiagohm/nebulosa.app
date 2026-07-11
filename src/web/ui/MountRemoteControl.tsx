import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { MountStoreContext } from '../shared/context'
import { Button } from './components/Button'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { MountRemoteControlProtocolSelect } from './MountRemoteControlProtocolSelect'

export const MountRemoteControl = memo(() => (
	<div className="flex flex-col gap-2">
		<Body />
		<Footer />
	</div>
))

const Body = memo(() => {
	const mount = useContext(MountStoreContext)
	const { request, status, pendingAction } = useSnapshot(mount.state.remoteControl)
	const currentStatus = status[request.protocol]
	const disabled = pendingAction !== undefined || !!currentStatus

	return (
		<div className="grid grid-cols-12 gap-2">
			<MountRemoteControlProtocolSelect className="col-span-full" disabled={pendingAction !== undefined} onValueChange={(value) => mount.updateRemoteControl('protocol', value)} value={request.protocol} />
			<TextInput className="col-span-7" disabled={disabled} label="Host" onValueChange={(value) => mount.updateRemoteControl('host', value)} value={currentStatus ? currentStatus.host : request.host} />
			<NumberInput className="col-span-5" disabled={disabled} label="Port" maxValue={65535} minValue={80} onValueChange={(value) => mount.updateRemoteControl('port', value)} value={currentStatus ? currentStatus.port : request.port} />
		</div>
	)
})

const Footer = memo(() => {
	const mount = useContext(MountStoreContext)
	const { remoteControl } = mount.state
	const { request, status, pendingAction } = useSnapshot(remoteControl)
	const currentStatus = status[request.protocol]
	const busy = pendingAction !== undefined
	const canStart = !currentStatus && request.host.trim().length > 0 && Number.isInteger(request.port) && request.port >= 80 && request.port <= 65535

	async function handleStart() {
		if (!canStart || busy) return
		await mount.startRemoteControl()
	}

	async function handleStop() {
		if (!currentStatus || busy) return
		await mount.stopRemoteControl()
	}

	return (
		<>
			<Button color="danger" disabled={!currentStatus || busy} label="Stop" loading={pendingAction === 'stop'} onClick={handleStop} startContent={<Icons.Stop />} />
			<Button color="primary" disabled={!canStart || busy} label="Connect" loading={pendingAction === 'start'} onClick={handleStart} startContent={<Icons.Connect />} />
		</>
	)
})
