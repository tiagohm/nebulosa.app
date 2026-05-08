import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { CartesianGrid, ComposedChart, Line, ReferenceDot, Scatter, XAxis, YAxis } from 'recharts'
import type { AutoFocusState } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { AutoFocusMolecule } from '@/molecules/autofocus'
import { AutoFocusFittingModeSelect } from './AutoFocusFittingModeSelect'
import { CameraCaptureStartPopover } from './CameraCaptureStartPopover'
import { Button } from './components/Button'
import { Checkbox } from './components/Checkbox'
import { Chip, type ChipProps } from './components/Chip'
import { NumberInput } from './components/NumberInput'
import { CameraDropdown, FocuserDropdown } from './DeviceDropdown'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { StarDetectionPopover } from './StarDetectionPopover'
import { StarDetectionSelect } from './StarDetectionSelect'

const AUTO_FOCUS_STATE_LABELS = {
	IDLE: 'idle',
	MOVING: 'moving',
	CAPTURING: 'capturing',
	COMPUTING: 'computing',
} satisfies Record<AutoFocusState, string>

const AUTO_FOCUS_STATE_COLORS = {
	IDLE: 'default',
	MOVING: 'secondary',
	CAPTURING: 'warning',
	COMPUTING: 'primary',
} satisfies Record<AutoFocusState, ChipProps['color']>

interface FocusChartPoint {
	readonly position: number
	readonly hfd: number
}

interface FocusPoint {
	readonly x: number
	readonly y: number
}

function isFiniteFocusPoint(point: FocusPoint | undefined): point is FocusPoint {
	return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y) && point.y > 0
}

function formatMetric(value: number, fractionDigits = 2) {
	return Number.isFinite(value) && value > 0 ? value.toFixed(fractionDigits) : '--'
}

function formatPosition(point: FocusPoint | undefined) {
	return isFiniteFocusPoint(point) ? point.x.toFixed(0) : '--'
}

function focusChartSamples(x: readonly number[], y: readonly number[]) {
	const length = Math.min(x.length, y.length)
	const samples: FocusChartPoint[] = []

	for (let i = 0; i < length; i++) {
		if (Number.isFinite(x[i]) && Number.isFinite(y[i]) && y[i] > 0) {
			samples.push({ position: x[i], hfd: y[i] })
		}
	}

	return samples
}

function focusCurve(points: readonly FocusPoint[] | undefined) {
	return points?.filter(isFiniteFocusPoint).map(({ x, y }) => ({ position: x, hfd: y })) ?? []
}

function focusChartDomain(points: readonly FocusChartPoint[], key: keyof FocusChartPoint): [number, number] {
	let min = Number.POSITIVE_INFINITY
	let max = Number.NEGATIVE_INFINITY

	for (const point of points) {
		const value = point[key]
		if (value < min) min = value
		if (value > max) max = value
	}

	if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]

	const padding = Math.max((max - min) * 0.08, key === 'hfd' ? 0.25 : 1)
	return [Math.max(0, min - padding), max + padding]
}

export const AutoFocus = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)

	return (
		<Modal footer={<Footer />} header="Auto Focus" id="autofocus" maxWidth="440px" onHide={autoFocus.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-2">
		<Devices />
		<Status />
		<Inputs />
		<FocusChart />
	</div>
))

const Devices = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { running, camera, focuser } = useSnapshot(autoFocus.state)

	return (
		<div className="col-span-full flex flex-row items-center justify-center gap-2">
			<CameraDropdown endContent={<CameraDropdownEndContent />} disabled={running} onValueChange={(value) => (autoFocus.state.camera = value)} showLabel value={camera} />
			<FocuserDropdown disabled={running} onValueChange={(value) => (autoFocus.state.focuser = value)} showLabel value={focuser} />
		</div>
	)
})

const Status = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { event } = useSnapshot(autoFocus.state)
	const { state, starCount, hfd, message, focusPoint } = event

	return (
		<div className="col-span-full mt-2 flex min-w-0 flex-col gap-2">
			<div className="flex min-w-0 flex-row flex-wrap items-center gap-1.5">
				<Chip color={AUTO_FOCUS_STATE_COLORS[state]} size="sm">
					{AUTO_FOCUS_STATE_LABELS[state]}
				</Chip>
				<Chip color="warning" size="sm">
					Stars: {starCount}
				</Chip>
				<Chip color="secondary" size="sm">
					HFD: {formatMetric(hfd)}
				</Chip>
				<Chip color="success" size="sm">
					Best: {formatPosition(focusPoint)}
				</Chip>
			</div>
			{message && <span className="min-w-0 truncate text-xs text-neutral-400">{message}</span>}
		</div>
	)
})

const Inputs = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { focuser, running } = useSnapshot(autoFocus.state)
	const { starDetection, initialOffsetSteps, stepSize, fittingMode, rmsdThreshold, reversed } = useSnapshot(autoFocus.state.request)
	const stepSizeMax = focuser?.connected ? Math.max(1, focuser.position.max - focuser.position.min) : undefined

	return (
		<>
			<StarDetectionSelect className="col-span-6" disabled={running} endContent={<StarDetectionSelectEndContent />} onValueChange={(value) => autoFocus.updateStarDetection('type', value)} value={starDetection.type} />
			<AutoFocusFittingModeSelect className="col-span-6" disabled={running} onValueChange={(value) => autoFocus.update('fittingMode', value)} value={fittingMode} />
			<NumberInput className="col-span-4" disabled={running} label="Offset steps" maxValue={1000} minValue={1} onValueChange={(value) => autoFocus.update('initialOffsetSteps', value)} value={initialOffsetSteps} />
			<NumberInput className="col-span-3" disabled={running || !focuser?.connected} label="Step size" maxValue={stepSizeMax} minValue={1} onValueChange={(value) => autoFocus.update('stepSize', value)} value={stepSize} />
			<NumberInput className="col-span-5" disabled={running} fractionDigits={2} label="RMSD threshold" maxValue={1} minValue={0} onValueChange={(value) => autoFocus.update('rmsdThreshold', value)} step={0.01} value={rmsdThreshold} />
			<Checkbox className="col-span-full" disabled={running} label="Reversed" onValueChange={(value) => autoFocus.update('reversed', value)} value={reversed} />
		</>
	)
})

const FocusChart = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { event } = useSnapshot(autoFocus.state)
	const samples = focusChartSamples(event.x, event.y)
	const left = focusCurve(event.left)
	const right = focusCurve(event.right)
	const parabolic = focusCurve(event.parabolic)
	const hyperbolic = focusCurve(event.hyperbolic)
	const focusPoint = isFiniteFocusPoint(event.focusPoint) ? event.focusPoint : undefined
	const focus = focusCurve(focusPoint ? [focusPoint] : undefined)
	const data = [...samples, ...left, ...right, ...parabolic, ...hyperbolic, ...focus]

	if (samples.length === 0) {
		return <div className="col-span-full flex h-36 items-center justify-center rounded-lg bg-neutral-900/70 text-xs text-neutral-500">No focus samples</div>
	}

	return (
		<div className="col-span-full h-36 min-w-0 rounded-lg bg-neutral-900/70 px-1 py-2">
			<ComposedChart height={128} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} responsive>
				<XAxis dataKey="position" domain={focusChartDomain(data, 'position')} fontSize={10} tickMargin={4} type="number" />
				<YAxis dataKey="hfd" domain={focusChartDomain(data, 'hfd')} fontSize={10} tickMargin={4} type="number" width={36} />
				<CartesianGrid stroke="rgb(255 255 255 / 0.08)" strokeDasharray="3 3" />
				<Line data={left} dataKey="hfd" dot={false} isAnimationActive={false} stroke="var(--warning)" strokeDasharray="4 3" strokeWidth={1.5} type="linear" />
				<Line data={right} dataKey="hfd" dot={false} isAnimationActive={false} stroke="var(--warning)" strokeDasharray="4 3" strokeWidth={1.5} type="linear" />
				<Line data={parabolic} dataKey="hfd" dot={false} isAnimationActive={false} stroke="var(--success)" strokeWidth={2} type="monotone" />
				<Line data={hyperbolic} dataKey="hfd" dot={false} isAnimationActive={false} stroke="var(--primary)" strokeWidth={2} type="monotone" />
				<Scatter data={samples} fill="var(--secondary)" isAnimationActive={false} />
				{focusPoint && <ReferenceDot fill="var(--danger)" r={4} stroke="transparent" x={focusPoint.x} y={focusPoint.y} />}
			</ComposedChart>
		</div>
	)
})

const Footer = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { running, camera, focuser } = useSnapshot(autoFocus.state)

	return (
		<>
			<Button color="danger" disabled={!running} label="Stop" onPointerUp={autoFocus.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={!camera?.connected || !focuser?.connected} label="Start" loading={running} onPointerUp={autoFocus.start} startContent={<Icons.Play />} />
		</>
	)
})

const CameraDropdownEndContent = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { camera } = useSnapshot(autoFocus.state)
	const { capture } = useSnapshot(autoFocus.state.request)

	return camera && <CameraCaptureStartPopover camera={camera} mode="autoFocus" onValueChange={autoFocus.updateCapture} value={capture} />
})

const StarDetectionSelectEndContent = memo(() => {
	const autoFocus = useMolecule(AutoFocusMolecule)
	const { starDetection } = useSnapshot(autoFocus.state.request)

	return <StarDetectionPopover onValueChange={autoFocus.updateStarDetection} value={starDetection} variant="ghost" />
})
