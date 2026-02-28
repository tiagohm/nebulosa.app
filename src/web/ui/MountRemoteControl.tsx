import { Input, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { MountMolecule } from '@/molecules/indi/mount'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { MountRemoteControlProtocolSelect } from './MountRemoteControlProtocolSelect'
import { TextButton } from './TextButton'

export const MountRemoteControl = memo(() => {
	const mount = useMolecule(MountMolecule)

	return (
		<Modal footer={<Footer />} header='Remote Control' id={`mount-remote-control-${mount.scope.mount.name}`} maxWidth='236px' onHide={mount.hideRemoteControl}>
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
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<MountRemoteControlProtocolSelect className='col-span-full' onValueChange={(value) => mount.updateRemoteControl('protocol', value)} value={protocol} />
			<Input className='col-span-7' isDisabled={!!status} label='Host' onValueChange={(value) => mount.updateRemoteControl('host', value)} size='sm' value={status ? status.host : host} />
			<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!!status} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => mount.updateRemoteControl('port', value)} size='sm' value={status ? status.port : port} />
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
			<TextButton color='danger' isDisabled={!status} label='Stop' onPointerUp={mount.stopRemoteControl} startContent={<Icons.Stop />} />
			<TextButton color='primary' isDisabled={!host || !!status} label='Connect' onPointerUp={mount.startRemoteControl} startContent={<Icons.Connect />} />
		</>
	)
})
