import { Button, Checkbox, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { useModal } from '@/shared/hooks'
import { PlateSolverMolecule } from '@/shared/molecules'
import { DeclinationInput } from './DeclinationInput'
import { PlateSolverSelect } from './PlateSolverSelect'
import { RightAscensionInput } from './RightAscensionInput'

export const PlateSolver = memo(() => {
	const solver = useMolecule(PlateSolverMolecule)
	const { request, loading } = useSnapshot(solver.state)
	const { info } = useSnapshot(solver.viewer.state)
	const modal = useModal(() => (solver.state.showModal = false))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[390px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-col gap-0'>
							<span>Plate Solver</span>
							<span className='text-xs font-normal text-gray-400'>{info.originalPath}</span>
						</ModalHeader>
						<ModalBody>
							<div className='mt-2 grid grid-cols-12 gap-2'>
								<PlateSolverSelect className='col-span-8' onValueChange={(value) => solver.update('type', value)} value={request.type} />
								<Checkbox className='col-span-3 col-end-13' isSelected={request.blind} onValueChange={(value) => solver.update('blind', value)}>
									Blind
								</Checkbox>
								<RightAscensionInput className='col-span-4' isDisabled={request.blind} onValueChange={(value) => solver.update('ra', value)} value={request.ra} />
								<DeclinationInput className='col-span-4' isDisabled={request.blind} onValueChange={(value) => solver.update('dec', value)} value={request.dec} />
								<NumberInput className='col-span-4' isDisabled={request.blind} label='Radius (°)' maxValue={360} minValue={0} onValueChange={(value) => solver.update('radius', value)} size='sm' step={0.1} value={request.radius ?? 4} />
								<NumberInput className='col-span-6' label='Focal Length (mm)' maxValue={100000} minValue={0} onValueChange={(value) => solver.update('focalLength', value)} size='sm' value={request.focalLength} />
								<NumberInput className='col-span-6' label='Pixel size (µm)' maxValue={1000} minValue={0} onValueChange={(value) => solver.update('pixelSize', value)} size='sm' step={0.01} value={request.pixelSize} />
								<div className='col-span-full font-bold text-sm my-1'>SOLUTION</div>
								<RightAscensionInput className='col-span-4' isReadOnly value={info.solution?.rightAscension} />
								<DeclinationInput className='col-span-4' isReadOnly value={info.solution?.declination} />
								<Input className='col-span-4' isReadOnly label='Orientation (°)' size='sm' value={info.solution?.orientation.toFixed(4) ?? '0.0000'} />
								<Input className='col-span-4' isReadOnly label='Scale (arcsec/px)' size='sm' value={info.solution?.scale.toFixed(4) ?? '0.0000'} />
								<Input className='col-span-4' isReadOnly label='Size (arcmin)' size='sm' value={`${info.solution?.width.toFixed(2) ?? '0.00'} x ${info.solution?.height.toFixed(2) ?? '0.00'}`} />
								<Input className='col-span-4' isReadOnly label='Radius (°)' size='sm' value={info.solution?.radius.toFixed(4) ?? '0.0000'} />
								<div className='col-span-full flex items-center justify-center gap-2'>
									<Button color='primary' startContent={<Lucide.RefreshCw />} variant='flat'>
										Sync
									</Button>
									<Button color='success' startContent={<Lucide.Telescope />} variant='flat'>
										Go To
									</Button>
									<Button color='success' startContent={<Lucide.Telescope />} variant='flat'>
										Slew
									</Button>
									<Button color='secondary' startContent={<Lucide.Scan />} variant='flat'>
										Frame
									</Button>
								</div>
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='danger' isDisabled={!loading} onPointerUp={() => solver.stop()} startContent={<Tabler.IconPlayerStopFilled />} variant='flat'>
								Stop
							</Button>
							<Button color='success' isLoading={loading} onPointerUp={() => solver.start()} startContent={<Lucide.Sigma />} variant='flat'>
								Solve
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
