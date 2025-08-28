import { Button, Input, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { MountMolecule } from '@/molecules/indi/mount'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { MountRemoteControlProtocolSelect } from './MountRemoteControlProtocolSelect'

export const MountRemoteControl = memo(() => {
	const mount = useMolecule(MountMolecule)
	const { status } = useSnapshot(mount.state.remoteControl)
	const { protocol, host, port } = useSnapshot(mount.state.remoteControl.request, { sync: true })

	return (
		<Modal header='Remote Control' maxWidth='240px' name={`mount-remote-control-${mount.scope.mount.name}`} onClose={mount.closeRemoteControl}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<MountRemoteControlProtocolSelect className='col-span-full' onValueChange={(value) => mount.updateRemoteControl('protocol', value)} value={protocol} />
				<Input className='col-span-7' label='Host' onValueChange={(value) => mount.updateRemoteControl('host', value)} size='sm' value={host} />
				<NumberInput className='col-span-5' formatOptions={INTEGER_NUMBER_FORMAT} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => mount.updateRemoteControl('port', value)} size='sm' value={port} />
				<div className='col-span-full justify-center flex items-center'>
					<Button color='primary' isDisabled={!host || status[protocol] !== false} onPointerUp={mount.startRemoteControl} variant='light'>
						<Icons.Connect /> Connect
					</Button>
					<Button color='danger' isDisabled={!status[protocol]} onPointerUp={mount.stopRemoteControl} variant='light'>
						<Icons.Stop /> Stop
					</Button>
				</div>
			</div>
		</Modal>
	)
})
