import { memo, useContext } from 'react'
import type { MountRemoteControlStart } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { MountStoreContext } from '../shared/context'
import { Button } from './components/Button'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { MountRemoteControlProtocolSelect } from './MountRemoteControlProtocolSelect'

export const MountRemoteControl = memo(() => {
	const mount = useContext(MountStoreContext)

	return (
		<Modal footer={<Footer />} header="Remote Control" id={`mount-remote-control-${mount.state.mount.id}`} initialWidth="236px" onHide={mount.hideRemoteControl}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const mount = useContext(MountStoreContext)
	const { request, status, pendingAction } = useSnapshot(mount.state.remoteControl)
	const currentStatus = status[request.protocol]
	const disabled = pendingAction !== undefined || !!currentStatus

	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<MountRemoteControlProtocolSelect className="col-span-full" disabled={pendingAction !== undefined} onValueChange={(value) => mount.updateRemoteControl('protocol', value)} value={request.protocol} />
			<TextInput className="col-span-7" disabled={disabled} label="Host" onValueChange={(value) => mount.updateRemoteControl('host', value)} value={currentStatus ? currentStatus.host : request.host} />
			<NumberInput className="col-span-5" disabled={disabled} label="Port" maxValue={65535} minValue={80} onValueChange={(value) => mount.updateRemoteControl('port', value)} value={currentStatus ? currentStatus.port : request.port} />
		</div>
	)
})

function canStartRemoteControl({ host, port }: MountRemoteControlStart) {
	return host.trim().length > 0 && Number.isInteger(port) && port >= 80 && port <= 65535
}

const Footer = memo(() => {
	const mount = useContext(MountStoreContext)
	const { remoteControl } = mount.state
	const { request, status, pendingAction } = useSnapshot(remoteControl)
	const currentStatus = status[request.protocol]
	const busy = pendingAction !== undefined
	const canStart = !currentStatus && canStartRemoteControl(request)

	async function handleStart() {
		if (!canStart || busy) return

		remoteControl.pendingAction = 'start'

		try {
			await mount.startRemoteControl()
		} finally {
			remoteControl.pendingAction = undefined
		}
	}

	async function handleStop() {
		if (!currentStatus || busy) return

		remoteControl.pendingAction = 'stop'

		try {
			await mount.stopRemoteControl()
		} finally {
			remoteControl.pendingAction = undefined
		}
	}

	return (
		<>
			<Button color="danger" disabled={!currentStatus || busy} label="Stop" loading={pendingAction === 'stop'} onClick={handleStop} startContent={<Icons.Stop />} />
			<Button color="primary" disabled={!canStart || busy} label="Connect" loading={pendingAction === 'start'} onClick={handleStart} startContent={<Icons.Connect />} />
		</>
	)
})
