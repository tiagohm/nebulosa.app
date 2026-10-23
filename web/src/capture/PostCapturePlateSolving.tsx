import type { CaptureFrame, CapturePlateSolvingState, PlateSolveRequest, PostCapturePlateSolvingPolicy } from 'api'
import { toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { Actions, Notice } from '../equipment-control/parts'
import type { CameraRole } from '../equipment/roles'
import { AdvancedControls, HintControls, SolverControls, StrategyControls, useSolverConfigured } from '../platesolving/PlateSolveControls'
import { isActive, plateSolvingState, PROVIDER_LABELS, runPlateSolve } from '../platesolving/platesolving'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { activeProfile, plateSolvingSettings, profileState, setPlateSolvingSettings } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { formatDeclination, formatRightAscension } from '../sky/format'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'

// Plate Solving section of the Camera Capture panel: whether the next capture solves its frames, which ones (First
// Frame, Every N Frames, or Latest Frame Only), the solver collapsed below, and whether the WCS overlay is drawn, all
// kept per camera view in the profile and off by default. It shows the counters of the running or last capture, the
// compact solution of the frame shown, and Solve Current Frame, which solves that frame through the same service as
// Images. Solving runs on the server and is independent of the star detection; showing or hiding the overlay, or
// leaving the workspace, never changes it, and nothing here moves the mount.

// Processing policies, in display order.
const POLICIES: readonly PostCapturePlateSolvingPolicy[] = ['firstFrame', 'everyNth', 'latestFrame']

// Label of each processing policy.
const POLICY_LABELS: Readonly<Record<PostCapturePlateSolvingPolicy, string>> = { firstFrame: 'First', everyNth: 'Every N', latestFrame: 'Latest' }

// What each processing policy does to the capture.
const POLICY_NOTES: Readonly<Record<PostCapturePlateSolvingPolicy, string>> = {
	firstFrame: 'The first frame is solved; a failure is recorded and later frames are not solved.',
	everyNth: 'Frames 1, N + 1, 2N + 1… are solved; when the solver lags, the next of them waits for it on top of the delay.',
	latestFrame: 'The newest frame is solved; frames still waiting are skipped, and the capture never waits.',
}

// Text of the plate solving state of the frame shown, by job state.
const FRAME_LABELS = { queued: 'Pending', running: 'Running', completed: 'Solved', failed: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped' } as const

export interface PostCapturePlateSolvingProps {
	// Camera role of the view.
	readonly role: CameraRole
	// Whether a running capture locks the settings.
	readonly locked: boolean
	// Plate solving state of the running or last capture of the camera.
	readonly state?: CapturePlateSolvingState
	// Frame shown.
	readonly frame?: CaptureFrame
}

// Plate Solving section.
export function PostCapturePlateSolving({ role, locked, state, frame }: PostCapturePlateSolvingProps) {
	const profiles = useSnapshot(profileState)
	const settings = plateSolvingSettings(activeProfile(profiles).settings.capture, role)
	const configured = useSolverConfigured(settings.request.provider)
	const update = (patch: Parameters<typeof setPlateSolvingSettings>[2]) => setPlateSolvingSettings(profileState, role, patch)
	// Each nova solve waits for a remote service, which Every N Frames would make every eligible exposure wait for.
	const policies = settings.request.provider === 'nova' ? POLICIES.filter((policy) => policy !== 'everyNth') : POLICIES
	const editRequest = (request: PlateSolveRequest) => update({ request, ...(request.provider === 'nova' && settings.policy === 'everyNth' && { policy: 'firstFrame' }) })

	return (
		<PanelSection title="Plate Solving">
			<Checkbox label="Enable plate solving" checked={settings.enabled} disabled={locked} onChange={(enabled) => update({ enabled })} />
			{settings.enabled && (
				<>
					<SegmentedControl label="Processing Frame Policy" options={policies} value={settings.policy} format={(policy) => POLICY_LABELS[policy]} disabled={locked} onChange={(policy) => update({ policy })} />
					{settings.policy === 'everyNth' && <NumberInput label="Every N Frames" min={1} max={1000} step={1} value={settings.interval} disabled={locked} onChange={(interval) => update({ interval: Math.max(1, Math.trunc(interval)) })} />}
					<Notice>{POLICY_NOTES[settings.policy]}</Notice>
					<details>
						<summary className="cursor-pointer text-ink-200 select-none">{PROVIDER_LABELS[settings.request.provider]} solver settings</summary>
						<div className="mt-2 flex flex-col gap-2">
							<SolverControls request={settings.request} disabled={locked} onChange={editRequest} />
							<StrategyControls request={settings.request} disabled={locked} onChange={editRequest} />
							<HintControls request={settings.request} disabled={locked} onChange={editRequest} />
							<AdvancedControls request={settings.request} disabled={locked} onChange={editRequest} />
						</div>
					</details>
					{settings.request.provider === 'nova' && <Notice>Every frame solved is uploaded to Astrometry.net Online.</Notice>}
					{!configured && <Notice error>{PROVIDER_LABELS[settings.request.provider]} is not configured: a capture that solves its frames cannot start.</Notice>}
				</>
			)}
			<Checkbox label="Show WCS overlay" checked={settings.overlay} onChange={(overlay) => update({ overlay })} />
			<Checkbox label="RA/Dec grid" checked={settings.grid} disabled={!settings.overlay} onChange={(grid) => update({ grid })} />
			{state && <Counters state={state} />}
			{frame && <FrameSolution frame={frame} request={settings.request} configured={configured} />}
		</PanelSection>
	)
}

// Counters of the plate solving of the running or last capture, apart from its captured and saved frames.
function Counters({ state }: { readonly state: CapturePlateSolvingState }) {
	return (
		<>
			<dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1">
				<Count label="Requested">{state.requested}</Count>
				<Count label="Solved">{state.solved}</Count>
				<Count label="No solution">{state.noSolution}</Count>
				<Count label="Failed">{state.failed}</Count>
				<Count label="Skipped">{state.skipped}</Count>
				<Count label="Pending">{state.pending}</Count>
			</dl>
			{state.waiting && <Notice>Waiting for plate solving capacity.</Notice>}
			{state.halted && <Notice error>Plate solving stopped: {state.halted}</Notice>}
		</>
	)
}

// Label and value of a counter.
function Count({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="contents">
			<dt className="text-ink-300">{label}</dt>
			<dd className="m-0 text-right tabular-nums">{children}</dd>
		</div>
	)
}

interface FrameSolutionProps {
	// Frame shown.
	readonly frame: CaptureFrame
	// Request Solve Current Frame sends.
	readonly request: PlateSolveRequest
	// Whether its solver is configured.
	readonly configured: boolean
}

// Compact plate solution of the frame shown, matched by its image id, and Solve Current Frame.
function FrameSolution({ frame, request, configured }: FrameSolutionProps) {
	const { job, solution } = usePlateSolution(frame.imageId)
	const { submitErrors } = useSnapshot(plateSolvingState)
	const noSolution = job?.summary?.outcome === 'noSolution'

	return (
		<div className="flex flex-col gap-2 border-t border-line-100 pt-2">
			<dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1">
				<Count label={`Frame #${frame.generation}`}>{job ? (noSolution ? 'No solution' : FRAME_LABELS[job.state]) : 'Not solved'}</Count>
				{job && solution && (
					<>
						<Count label="RA (ICRS)">{formatRightAscension(solution.rightAscension)}</Count>
						<Count label="Dec (ICRS)">{formatDeclination(solution.declination)}</Count>
						<Count label="Pixel Scale">{toArcsec(solution.scale).toFixed(3)} ″/px</Count>
						<Count label="Rotation">{toDeg(solution.orientation).toFixed(2)}°</Count>
						<Count label="Solver">{PROVIDER_LABELS[job.request.provider]}</Count>
						{job.summary && <Count label="Duration">{(job.summary.elapsed / 1000).toFixed(2)} s</Count>}
					</>
				)}
				{job?.error && <dd className="col-span-2 m-0 text-xs leading-4 text-danger">{job.error}</dd>}
			</dl>
			<Actions>
				<Button variant="secondary" size="sm" disabled={!configured || isActive(job)} onClick={() => void runPlateSolve(plateSolvingState, frame.imageId, request)}>
					Solve Current Frame
				</Button>
			</Actions>
			{submitErrors[frame.imageId] && <Notice error>{submitErrors[frame.imageId]}</Notice>}
		</div>
	)
}
