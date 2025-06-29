import { Button, Checkbox, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { formatDEC, formatRA, toArcmin, toArcsec, toDeg } from 'nebulosa/src/angle'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSolverMolecule } from '@/molecules/image/solver'
import { useModal } from '@/shared/hooks'
import { DeclinationInput } from './DeclinationInput'
import { PlateSolverSelect } from './PlateSolverSelect'
import { RightAscensionInput } from './RightAscensionInput'

export const PlateSolver = memo(() => {
	const solver = useMolecule(ImageSolverMolecule)
	const { viewer } = solver
	const { request, loading, solution } = useSnapshot(solver.state)
	const { info } = useSnapshot(viewer.state)
	const modal = useModal(() => viewer.closeModal('plateSolver'))

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[370px] max-h-[90vh]', wrapper: 'pointer-events-none' }}>
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
								<Input className='col-span-4' isReadOnly label='RA' size='sm' value={formatRA(solution?.rightAscension ?? 0)} />
								<Input className='col-span-4' isReadOnly label='DEC' size='sm' value={formatDEC(solution?.declination ?? 0)} />
								<Input className='col-span-4' isReadOnly label='Orientation (°)' size='sm' value={toDeg(solution?.orientation ?? 0).toFixed(4)} />
								<Input className='col-span-4' isReadOnly label='Scale (arcsec/px)' size='sm' value={toArcsec(solution?.scale ?? 0).toFixed(4)} />
								<Input className='col-span-4' isReadOnly label='Size (arcmin)' size='sm' value={`${toArcmin(solution?.width ?? 0).toFixed(2)} x ${toArcmin(solution?.height ?? 0).toFixed(2)}`} />
								<Input className='col-span-4' isReadOnly label='Radius (°)' size='sm' value={toDeg(solution?.radius ?? 0).toFixed(4)} />
								<div className='col-span-full flex items-center justify-center gap-2'>
									<Button color='primary' isDisabled={!solution} startContent={<Lucide.RefreshCw size={16} />} variant='flat'>
										Sync
									</Button>
									<Button color='success' isDisabled={!solution} startContent={<Lucide.Telescope size={16} />} variant='flat'>
										Go To
									</Button>
									<Button color='success' isDisabled={!solution} startContent={<Lucide.Telescope size={16} />} variant='flat'>
										Slew
									</Button>
									<Button color='secondary' isDisabled={!solution} startContent={<Lucide.Scan size={16} />} variant='flat'>
										Frame
									</Button>
								</div>
							</div>
						</ModalBody>
						<ModalFooter {...modal.moveProps}>
							<Button color='danger' isDisabled={!loading} onPointerUp={solver.stop} startContent={<Tabler.IconPlayerStopFilled size={16} />} variant='flat'>
								Stop
							</Button>
							<Button color='success' isLoading={loading} onPointerUp={solver.start} startContent={<Lucide.Sigma size={16} />} variant='flat'>
								Solve
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</Modal>
	)
})
