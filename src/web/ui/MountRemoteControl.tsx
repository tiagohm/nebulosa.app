import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { MountMolecule } from '@/molecules/indi/mount'
import { Button } from './components/Button'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { MountRemoteControlProtocolSelect } from './MountRemoteControlProtocolSelect'

export const MountRemoteControl = memo(() => {
	const mount = useMolecule(MountMolecule)

	return (
		<Modal footer={<Footer />} header="Remote Control" id={`mount-remote-control-${mount.scope.mount.name}`} maxWidth="236px" onHide={mount.hideRemoteControl}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { protocol, port } = useSnapshot(mount.state.remoteControl.request)
	const status = useSnapshot(mount.state.remoteControl).status[protocol]
	const { host } = useSnapshot(mount.state.remoteControl.request, { sync: true })

	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<MountRemoteControlProtocolSelect className="col-span-full" onValueChange={(value) => mount.updateRemoteControl('protocol', value)} value={protocol} />
			<TextInput className="col-span-7" disabled={!!status} label="Host" onValueChange={(value) => mount.updateRemoteControl('host', value)} value={status ? status.host : host} />
			<NumberInput className="col-span-5" disabled={!!status} label="Port" maxValue={65535} minValue={80} onValueChange={(value) => mount.updateRemoteControl('port', value)} value={status ? status.port : port} />
		</div>
	)
})

const Footer = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { protocol } = useSnapshot(mount.state.remoteControl.request)
	const status = useSnapshot(mount.state.remoteControl).status[protocol]
	const { host } = useSnapshot(mount.state.remoteControl.request, { sync: true })

	return (
		<>
			<Button color="danger" disabled={!status} label="Stop" onPointerUp={mount.stopRemoteControl} startContent={<Icons.Stop />} />
			<Button color="primary" disabled={!host || !!status} label="Connect" onPointerUp={mount.startRemoteControl} startContent={<Icons.Connect />} />
		</>
	)
})
