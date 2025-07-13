import { Button, Checkbox, Input, NumberInput } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { formatDEC, formatRA, toArcmin, toArcsec, toDeg } from 'nebulosa/src/angle'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSolverMolecule } from '@/molecules/image/solver'
import { Modal } from './Modal'
import { PlateSolverSelect } from './PlateSolverSelect'

export const PlateSolver = memo(() => {
	const solver = useMolecule(ImageSolverMolecule)
	const { viewer } = solver
	const { request, loading, solution } = useSnapshot(solver.state)
	const { info } = useSnapshot(viewer.state)

	return (
		<Modal
			footer={
				<>
					<Button color='danger' isDisabled={!loading} onPointerUp={solver.stop} startContent={<Tabler.IconPlayerStopFilled size={18} />} variant='flat'>
						Stop
					</Button>
					<Button color='success' isLoading={loading} onPointerUp={solver.start} startContent={<Lucide.Sigma size={18} />} variant='flat'>
						Solve
					</Button>
				</>
			}
			header={
				<div className='w-full flex flex-col justify-center gap-0'>
					<span>Plate Solver</span>
					<span className='text-xs font-normal text-gray-400 max-w-full'>{info.originalPath}</span>
				</div>
			}
			name={`plate-solver-${solver.scope.image.key}`}
			onClose={() => viewer.closeModal('plateSolver')}>
			<div className='max-w-[330px] mt-0 grid grid-cols-12 gap-2'>
				<PlateSolverSelect className='col-span-8' onValueChange={(value) => solver.update('type', value)} value={request.type} />
				<Checkbox className='col-span-3 col-end-13' isSelected={request.blind} onValueChange={(value) => solver.update('blind', value)}>
					Blind
				</Checkbox>
				<Input className='col-span-4' isDisabled={request.blind} label='RA' onValueChange={(value) => solver.update('rightAscension', value)} size='sm' value={request.rightAscension} />
				<Input className='col-span-4' isDisabled={request.blind} label='DEC' onValueChange={(value) => solver.update('declination', value)} size='sm' value={request.declination} />
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
					<Button color='primary' isDisabled={!solution} startContent={<Lucide.RefreshCw size={18} />} variant='flat'>
						Sync
					</Button>
					<Button color='success' isDisabled={!solution} startContent={<Lucide.Telescope size={18} />} variant='flat'>
						Go To
					</Button>
					<Button color='success' isDisabled={!solution} startContent={<Lucide.Telescope size={18} />} variant='flat'>
						Slew
					</Button>
					<Button color='secondary' isDisabled={!solution} startContent={<Lucide.Scan size={18} />} variant='flat'>
						Frame
					</Button>
				</div>
			</div>
		</Modal>
	)
})
