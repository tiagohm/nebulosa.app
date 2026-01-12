import { Checkbox, Input, NumberInput, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatDEC, formatRA, toArcmin, toArcsec, toDeg } from 'nebulosa/src/angle'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageSolverMolecule } from '@/molecules/image/solver'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { MountDropdown } from './DeviceDropdown'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'
import { PlateSolverSelect } from './PlateSolverSelect'
import { PlateSolveStartPopover } from './PlateSolveStartPopover'
import { TextButton } from './TextButton'

export const ImageSolver = memo(() => {
	const solver = useMolecule(ImageSolverMolecule)
	const { loading, solution } = useSnapshot(solver.state)
	const { blind, type, rightAscension, declination, radius, focalLength, pixelSize } = useSnapshot(solver.state.request, { sync: true })

	const Footer = (
		<>
			<TextButton color='danger' isDisabled={!loading} label='Stop' onPointerUp={solver.stop} startContent={<Icons.Stop />} />
			<TextButton color='success' isLoading={loading} label='Solve' onPointerUp={solver.start} startContent={<Icons.Sigma />} />
		</>
	)

	return (
		<Modal footer={Footer} header='Plate Solver' id={`plate-solver-${solver.scope.image.key}`} maxWidth='363px' onHide={solver.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<PlateSolverSelect className='col-span-8' endContent={<PlateSolverSelectEndContent />} onValueChange={(value) => solver.update('type', value)} value={type} />
				<Checkbox className='col-span-3 col-end-13' isSelected={blind} onValueChange={(value) => solver.update('blind', value)}>
					Blind
				</Checkbox>
				<Input className='col-span-4' isDisabled={blind} label='RA' onValueChange={(value) => solver.update('rightAscension', value)} size='sm' value={rightAscension.toString()} />
				<Input className='col-span-4' isDisabled={blind} label='DEC' onValueChange={(value) => solver.update('declination', value)} size='sm' value={declination.toString()} />
				<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={blind} label='Radius (°)' maxValue={360} minValue={0} onValueChange={(value) => solver.update('radius', value)} size='sm' step={0.1} value={radius ?? 4} />
				<NumberInput className='col-span-6' formatOptions={INTEGER_NUMBER_FORMAT} label='Focal Length (mm)' maxValue={100000} minValue={0} onValueChange={(value) => solver.update('focalLength', value)} size='sm' value={focalLength} />
				<NumberInput className='col-span-6' formatOptions={DECIMAL_NUMBER_FORMAT} label='Pixel size (µm)' maxValue={1000} minValue={0} onValueChange={(value) => solver.update('pixelSize', value)} size='sm' step={0.01} value={pixelSize} />
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
					<Tooltip content='Frame' placement='bottom' showArrow>
						<IconButton color='secondary' icon={Icons.Image} isDisabled={!solution} onPointerUp={solver.frame} variant='flat' />
					</Tooltip>
				</div>
			</div>
		</Modal>
	)
})

const PlateSolverSelectEndContent = memo(() => {
	const solver = useMolecule(ImageSolverMolecule)
	const { type, radius, focalLength, pixelSize } = useSnapshot(solver.state.request, { sync: true })

	return <PlateSolveStartPopover focalLength={focalLength} onValueChange={solver.update} pixelSize={pixelSize} radius={radius} type={type} />
})
