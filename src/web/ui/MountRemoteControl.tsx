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
	const { status } = useSnapshot(mount.state.remoteControl)
	const { protocol, host, port } = useSnapshot(mount.state.remoteControl.request, { sync: true })

	const Footer = (
		<>
			<TextButton color='primary' isDisabled={!host || !!status[protocol]} label='Connect' onPointerUp={mount.startRemoteControl} startContent={<Icons.Connect />} />
			<TextButton color='danger' isDisabled={!status[protocol]} label='Stop' onPointerUp={mount.stopRemoteControl} startContent={<Icons.Stop />} />
		</>
	)

	return (
		<Modal footer={Footer} header='Remote Control' maxWidth='240px' name={`mount-remote-control-${mount.scope.mount.name}`} onHide={mount.hideRemoteControl}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<MountRemoteControlProtocolSelect className='col-span-full' onValueChange={(value) => mount.updateRemoteControl('protocol', value)} value={protocol} />
				<Input className='col-span-7' isDisabled={!!status[protocol]} label='Host' onValueChange={(value) => mount.updateRemoteControl('host', value)} size='sm' value={status[protocol] ? status[protocol].host : host} />
				<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={!!status[protocol]} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => mount.updateRemoteControl('port', value)} size='sm' value={status[protocol] ? status[protocol].port : port} />
			</div>
		</Modal>
	)
})
