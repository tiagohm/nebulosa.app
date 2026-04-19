import { Input } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatDEC, formatRA, toArcmin, toArcsec, toDeg } from 'nebulosa/src/angle'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSolverMolecule } from '@/molecules/image/solver'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { NumberInput } from './components/NumberInput'
import { MountDropdown } from './DeviceDropdown'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'
import { PlateSolverSelect } from './PlateSolverSelect'
import { PlateSolveStartPopover } from './PlateSolveStartPopover'

export const ImageSolver = memo(() => {
	const solver = useMolecule(ImageSolverMolecule)

	return (
		<Modal footer={<Footer />} header='Plate Solver' id={`plate-solver-${solver.viewer.storageKey}`} maxWidth='360px' onHide={solver.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Inputs />
			<Solution />
		</div>
	)
})

const Inputs = memo(() => {
	const solver = useMolecule(ImageSolverMolecule)
	const { blind, type, radius, focalLength, pixelSize } = useSnapshot(solver.state.request)
	const { rightAscension, declination } = useSnapshot(solver.state.request, { sync: true })

	return (
		<>
			<PlateSolverSelect className='col-span-8' endContent={<PlateSolverSelectEndContent />} onValueChange={(value) => solver.update('type', value)} value={type} />
			<Checkbox className='col-span-3 col-end-13' label='Blind' onValueChange={(value) => solver.update('blind', value)} value={blind} />
			<Input className='col-span-4' isDisabled={blind} label='RA' onValueChange={(value) => solver.update('rightAscension', value)} size='sm' value={rightAscension.toString()} />
			<Input className='col-span-4' isDisabled={blind} label='DEC' onValueChange={(value) => solver.update('declination', value)} size='sm' value={declination.toString()} />
			<NumberInput className='col-span-4' disabled={blind} fractionDigits={1} label='Radius (°)' maxValue={360} minValue={0} onValueChange={(value) => solver.update('radius', value)} step={0.1} value={radius ?? 4} />
			<NumberInput className='col-span-6' label='Focal Length (mm)' maxValue={100000} minValue={0} onValueChange={(value) => solver.update('focalLength', value)} value={focalLength} />
			<NumberInput className='col-span-6' fractionDigits={2} label='Pixel size (µm)' maxValue={1000} minValue={0} onValueChange={(value) => solver.update('pixelSize', value)} step={0.01} value={pixelSize} />
		</>
	)
})

const PlateSolverSelectEndContent = memo(() => {
	const solver = useMolecule(ImageSolverMolecule)
	const { type, radius, focalLength, pixelSize } = useSnapshot(solver.state.request)

	return <PlateSolveStartPopover focalLength={focalLength} onValueChange={solver.update} pixelSize={pixelSize} radius={radius} type={type} />
})

const Solution = memo(() => {
	const solver = useMolecule(ImageSolverMolecule)
	const { solution } = useSnapshot(solver.state)

	return (
		<>
			<div className='col-span-full font-bold text-sm my-1'>SOLUTION</div>
			<Input className='col-span-4' isReadOnly label='RA (J2000)' size='sm' value={formatRA(solution?.rightAscension ?? 0)} />
			<Input className='col-span-4' isReadOnly label='DEC (J2000)' size='sm' value={formatDEC(solution?.declination ?? 0)} />
			<Input className='col-span-4' isReadOnly label='Orientation (°)' size='sm' value={toDeg(solution?.orientation ?? 0).toFixed(4)} />
			<Input className='col-span-4' isReadOnly label='Scale (arcsec/px)' size='sm' value={toArcsec(solution?.scale ?? 0).toFixed(4)} />
			<Input className='col-span-4' isReadOnly label='Size (arcmin)' size='sm' value={`${toArcmin(solution?.width ?? 0).toFixed(2)} x ${toArcmin(solution?.height ?? 0).toFixed(2)}`} />
			<Input className='col-span-4' isReadOnly label='Radius (°)' size='sm' value={toDeg(solution?.radius ?? 0).toFixed(4)} />
			<div className='col-span-full flex items-center justify-center gap-2'>
				<MountDropdown color='primary' disallowNoneSelection icon={Icons.Sync} isDisabled={!solution} onValueChange={solver.sync} tooltipContent='Sync' variant='flat' />
				<MountDropdown color='success' disallowNoneSelection isDisabled={!solution} onValueChange={solver.goTo} tooltipContent='Go' variant='flat' />
				<IconButton color='secondary' disabled={!solution} icon={Icons.Image} onPointerUp={solver.frame} tooltipContent='Frame' variant='flat' />
			</div>
		</>
	)
})

const Footer = memo(() => {
	const solver = useMolecule(ImageSolverMolecule)
	const { loading } = useSnapshot(solver.state)

	return (
		<>
			<Button color='danger' disabled={!loading} label='Stop' onPointerUp={solver.stop} startContent={<Icons.Stop />} />
			<Button color='success' label='Solve' loading={loading} onPointerUp={solver.start} startContent={<Icons.Sigma />} />
		</>
	)
})
