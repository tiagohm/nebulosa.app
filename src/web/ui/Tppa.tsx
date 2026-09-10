import { useStore } from '@hooks/store.hook'
import { CameraCaptureStoreContext, PlateSolverStoreContext, TppaStoreContext } from '@shared/context'
import { tw } from '@shared/util'
import { tppaStore } from '@stores/tppa.store'
import { CameraCaptureStartPopover } from '@ui/CameraCaptureStartPopover'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { Chip } from '@ui/components/Chip'
import { NumberInput } from '@ui/components/NumberInput'
import { CameraDropdown, MountDropdown } from '@ui/DeviceDropdown'
import { Icons } from '@ui/Icon'
import { PlateSolverTypeSelect } from '@ui/PlateSolverTypeSelect'
import { PlateSolveStartPopover } from '@ui/PlateSolveStartPopover'
import { TppaDirectionSelect } from '@ui/TppaDirectionSelect'
import type { IDockviewPanelProps } from 'dockview-react'
import { arcsec, formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import type { PolarAlignmentOverlayWarning, ThreePointPolarAlignmentOverlayFailureReason } from 'nebulosa/src/observation/alignment/polaralignment.overlay'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

export const Tppa = memo(({ api }: IDockviewPanelProps) => {
	const tppa = useStore(() => tppaStore(api), [api.id])

	return (
		<TppaStoreContext value={tppa}>
			<div className="grid grid-cols-12 gap-2 p-3">
				<CameraAndMount />
				<Status />
				<Inputs />
				<Result />
				<OverlayOptions />
				<Footer />
			</div>
		</TppaStoreContext>
	)
})

const CameraAndMount = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { camera, mount, running } = useSnapshot(tppa.state)

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-center gap-2">
			<CameraDropdown showLabel disabled={running} value={camera} onValueChange={(value) => (tppa.state.camera = value)} startContent={<CameraDropdownEndContent />} />
			<MountDropdown showLabel disabled={running} value={mount} onValueChange={(value) => (tppa.state.mount = value)} />
		</div>
	)
})

const Status = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { event } = useSnapshot(tppa.state)
	const { state, solved, solver } = event
	const color = state === 'idle' ? 'default' : state === 'capturing' || state === 'solving' ? 'primary' : state === 'waiting' || state === 'settling' ? 'warning' : state === 'aligning' ? 'success' : 'secondary'

	return (
		<div className="col-span-full mt-2 flex flex-row items-center justify-between">
			<Chip color={color} size="sm">
				{state}
			</Chip>
			<div className="flex flex-row items-center gap-1">
				<Chip color="warning" size="sm">
					Step: {event.step}
				</Chip>
				<Chip color={solved ? 'success' : 'danger'} size="sm">
					RA: {formatRA(solver.rightAscension)}
				</Chip>
				<Chip color={solved ? 'success' : 'danger'} size="sm">
					DEC: {formatDEC(solver.declination)}
				</Chip>
			</div>
		</div>
	)
})

const Inputs = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { running } = useSnapshot(tppa.state)
	const { direction, moveDuration, compensateRefraction, maxAttempts, delayBeforeCapture } = useSnapshot(tppa.state.request)
	const { type } = useSnapshot(tppa.state.request.solver)

	return (
		<>
			<PlateSolverTypeSelect className="col-span-6" disabled={running} endContent={<PlateSolverSelectEndContent />} onValueChange={tppa.solver.setType} value={type} />
			<NumberInput className="col-span-3" disabled={running} label="Move for (s)" maxValue={60} minValue={1} onValueChange={tppa.setMoveDuration} value={moveDuration} />
			<TppaDirectionSelect className="col-span-3" disabled={running} onValueChange={tppa.setDirection} value={direction} />
			<NumberInput className="col-span-4" disabled={running} label="Max attempts" maxValue={30} minValue={3} onValueChange={tppa.setMaxAttempts} value={maxAttempts} />
			<NumberInput className="col-span-5" disabled={running} label="Delay before capture (s)" maxValue={120} minValue={0} onValueChange={tppa.setDelayBeforeCapture} value={delayBeforeCapture} />
			<Checkbox className="col-span-full" disabled={running} label="Compensate refraction" onValueChange={tppa.setCompensateRefraction} value={compensateRefraction} />
		</>
	)
})

const PlateSolverSelectEndContent = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { running } = useSnapshot(tppa.state)

	return (
		<PlateSolverStoreContext value={tppa.solver}>
			<PlateSolveStartPopover disabled={running} />
		</PlateSolverStoreContext>
	)
})

const POOR_ERROR = arcsec(300)
const FAIR_ERROR = arcsec(30)
const GOOD_ERROR = arcsec(1)

const Result = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { event } = useSnapshot(tppa.state)

	const total = Math.hypot(event.error.azimuth, event.error.altitude)

	return (
		<>
			<div className="col-span-4 mt-3 flex flex-col items-center gap-0">
				<span className="font-bold">Azimuth</span>
				<span className="text-3xl">{formatDEC(event.error.azimuth)}</span>
			</div>
			<div className={tw('col-span-4 mt-3 flex flex-col items-center gap-0', total <= 0 ? 'text-neutral-500' : total <= GOOD_ERROR ? 'text-green-500' : total <= FAIR_ERROR ? 'text-yellow-500' : total <= POOR_ERROR ? 'text-orange-500' : 'text-red-500')}>
				<span className="font-bold">Total</span>
				<span className="text-3xl">{formatDEC(total)}</span>
			</div>
			<div className="col-span-4 mt-3 flex flex-col items-center gap-0">
				<span className="font-bold">Altitude</span>
				<span className="text-3xl">{formatDEC(event.error.altitude)}</span>
			</div>
		</>
	)
})

// User-facing explanations of nonfatal geometry limitations; they never replace the run's status.
const OVERLAY_DIAGNOSTICS: Record<PolarAlignmentOverlayWarning | ThreePointPolarAlignmentOverlayFailureReason, string> = {
	invalidOptions: 'Overlay settings are unavailable',
	invalidFrame: 'Image dimensions are unavailable',
	invalidWcs: 'The plate solution has no usable image projection',
	missingLocation: 'Observing location is unavailable',
	invalidPole: 'The mount pole could not be determined',
	invalidReference: 'The reference coordinate is unavailable',
	unprojectableReference: 'The reference is outside the projectable sky',
	unprojectableTarget: 'The target is outside the projectable sky',
	degenerateCorrection: 'The correction geometry is unstable',
	correctionNotConverged: 'The correction is approximate',
	correctionIllConditioned: 'The correction geometry is unstable',
	referenceOutsideFrame: 'The reference is outside the image',
	contourOmitted: 'Some tolerance contours are unavailable',
	contourIllConditioned: 'Some tolerance contours are unstable',
}

function WarningItem(item: PolarAlignmentOverlayWarning) {
	return (
		<span className="text-warning text-xs" key={item}>
			{OVERLAY_DIAGNOSTICS[item]}
		</span>
	)
}

// Visibility remains editable while running; colors and tolerance units match the SVG guidance.
const OverlayOptions = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { show } = useSnapshot(tppa.state.overlay)
	const { overlay } = useSnapshot(tppa.state.event)

	const result = overlay?.result
	const warnings = result?.success ? result.overlay.diagnostics.warnings : result?.warnings

	return (
		<div className="col-span-full flex flex-col gap-1">
			<Checkbox label="Show overlay" value={show} onValueChange={tppa.setShowOverlay} />
			{result && !result.success && <span className="text-warning text-xs">{OVERLAY_DIAGNOSTICS[result.reason]}</span>}
			{warnings?.map(WarningItem)}
		</div>
	)
})

const Footer = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { running, camera, mount } = useSnapshot(tppa.state)

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="danger" disabled={!running} label="Stop" onClick={tppa.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={running || !camera?.connected || !mount?.connected} label="Start" loading={running} onClick={tppa.start} startContent={<Icons.Play />} />
		</div>
	)
})

const CameraDropdownEndContent = memo(() => {
	const tppa = useContext(TppaStoreContext)
	const { camera } = useSnapshot(tppa.state)

	return (
		camera && (
			<CameraCaptureStoreContext value={tppa.capture}>
				<CameraCaptureStartPopover camera={camera} mode="tppa" />
			</CameraCaptureStoreContext>
		)
	)
})
