import type { PlateSolveHint, PlateSolveJob, PlateSolveRequest, PlateSolveResult } from 'api'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { toArcmin, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { type ReactNode, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { isActive } from '../analysis'
import { controlRuntime, sendCommand, watchedDeviceState } from '../equipment-control/control'
import { Actions, ConfirmButton, Notice } from '../equipment-control/parts'
import { roleAvailability } from '../equipment/availability'
import { useRoleDevice } from '../equipment/useEquipment'
import { operationsState } from '../operations'
import { AdvancedControls, HintControls, SolverControls, StrategyControls, useSolverConfigured } from '../platesolving/PlateSolveControls'
import { cancelPlateSolve, completedJobs, loadHints, mountSyncBlocker, mountSyncSupport, mountSyncTarget, plateSolvingState, PROVIDER_LABELS, runPlateSolve, STAGE_LABELS } from '../platesolving/platesolving'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { wcsFrame } from '../platesolving/wcs'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { EmptyState } from '../shell/WorkspaceLayout'
import { formatDeclination, formatRightAscension } from '../sky/format'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Select } from '../ui/Select'
import { useNow } from '../useNow'
import { holdCameraFrame } from './cameratabs'
import { type ImagePlateSolvingState, imagesState, imageUnavailableReason, selectPlateSolution, setPlateSolveOverlay, setPlateSolveRequest } from './images'
import type { ImageToolPanelProps } from './tools'

// Plate Solver tool of the Images workspace: solves the active document on the server with ASTAP, Astrometry.net Local,
// or Astrometry.net Online, and shows the solution (centre in the frame of its WCS, scale, rotation, parity, field of view), the hints it
// used with their origins, and its overlay. Settings are edited as the document's pending request and sent only by
// Solve Image; zoom, pan, stretch, or the overlay never solve. The settings are editable before the document has an
// image (a camera tab waiting for its first frame), with Solve Image disabled until it has one. A job stays bound to the image it solved, so switching
// documents never shows its solution on another one, and a job that ends never replaces the solution chosen. Solvers
// are configured in Settings → External Tools, which the solver section links to. Sync Mount, after a confirmation,
// syncs the MOUNT of the active equipment setup on the centre of the solution shown; nothing here moves a mount.

// Text shown for a value the result does not have.
const MISSING = '—'

// Display names of the job states.
const STATE_LABELS: Readonly<Record<PlateSolveJob['state'], string>> = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }

// Display names of the hint origins.
const SOURCE_LABELS: Readonly<Record<PlateSolveHint['source'], string>> = { user: 'request', header: 'header', optics: 'optics', default: 'default' }

// Plate Solver panel of the active document.
export function PlateSolverPanel({ document, view, onOpen }: ImageToolPanelProps) {
	if (!document) {
		return (
			<EmptyState
				title="No image open"
				action={
					<Button variant="secondary" onClick={onOpen}>
						Open Image
					</Button>
				}
			/>
		)
	}

	if (!view) {
		return (
			<CollapsibleSection id="images.plate-solver.plate-solving" title="Plate Solving">
				<p className="m-0 text-ink-300">{imageUnavailableReason(document) ?? 'The image is unavailable.'}</p>
			</CollapsibleSection>
		)
	}

	return <PlateSolver documentKey={document.key} imageId={document.info?.id} plateSolving={view.plateSolving} unavailable={imageUnavailableReason(document)} />
}

interface PlateSolverProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of its image; absent until it has one.
	readonly imageId?: string
	// Plate solving request, solution shown, and overlay of the document.
	readonly plateSolving: ImagePlateSolvingState
	// Why the document has no image yet.
	readonly unavailable?: string
}

// Sections of the Plate Solver panel of a document: the settings always, the execution and the solutions once it has
// an image.
function PlateSolver({ documentKey, imageId, plateSolving, unavailable }: PlateSolverProps) {
	const state = useSnapshot(plateSolvingState)
	const { job, result, solution, header, resultError } = usePlateSolution(imageId, plateSolving.selected)
	const { request } = plateSolving
	const edit = (next: PlateSolveRequest) => setPlateSolveRequest(imagesState, documentKey, next)
	const offered = imageId === undefined ? undefined : state.hints[imageId]

	useEffect(() => {
		if (imageId !== undefined) void loadHints(plateSolvingState, imageId)
	}, [imageId])

	return (
		<>
			<CollapsibleSection id="images.plate-solver.solver" title="Solver">
				<SolverControls request={request} onChange={edit} />
			</CollapsibleSection>
			<CollapsibleSection id="images.plate-solver.solving-strategy" title="Solving Strategy">
				<StrategyControls request={request} onChange={edit} />
			</CollapsibleSection>
			<CollapsibleSection id="images.plate-solver.solve-hints" title="Solve Hints" defaultOpen={false}>
				<HintControls request={request} onChange={edit} offered={offered} />
			</CollapsibleSection>
			<CollapsibleSection id="images.plate-solver.advanced-settings" title="Advanced Settings" defaultOpen={false}>
				<AdvancedControls request={request} onChange={edit} />
			</CollapsibleSection>
			<Execution documentKey={documentKey} imageId={imageId} request={request} job={plateSolving.selected === 'header' ? undefined : job} submitError={imageId === undefined ? undefined : state.submitErrors[imageId]} unavailable={unavailable} />
			{imageId !== undefined && (
				<>
					<Solution job={plateSolving.selected === 'header' ? undefined : job} result={result} solution={solution} fromHeader={plateSolving.selected === 'header'} resultError={resultError} />
					{solution && result && <SolverDetails result={result} />}
					{solution && <MountSync solution={solution} />}
					<Solutions documentKey={documentKey} imageId={imageId} selected={plateSolving.selected} header={header} />
				</>
			)}
			<CollapsibleSection id="images.plate-solver.visualization" title="Visualization">
				<Checkbox label="Show WCS overlay" checked={plateSolving.overlay} onChange={(overlay) => setPlateSolveOverlay(imagesState, documentKey, { overlay })} />
				<Checkbox label="RA/Dec grid" checked={plateSolving.grid} disabled={!plateSolving.overlay} onChange={(grid) => setPlateSolveOverlay(imagesState, documentKey, { grid })} />
				<Notice>The overlay marks the solved centre and the north and east directions of the WCS. Showing it never solves again.</Notice>
			</CollapsibleSection>
		</>
	)
}

interface ExecutionProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of the image; absent until the document has one.
	readonly imageId?: string
	// Why the document has no image yet.
	readonly unavailable?: string
	// Pending request of the document.
	readonly request: PlateSolveRequest
	// Job shown.
	readonly job?: PlateSolveJob
	// Why the latest submission failed.
	readonly submitError?: string
}

// Solve Image and Cancel, with the state of the job shown. Solving holds the frame a camera tab shows first, so the frame solved stays
// shown.
function Execution({ documentKey, imageId, request, job, submitError, unavailable }: ExecutionProps) {
	const active = isActive(job)
	const now = useNow(active)
	const configured = useSolverConfigured(request.provider)

	async function solve() {
		if (imageId === undefined) return
		holdCameraFrame(imagesState, documentKey)
		// A submission shows its own job: the choice of an earlier solution gives way to it.
		selectPlateSolution(imagesState, documentKey, undefined)
		await runPlateSolve(plateSolvingState, imageId, request)
	}

	return (
		<CollapsibleSection id="images.plate-solver.execution" title="Execution">
			<Actions>
				<Button disabled={active || !configured || imageId === undefined} onClick={() => void solve()}>
					Solve Image
				</Button>
				<Button variant="secondary" disabled={!active || !job} onClick={() => job && void cancelPlateSolve(job.jobId)}>
					Cancel
				</Button>
			</Actions>
			{!configured && <Notice error>{PROVIDER_LABELS[request.provider]} is not configured.</Notice>}
			{unavailable && <Notice>{unavailable} The settings apply to the next solve.</Notice>}
			{submitError && <Notice error>{submitError}</Notice>}
			{job ? (
				<>
					<Property label="Status">{STATE_LABELS[job.state]}</Property>
					{job.state === 'running' && job.stage && <Property label="Step">{STAGE_LABELS[job.stage]}</Property>}
					<Property label="Solver">{PROVIDER_LABELS[job.request.provider]}</Property>
					<Property label="Elapsed">{formatSeconds(elapsedOf(job, now))}</Property>
					{job.remote?.submissionId !== undefined && <Property label="Remote submission">{job.remote.submissionId}</Property>}
					{job.remote?.jobId !== undefined && <Property label="Remote job">{job.remote.jobId}</Property>}
					{job.error && <Notice error>{job.error}</Notice>}
				</>
			) : (
				imageId !== undefined && <Notice>No plate solve of this image yet.</Notice>
			)}
		</CollapsibleSection>
	)
}

interface SolutionProps {
	// Job shown, absent for the header solution.
	readonly job?: PlateSolveJob
	// Its result, once fetched.
	readonly result?: PlateSolveResult
	// Solution shown.
	readonly solution?: PlateSolution
	// Whether it is the solution of the header.
	readonly fromHeader: boolean
	// Why the result could not be fetched.
	readonly resultError?: string
}

// Centre, scale, orientation, and field of the solution shown.
function Solution({ job, result, solution, fromHeader, resultError }: SolutionProps) {
	const noSolution = job?.summary?.outcome === 'noSolution'

	return (
		<CollapsibleSection id="images.plate-solver.solution" title="Solution">
			{solution ? (
				<>
					<Property label="Source">{fromHeader ? 'Image header' : PROVIDER_LABELS[result?.request.provider ?? 'astap']}</Property>
					<Property label={`RA (${wcsFrame(solution)})`}>{formatRightAscension(solution.rightAscension)}</Property>
					<Property label={`Dec (${wcsFrame(solution)})`}>{formatDeclination(solution.declination)}</Property>
					<Property label="Pixel Scale">{toArcsec(solution.scale).toFixed(3)} ″/px</Property>
					<Property label="Rotation">{toDeg(solution.orientation).toFixed(2)}°</Property>
					<Property label="Parity">{solution.parity === 'NORMAL' ? 'Normal' : 'Flipped'}</Property>
					<Property label="Field of View">
						{toArcmin(solution.width).toFixed(1)}′ × {toArcmin(solution.height).toFixed(1)}′
					</Property>
					<Property label="Projection">{String(solution.CTYPE1 ?? MISSING).trim()}</Property>
				</>
			) : (
				<Notice error={!!resultError}>{resultError ?? (noSolution ? 'The search ended without a solution.' : job && isActive(job) ? 'Solving…' : 'No solution.')}</Notice>
			)}
			{noSolution && result?.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
		</CollapsibleSection>
	)
}

// What the solver used for the solution shown: its hints, duration, and warnings, collapsed by default.
function SolverDetails({ result }: { readonly result: PlateSolveResult }) {
	const { hints } = result

	return (
		<CollapsibleSection id="images.plate-solver.solver-details" title="Solver Details" summary={formatSeconds(result.elapsed)} defaultOpen={false}>
			<Property label="Strategy">{result.request.strategy === 'blind' ? 'Blind' : 'Assisted'}</Property>
			<Property label="Center hint">{hints.rightAscension && hints.declination ? `${formatRightAscension(hints.rightAscension.value)} ${formatDeclination(hints.declination.value)} (${SOURCE_LABELS[hints.rightAscension.source]})` : 'None'}</Property>
			<Property label="Radius hint">{hints.radius ? `${toDeg(hints.radius.value).toFixed(1)}° (${SOURCE_LABELS[hints.radius.source]})` : 'None'}</Property>
			<Property label="Scale hint">{hints.scale ? `${toArcsec(hints.scale.value).toFixed(3)} ″/px (${SOURCE_LABELS[hints.scale.source]})` : 'None'}</Property>
			<Property label="Duration">{formatSeconds(result.elapsed)}</Property>
			<Property label="Waited">{formatSeconds(result.queueTime)}</Property>
			{result.warnings.map((warning) => (
				<Notice key={warning}>{warning}</Notice>
			))}
		</CollapsibleSection>
	)
}

interface MountSyncProps {
	// Solution whose centre the mount is synced on.
	readonly solution: PlateSolution
}

// Sync Mount: syncs the setup's mount on the centre of the solution shown, once confirmed, and says why it cannot or
// why the mount refused. The mount takes the coordinate where it points now, without moving.
function MountSync({ solution }: MountSyncProps) {
	const mount = useRoleDevice('MOUNT')
	const control = useSnapshot(controlRuntime)
	const operations = useSnapshot(operationsState)
	// Mount and coordinate of the latest sync this panel sent that the mount accepted, as "id x y".
	const [synced, setSynced] = useState<string>()
	const id = mount.device?.id
	const state = watchedDeviceState(control, 'mount', mount.device)
	const blocker = mountSyncBlocker(roleAvailability('MOUNT', mount, operations, mountSyncSupport(state)), state, id !== undefined && control.pending[id] !== undefined)
	const error = id === undefined ? undefined : control.errors[id]
	const target = mountSyncTarget(solution)
	const key = `${id} ${target.x} ${target.y}`

	async function sync() {
		if (id === undefined) return
		setSynced(undefined)
		if (await sendCommand(controlRuntime, { type: 'mount', deviceId: id, action: 'sync', label: 'Sync', body: { target } })) setSynced(key)
	}

	return (
		<CollapsibleSection id="images.plate-solver.mount" title="Mount">
			<Actions>
				<ConfirmButton
					title="Sync the mount?"
					message={`${mount.device?.name ?? 'The mount'} takes RA ${formatRightAscension(solution.rightAscension)} and Dec ${formatDeclination(solution.declination)} (J2000) as the place it points at now, without moving. Sync only when the image was taken at the current pointing.`}
					confirmLabel="Sync"
					disabled={blocker !== undefined}
					onConfirm={() => void sync()}
				>
					Sync Mount
				</ConfirmButton>
			</Actions>
			{blocker && <Notice>{blocker}</Notice>}
			{error && <Notice error>{error}</Notice>}
			{synced === key && !error && <Notice>The mount was synced on this solution.</Notice>}
		</CollapsibleSection>
	)
}

interface SolutionsProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of the image.
	readonly imageId: string
	// Solution chosen.
	readonly selected?: string
	// Solution of the header, when it has one.
	readonly header?: PlateSolution
}

// Choice of the solution shown among the completed jobs of the image and its header.
function Solutions({ documentKey, imageId, selected, header }: SolutionsProps) {
	const state = useSnapshot(plateSolvingState)
	const jobs = completedJobs(state, imageId)
	if (jobs.length + (header ? 1 : 0) < 2) return null

	const options = ['latest', ...(header ? ['header'] : []), ...jobs.map((job) => job.jobId)]
	const label = (option: string) => {
		if (option === 'latest') return 'Latest solve'
		if (option === 'header') return 'Image header'
		const job = state.jobs[option]
		return `${PROVIDER_LABELS[job.request.provider]} ${job.request.strategy} · ${new Date(job.queuedAt).toLocaleTimeString()}${job.summary?.outcome === 'noSolution' ? ' · no solution' : ''}`
	}

	return (
		<CollapsibleSection id="images.plate-solver.solutions" title="Solutions">
			<Select options={options} value={selected ?? 'latest'} format={label} onChange={(option) => selectPlateSolution(imagesState, documentKey, option === 'latest' ? undefined : option)} />
			<Notice>A new solve never replaces the solution chosen here; the original file is never changed.</Notice>
		</CollapsibleSection>
	)
}

interface PropertyProps {
	// Property name.
	readonly label: string
	// Property value.
	readonly children: ReactNode
}

// Name and value of a property.
function Property({ label, children }: PropertyProps) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-xs text-ink-300">{label}</span>
			<span className="min-w-0 text-right text-ink-100 tabular-nums">{children}</span>
		</div>
	)
}

// Returns how long a job ran, or has been running, in milliseconds; 0 while it waits.
function elapsedOf(job: PlateSolveJob, now: number): number {
	if (job.summary) return job.summary.elapsed
	if (job.startedAt === undefined) return 0
	return (job.endedAt ?? now) - job.startedAt
}

// Returns a duration in milliseconds as seconds with two decimals below 10 s, one above.
function formatSeconds(milliseconds: number): string {
	const seconds = milliseconds / 1000
	return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`
}
