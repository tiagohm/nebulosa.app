import { NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatDEC } from 'nebulosa/src/angle'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { TppaMolecule } from '@/molecules/tppa'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { CameraDropdown } from './CameraDropdown'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'
import { MountDropdown } from './MountDropdown'
import { PlateSolverSelect } from './PlateSolverSelect'
import { TextButton } from './TextButton'
import { TppaDirectionSelect } from './TppaDirectionSelect'

export const Tppa = memo(() => {
	const tppa = useMolecule(TppaMolecule)
	const { running, camera, mount, event } = useSnapshot(tppa.state)
	const { direction, moveDuration, settleDuration } = useSnapshot(tppa.state.request, { sync: true })
	const solver = useSnapshot(tppa.state.request.solver, { sync: true })

	const Footer = (
		<>
			<TextButton color='danger' isDisabled={!running} label='Stop' onPointerUp={tppa.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={!camera?.connected || !mount?.connected} isLoading={running} label='Start' onPointerUp={tppa.start} startContent={<Icons.Play />} />
		</>
	)

	const CameraDropdownEndContent = <IconButton color={camera?.connected ? 'success' : 'danger'} icon={Icons.Cog} onPointerUp={alert} />

	return (
		<Modal footer={Footer} header='Three-Point Polar Alignment' maxWidth='363px' name='tppa' onHide={tppa.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-full flex flex-row justify-center items-center gap-2'>
					<CameraDropdown buttonProps={{ endContent: camera && CameraDropdownEndContent }} isDisabled={running} onValueChange={(value) => (tppa.state.camera = value)} showLabelOnEmpty value={camera} />
					<MountDropdown isDisabled={running} onValueChange={(value) => (tppa.state.mount = value)} value={mount} />
				</div>
				<PlateSolverSelect className='col-span-5' onValueChange={(value) => tppa.updateSolver('type', value)} value={solver.type} />
				<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} label='Duration(s)' maxValue={60} minValue={1} onValueChange={(value) => tppa.update('moveDuration', value)} size='sm' value={moveDuration} />
				<TppaDirectionSelect className='col-span-3' onValueChange={(value) => tppa.update('direction', value)} value={direction} />
				<div className='col-span-6 flex flex-col items-center gap-0 mt-3'>
					<span className='font-bold'>Azimuth</span>
					<span className='text-3xl'>{formatDEC(event.error.azimuth)}</span>
				</div>
				<div className='col-span-6 flex flex-col items-center gap-0 mt-3'>
					<span className='font-bold'>Altitude</span>
					<span className='text-3xl'>{formatDEC(event.error.altitude)}</span>
				</div>
			</div>
		</Modal>
	)
})
