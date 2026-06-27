import { formatDEC, formatRA, toArcmin, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { memo, useContext } from 'react'
import type { PlateSolveStart } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { IconButton } from './components/IconButton'
import { NumberInput } from './components/NumberInput'
import { TextInput } from './components/TextInput'
import { MountDropdown } from './DeviceDropdown'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { PlateSolverSelect } from './PlateSolverSelect'
import { PlateSolveStartPopover } from './PlateSolveStartPopover'

function hasPositiveFiniteValue(value: number) {
	return Number.isFinite(value) && value > 0
}

function hasTextValue(value: unknown) {
	return String(value).trim().length > 0
}

function canStartSolve(request: Readonly<PlateSolveStart>, hasImageInfo: boolean) {
	if (!hasImageInfo || !hasPositiveFiniteValue(request.focalLength) || !hasPositiveFiniteValue(request.pixelSize)) return false
	if (request.blind) return true
	return hasPositiveFiniteValue(request.radius) && hasTextValue(request.rightAscension) && hasTextValue(request.declination)
}

function formatSolutionField(value: number | undefined, converter: (value: number) => number, fractionDigits: number) {
	if (value === undefined || !Number.isFinite(value)) return '--'
	return converter(value).toFixed(fractionDigits)
}

function formatSolutionCoordinate(value: number | undefined, formatter: (value: number) => string) {
	if (value === undefined || !Number.isFinite(value)) return '--'
	return formatter(value)
}

function formatSolutionSize(width: number | undefined, height: number | undefined) {
	if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height)) return '--'
	return `${toArcmin(width).toFixed(2)} x ${toArcmin(height).toFixed(2)}`
}

export const ImageSolver = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { solver } = viewer
	const { show } = useSnapshot(solver.state)

	if (!show) return null

	return (
		<Modal footer={<Footer />} header="Plate Solver" id={`platesolver-${viewer.image.id}`} initialWidth="360px" onHide={solver.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<Inputs />
		<Solution />
	</div>
))

const Inputs = memo(() => {
	const { solver } = useContext(ImageViewerStoreContext)
	const { loading } = useSnapshot(solver.state)
	const { blind, type, radius, focalLength, pixelSize } = useSnapshot(solver.state.request)
	const { rightAscension, declination } = useSnapshot(solver.state.request)
	const coordinateDisabled = loading || blind

	return (
		<>
			<PlateSolverSelect className="col-span-8 min-w-0" disabled={loading} endContent={<PlateSolverSelectEndContent />} onValueChange={(value) => solver.update('type', value)} value={type} />
			<Checkbox className="col-span-3 col-end-13 min-w-0" disabled={loading} label="Blind" onValueChange={(value) => solver.update('blind', value)} value={blind} />
			<TextInput className="col-span-4 min-w-0" disabled={coordinateDisabled} label="RA" onValueChange={(value) => solver.update('rightAscension', value)} value={String(rightAscension)} />
			<TextInput className="col-span-4 min-w-0" disabled={coordinateDisabled} label="DEC" onValueChange={(value) => solver.update('declination', value)} value={String(declination)} />
			<NumberInput className="col-span-4 min-w-0" disabled={coordinateDisabled} fractionDigits={1} label="Radius (°)" maxValue={360} minValue={0} onValueChange={(value) => solver.update('radius', value)} step={0.1} value={radius ?? 4} />
			<NumberInput className="col-span-6 min-w-0" disabled={loading} label="Focal Length (mm)" maxValue={100000} minValue={0} onValueChange={(value) => solver.update('focalLength', value)} value={focalLength} />
			<NumberInput className="col-span-6 min-w-0" disabled={loading} fractionDigits={2} label="Pixel size (µm)" maxValue={1000} minValue={0} onValueChange={(value) => solver.update('pixelSize', value)} step={0.01} value={pixelSize} />
		</>
	)
})

const PlateSolverSelectEndContent = memo(() => {
	const { solver } = useContext(ImageViewerStoreContext)
	const { loading } = useSnapshot(solver.state)
	const { type, radius, focalLength, pixelSize } = useSnapshot(solver.state.request)

	return <PlateSolveStartPopover disabled={loading} focalLength={focalLength} onValueChange={solver.update} pixelSize={pixelSize} radius={radius} type={type} />
})

const Solution = memo(() => {
	const { solver } = useContext(ImageViewerStoreContext)
	const { loading, solution } = useSnapshot(solver.state)
	const hasSolution = solution !== undefined

	return (
		<>
			<div className="col-span-full my-1 text-sm font-bold">SOLUTION</div>
			<TextInput className="col-span-4 min-w-0" label="RA (J2000)" readOnly value={formatSolutionCoordinate(solution?.rightAscension, formatRA)} />
			<TextInput className="col-span-4 min-w-0" label="DEC (J2000)" readOnly value={formatSolutionCoordinate(solution?.declination, formatDEC)} />
			<TextInput className="col-span-4 min-w-0" label="Orientation (°)" readOnly value={formatSolutionField(solution?.orientation, toDeg, 4)} />
			<TextInput className="col-span-4 min-w-0" label="Scale (arcsec/px)" readOnly value={formatSolutionField(solution?.scale, toArcsec, 4)} />
			<TextInput className="col-span-4 min-w-0" label="Size (arcmin)" readOnly value={formatSolutionSize(solution?.width, solution?.height)} />
			<TextInput className="col-span-4 min-w-0" label="Radius (°)" readOnly value={formatSolutionField(solution?.radius, toDeg, 4)} />
			<div className="col-span-full flex items-center justify-center gap-2">
				<MountDropdown color="primary" disabled={loading || !hasSolution} disallowNoneSelection icon={Icons.Sync} onValueChange={solver.sync} tooltipContent="Sync" variant="flat" />
				<MountDropdown color="success" disabled={loading || !hasSolution} disallowNoneSelection onValueChange={solver.goTo} tooltipContent="Go" variant="flat" />
				<IconButton color="secondary" disabled={loading || !hasSolution} icon={Icons.Image} onClick={solver.frame} tooltipContent="Frame" variant="flat" />
			</div>
		</>
	)
})

const Footer = memo(() => {
	const { solver } = useContext(ImageViewerStoreContext)
	const { info } = useSnapshot(solver.viewer.state)
	const { loading } = useSnapshot(solver.state)
	const request = useSnapshot(solver.state.request)
	const canSolve = canStartSolve(request, info !== undefined)

	return (
		<>
			<Button color="danger" disabled={!loading} label="Stop" onClick={solver.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={!canSolve} label="Solve" loading={loading} onClick={solver.start} startContent={<Icons.Sigma />} />
		</>
	)
})
