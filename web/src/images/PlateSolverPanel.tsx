import type { PlateSolveHint, PlateSolveJob, PlateSolveRequest, PlateSolveResult, ResolvedPlateSolveHints } from 'api'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { type ReactNode, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { analysisElapsed, isActive } from '../analysis'
import { controlRuntime, sendCommand, watchedDeviceState } from '../equipment-control/control'
import { roleAvailability } from '../equipment/availability'
import { useRoleDevice } from '../equipment/useEquipment'
import { formatArcmin, formatClockTime, formatDegrees, formatDuration, MISSING } from '../format'
import { useActiveTimeZone } from '../location/useLocation'
import { operationsState } from '../operations'
import { type CoordinateStyle, formatDeclinationAs, formatPixelScale, formatPositionAngle, formatRightAscensionAs } from '../platesolving/coordinates'
import { AdvancedControls, advancedSummary, HintControls, hintsSummary, settingsSummary, SolverControls, StrategyControls, useSolverBlocker, useSolverState } from '../platesolving/PlateSolveControls'
import { cancelPlateSolve, effectivePlateSolveRequest, isSolved, loadHints, loadPlateSolveResult, mountSyncBlocker, mountSyncSupport, mountSyncTarget, plateSolveSettings, plateSolvingState, PROVIDER_LABELS, runPlateSolve, solutionOptions, STAGE_LABELS, STRATEGY_LABELS } from '../platesolving/platesolving'
import { type AstrometryGridSettings, COORDINATE_FORMATS, COORDINATE_PRECISION_RANGE, type CoordinateFormat, GRID_COLORS, GRID_OPACITY_RANGE, type GridColor, ORIENTATION_MODES, type OrientationMode } from '../platesolving/preferences'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { fitsToViewer, imageTopPositionAngle, wcsFrame } from '../platesolving/wcs'
import { activeProfile, cameraPlateSolving, imageAstrometrySettings, imagePlateSolving, profileState, setCameraPlateSolving, setImageAstrometrySettings, setImagePlateSolving } from '../profile/profile'
import type { CameraIdentity } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { navigate, routeState } from '../shell/route'
import { EmptyState } from '../shell/WorkspaceLayout'
import { imageFootprint, showFootprintInSky, skyImageState } from '../sky/footprint'
import { formatDeclination, formatRightAscension } from '../sky/format'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SectionHeading } from '../ui/SectionHeading'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { Slider } from '../ui/Slider'
import { useNow } from '../useNow'
import { type ImageAstrometryState, type ImagePlateSolvingState, imagesState, imageUnavailableReason, selectPlateSolution, setPlateSolveOverlay, setPlateSolveRequest } from './images'
import { MarkersSection, MeasurementsSection } from './MeasurementsSection'
import { TargetOffsetSection } from './TargetOffsetSection'
import type { ImageToolPanelProps } from './tools'

// Plate Solver tool of the Images workspace: solves the active document on the server with ASTAP, Astrometry.net Local,
// Astrometry.net Online, or the built-in solver, and shows the solution (centre in the frame of its WCS, scale, rotation,
// parity, field of view), the hints it used with their origins, and its overlay. The panel has two states: before the
// document shows a solution it is Solve Image above the settings; once it shows one, the settings fold into one
// collapsed section and the solution and the tools built on it (Sync Mount, Sky, measurements, markers, target offset,
// what is drawn) take the panel. The settings are those the profile shares between the documents, or on a camera tab
// those of its camera, which the operations of that camera share; a document keeps only its hints. They are sent only
// by Solve Image; zoom, pan, stretch, or the overlay never solve. The settings are editable before the document has an
// image (a camera tab waiting for its first frame), with Solve Image disabled until it has one. A job stays bound to the
// image it solved, so switching documents never shows its solution on another one. The latest solution is that of the
// newest solve that found one, so a solve that runs, fails, or ends without a solution keeps the solution shown, and a
// solution chosen in Solutions stays shown whatever ends. Solvers are configured in Settings → External Tools, which the
// solver controls link to. Sync Mount, after a confirmation, syncs the MOUNT of the active equipment setup on the centre
// of the solution shown; nothing here moves a mount.

// Display names of the hint origins.
const SOURCE_LABELS: Readonly<Record<PlateSolveHint['source'], string>> = { user: 'request', header: 'header', optics: 'optics', default: 'default' }

// Plate Solver panel of the active document.
export function PlateSolverPanel({ document, view, camera, onOpen }: ImageToolPanelProps) {
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
				<Notice>{imageUnavailableReason(document) ?? 'The image is unavailable.'}</Notice>
			</CollapsibleSection>
		)
	}

	return <PlateSolver documentKey={document.key} imageId={document.info?.id} image={document.info} name={document.name} plateSolving={view.plateSolving} astrometry={view.astrometry} unavailable={imageUnavailableReason(document)} camera={camera?.settings} />
}

interface PlateSolverProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of its image; absent until it has one.
	readonly imageId?: string
	// Size of its image, in pixels; absent until it has one.
	readonly image?: { readonly width: number; readonly height: number }
	// Name of the document.
	readonly name: string
	// Plate solving request, solution shown, and overlay of the document.
	readonly plateSolving: ImagePlateSolvingState
	// Astrometric measurements of the document.
	readonly astrometry: ImageAstrometryState
	// Why the document has no image yet.
	readonly unavailable?: string
	// Physical camera of a camera tab, whose settings the panel edits; absent for any other document.
	readonly camera?: CameraIdentity
}

// Sections of the Plate Solver panel of a document: Solve Image and the latest solve always, then the settings until a
// solution is shown, or the solution and its tools once one is, with the settings folded.
function PlateSolver({ documentKey, imageId, image, name, plateSolving, astrometry, unavailable, camera }: PlateSolverProps) {
	const state = useSnapshot(plateSolvingState)
	const profiles = useSnapshot(profileState)
	const { settings } = activeProfile(profiles)
	const { coordinates } = imageAstrometrySettings(settings)
	const fromHeader = plateSolving.selected === 'header'
	const { job, latest, result, solution, resultError } = usePlateSolution(imageId, plateSolving.selected)
	const shown = fromHeader ? undefined : job
	const request = effectivePlateSolveRequest(plateSolving.request, camera ? cameraPlateSolving(settings, camera) : imagePlateSolving(settings))

	// Keeps the hints in the document, and the settings with the camera of a camera tab or else in the profile.
	function edit(next: PlateSolveRequest) {
		if (camera) setCameraPlateSolving(profileState, camera, plateSolveSettings(next))
		else setImagePlateSolving(profileState, plateSolveSettings(next))
		setPlateSolveRequest(imagesState, documentKey, next)
	}

	const offered = imageId === undefined ? undefined : state.hints[imageId]

	useEffect(() => {
		if (imageId !== undefined) void loadHints(plateSolvingState, imageId)
	}, [imageId])

	const execution = <Execution documentKey={documentKey} imageId={imageId} request={request} latest={latest} shown={shown} submitError={imageId === undefined ? undefined : state.submitErrors[imageId]} resultError={resultError} unavailable={unavailable} />

	if (imageId === undefined || !solution) {
		return (
			<>
				{execution}
				<SettingsSections request={request} onChange={edit} offered={offered} />
				{imageId !== undefined && (
					<>
						<Solutions documentKey={documentKey} imageId={imageId} selected={plateSolving.selected} />
						{astrometry.measurements.length > 0 && <MeasurementsSection documentKey={documentKey} image={image} astrometry={astrometry} style={coordinates} />}
						{astrometry.markers.length > 0 && <MarkersSection documentKey={documentKey} image={image} astrometry={astrometry} style={coordinates} />}
					</>
				)}
			</>
		)
	}

	return (
		<>
			{execution}
			<SolveSettings request={request} onChange={edit} offered={offered} />
			<Solution job={shown} latest={plateSolving.selected === undefined ? latest : undefined} solution={solution} style={coordinates} />
			{shown && result && <SolverDetails result={result} solution={solution} />}
			<Solutions documentKey={documentKey} imageId={imageId} selected={plateSolving.selected} />
			<MountSync solution={solution} />
			{image && <SkyFootprint documentKey={documentKey} imageId={imageId} name={name} image={image} solution={solution} />}
			<MeasurementsSection documentKey={documentKey} solution={solution} image={image} astrometry={astrometry} style={coordinates} />
			<MarkersSection documentKey={documentKey} solution={solution} image={image} astrometry={astrometry} style={coordinates} />
			<TargetOffsetSection documentKey={documentKey} solution={solution} image={image} astrometry={astrometry} style={coordinates} />
			<Visualization documentKey={documentKey} plateSolving={plateSolving} />
		</>
	)
}

interface SettingsProps {
	// Pending request of the document.
	readonly request: PlateSolveRequest
	// Called with the edited request.
	readonly onChange: (request: PlateSolveRequest) => void
	// Hints the image offers, shown as placeholders.
	readonly offered?: ResolvedPlateSolveHints
}

// Settings of a document without a solution shown, one section each: the solver and the strategy open, the hints and the
// advanced settings collapsed, each with a summary while collapsed.
function SettingsSections({ request, onChange, offered }: SettingsProps) {
	const solverState = useSolverState(request.provider)

	return (
		<>
			<CollapsibleSection id="images.plate-solver.solver" title="Solver" summary={`${PROVIDER_LABELS[request.provider]} · ${solverState}`}>
				<SolverControls request={request} onChange={onChange} />
			</CollapsibleSection>
			<CollapsibleSection id="images.plate-solver.solving-strategy" title="Solving Strategy" summary={STRATEGY_LABELS[request.strategy]}>
				<StrategyControls request={request} onChange={onChange} />
			</CollapsibleSection>
			<CollapsibleSection id="images.plate-solver.solve-hints" title="Solve Hints" summary={hintsSummary(request)} defaultOpen={false}>
				<HintControls request={request} onChange={onChange} offered={offered} />
			</CollapsibleSection>
			<CollapsibleSection id="images.plate-solver.advanced-settings" title="Advanced Settings" summary={advancedSummary(request)} defaultOpen={false}>
				<AdvancedControls request={request} onChange={onChange} />
			</CollapsibleSection>
		</>
	)
}

// Settings of a document showing a solution, folded into one section collapsed by default, whose summary names the
// solver and the strategy.
function SolveSettings({ request, onChange, offered }: SettingsProps) {
	return (
		<CollapsibleSection id="images.plate-solver.solve-settings" title="Solve Settings" summary={settingsSummary(request)} defaultOpen={false}>
			<SolverControls request={request} onChange={onChange} />
			<SettingsGroup title="Strategy">
				<StrategyControls request={request} onChange={onChange} />
			</SettingsGroup>
			<SettingsGroup title="Hints">
				<HintControls request={request} onChange={onChange} offered={offered} />
			</SettingsGroup>
			<SettingsGroup title="Advanced">
				<AdvancedControls request={request} onChange={onChange} />
			</SettingsGroup>
		</CollapsibleSection>
	)
}

// Titled group of controls inside a section, below a divider.
function SettingsGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<div className="mt-1 flex flex-col gap-2 border-t border-line-100 pt-3">
			<SectionHeading>{title}</SectionHeading>
			{children}
		</div>
	)
}

// Returns the outcome of a job in words with the tone that tints it: Solved and No solution once completed, else its
// state.
function jobStatus(job: Pick<PlateSolveJob, 'state' | 'summary'>): { readonly label: string; readonly tone: 'default' | 'success' | 'warning' | 'danger' } {
	switch (job.state) {
		case 'queued':
			return { label: 'Queued', tone: 'default' }
		case 'running':
			return { label: 'Running', tone: 'default' }
		case 'completed':
			return isSolved(job) ? { label: 'Solved', tone: 'success' } : { label: 'No solution', tone: 'warning' }
		case 'failed':
			return { label: 'Failed', tone: 'danger' }
		case 'cancelled':
			return { label: 'Cancelled', tone: 'default' }
	}
}

// Returns how long a running job has run, in whole seconds, as the timer ticks once a second: "12 s", "1 min 05 s".
function formatRunning(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000)
	return seconds < 60 ? `${seconds} s` : formatDuration(seconds)
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
	// Latest job of the image, whatever its state.
	readonly latest?: PlateSolveJob
	// Job whose solution is shown, which may be older than the latest; absent for the header solution.
	readonly shown?: PlateSolveJob
	// Why the latest submission failed.
	readonly submitError?: string
	// Why the result of the job shown could not be fetched.
	readonly resultError?: string
}

// Solve Image and Cancel, with the state of the latest solve of the image: its step and time while it runs, and its
// outcome once it ends. A solve that ends without the solution shown says which solution stays.
function Execution({ documentKey, imageId, request, latest, shown, submitError, resultError, unavailable }: ExecutionProps) {
	const active = isActive(latest)
	const now = useNow(active)
	const timeZone = useActiveTimeZone()
	const blocker = useSolverBlocker(request.provider)
	const results = useSnapshot(plateSolvingState).results
	const ended = latest !== undefined && !active
	const failedSearch = latest?.state === 'completed' && !isSolved(latest)
	const reason = imageId === undefined ? (unavailable ?? 'The document has no image yet.') : active ? 'A solve of this image is running.' : blocker
	const status = latest && jobStatus(latest)
	// The latest solve ended without becoming the solution shown, which stays.
	const kept = ended && !isSolved(latest) && shown !== undefined && isSolved(shown) && shown.jobId !== latest.jobId

	useEffect(() => {
		if (failedSearch && latest) void loadPlateSolveResult(plateSolvingState, latest.jobId)
	}, [failedSearch, latest])

	async function solve() {
		if (imageId === undefined) return
		// A submission shows its own job: the choice of an earlier solution gives way to it.
		selectPlateSolution(imagesState, documentKey, undefined)
		await runPlateSolve(plateSolvingState, imageId, request)
	}

	return (
		<CollapsibleSection id="images.plate-solver.execution" title="Solve" summary={status?.label}>
			<Actions>
				<Button className="max-sm:min-h-12.5" disabled={reason !== undefined} title={reason} onClick={() => void solve()}>
					Solve Image
				</Button>
				<Button variant="secondary" className="max-sm:min-h-12.5" disabled={!active} title={active ? undefined : 'No solve of this image is running.'} onClick={() => latest && void cancelPlateSolve(latest.jobId)}>
					Cancel
				</Button>
			</Actions>
			{blocker && <Notice warning>{blocker}</Notice>}
			{unavailable && <Notice>{unavailable} The settings apply to the next solve.</Notice>}
			{submitError && <Notice error>{submitError}</Notice>}
			{latest && status ? (
				<div className="flex flex-col">
					<DataRow label="Status" tone={status.tone}>
						{status.label}
					</DataRow>
					{latest.state === 'running' && latest.stage && <DataRow label="Step">{STAGE_LABELS[latest.stage]}</DataRow>}
					{active && <DataRow label="Elapsed">{formatRunning(analysisElapsed(latest, now))}</DataRow>}
					{ended && latest.jobId !== shown?.jobId && <DataRow label="Duration">{formatDuration(analysisElapsed(latest, now) / 1000)}</DataRow>}
					{latest.remote?.submissionId !== undefined && <DataRow label="Remote submission">{latest.remote.submissionId}</DataRow>}
					{latest.remote?.jobId !== undefined && <DataRow label="Remote job">{latest.remote.jobId}</DataRow>}
				</div>
			) : (
				imageId !== undefined && <Notice>This image is not solved yet.</Notice>
			)}
			{latest?.state === 'failed' && latest.error && <Notice error>{latest.error}</Notice>}
			{failedSearch && results[latest.jobId]?.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
			{kept && <Notice>The solution of {formatClockTime(shown.queuedAt, timeZone, { seconds: true, named: true })} stays shown.</Notice>}
			{resultError && <Notice error>{resultError}</Notice>}
		</CollapsibleSection>
	)
}

interface SolutionProps {
	// Job of the solution shown, absent for the header solution.
	readonly job?: PlateSolveJob
	// Latest job of the image while the latest solution is shown, to say when a newer solve runs or ended without one.
	readonly latest?: PlateSolveJob
	// Solution shown.
	readonly solution: PlateSolution
	// How the centre is written.
	readonly style: CoordinateStyle
}

// Centre of the solution shown as the one Readout of the panel, then its scale, orientation, parity, and field, with
// where it comes from.
function Solution({ job, latest, solution, style }: SolutionProps) {
	const timeZone = useActiveTimeZone()
	const topAngle = imageTopPositionAngle(solution, fitsToViewer(Number(solution.CRPIX1), Number(solution.CRPIX2)))
	const source = job ? `${PROVIDER_LABELS[job.request.provider]} ${STRATEGY_LABELS[job.request.strategy]} · ${formatClockTime(job.queuedAt, timeZone, { seconds: true, named: true })}` : 'Image header'
	const newer = latest && job && latest.jobId !== job.jobId ? latest : undefined

	return (
		<CollapsibleSection id="images.plate-solver.solution" title="Solution" summary={`${formatRightAscensionAs(solution.rightAscension, style)} ${formatDeclinationAs(solution.declination, style)}`}>
			<div className="flex flex-col">
				<CentreRow label="RA">{formatRightAscensionAs(solution.rightAscension, style)}</CentreRow>
				<CentreRow label="Dec">{formatDeclinationAs(solution.declination, style)}</CentreRow>
			</div>
			<Notice>
				{wcsFrame(solution)} · {source}
			</Notice>
			{newer && isActive(newer) && <Notice>A new solve is running; this solution stays until it finds one.</Notice>}
			<div className="flex flex-col">
				<DataRow label="Pixel Scale">{formatPixelScale(solution.scale)}</DataRow>
				<DataRow label="Field of View">
					{formatArcmin(solution.width)} × {formatArcmin(solution.height)}
				</DataRow>
				<DataRow label="Radius">{formatArcmin(Math.hypot(solution.width / 2, solution.height / 2))}</DataRow>
				<DataRow label="PA of Image Top">{formatPositionAngle(topAngle)}</DataRow>
				<DataRow label="Parity">{solution.parity === 'NORMAL' ? 'Normal' : 'Flipped'}</DataRow>
			</div>
		</CollapsibleSection>
	)
}

// One coordinate of the solved centre at the Readout size, its name beside it.
function CentreRow({ label, children }: { readonly label: string; readonly children: string }) {
	return (
		<div className="flex flex-wrap items-baseline justify-between gap-x-3">
			<SectionHeading>{label}</SectionHeading>
			<span className="ml-auto text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{children}</span>
		</div>
	)
}

// What the solver used for the solution shown: its strategy, hints, duration, and projection, and its warnings,
// collapsed by default.
function SolverDetails({ result, solution }: { readonly result: PlateSolveResult; readonly solution: PlateSolution }) {
	const { hints } = result

	return (
		<CollapsibleSection id="images.plate-solver.solver-details" title="Solver Details" summary={formatDuration(result.elapsed / 1000)} defaultOpen={false}>
			<div className="flex flex-col">
				<DataRow label="Strategy">{STRATEGY_LABELS[result.request.strategy]}</DataRow>
				<DataRow label="Centre hint">{hints.rightAscension && hints.declination ? `${formatRightAscension(hints.rightAscension.value)} ${formatDeclination(hints.declination.value)} (${SOURCE_LABELS[hints.rightAscension.source]})` : 'None'}</DataRow>
				<DataRow label="Radius hint">{hints.radius ? `${formatDegrees(hints.radius.value, 1)} (${SOURCE_LABELS[hints.radius.source]})` : 'None'}</DataRow>
				<DataRow label="Scale hint">{hints.scale ? `${formatPixelScale(hints.scale.value)} (${SOURCE_LABELS[hints.scale.source]})` : 'None'}</DataRow>
				<DataRow label="Duration">{formatDuration(result.elapsed / 1000)}</DataRow>
				<DataRow label="Waited">{formatDuration(result.queueTime / 1000)}</DataRow>
				<DataRow label="Projection">{String(solution.CTYPE1 ?? MISSING).trim()}</DataRow>
			</div>
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
					message={`${mount.device?.name ?? 'The mount'} takes RA ${formatRightAscension(solution.rightAscension)} and Dec ${formatDeclination(solution.declination)} (${wcsFrame(solution)}, sent as J2000) as the place it points at now, without moving. Sync only when the image was taken at the current pointing.`}
					confirmLabel="Sync"
					disabled={blocker !== undefined}
					tooltip={blocker}
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
}

// Choice of the solution shown among the completed jobs of the image and its header.
function Solutions({ documentKey, imageId, selected }: SolutionsProps) {
	const timeZone = useActiveTimeZone()
	const state = useSnapshot(plateSolvingState)
	const options = solutionOptions(state, imageId)
	if (options.length === 0) return null

	const label = (option: string) => {
		if (option === 'latest') return 'Latest solution'
		if (option === 'header') return 'Image header'
		const job = state.jobs[option]
		return `${PROVIDER_LABELS[job.request.provider]} ${STRATEGY_LABELS[job.request.strategy]} · ${formatClockTime(job.queuedAt, timeZone, { seconds: true, named: true })}${isSolved(job) ? '' : ' · no solution'}`
	}

	return (
		<CollapsibleSection id="images.plate-solver.solutions" title="Solutions" summary={label(selected ?? 'latest')}>
			<Select options={options} value={selected ?? 'latest'} format={label} onChange={(option) => selectPlateSolution(imagesState, documentKey, option === 'latest' ? undefined : option)} />
			<Notice>Latest solution follows the newest solve that found one. A solve or the header chosen here stays shown when other solves end; the file is never changed.</Notice>
		</CollapsibleSection>
	)
}

interface SkyFootprintProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of its image.
	readonly imageId: string
	// Name of the document.
	readonly name: string
	// Size of its image, in pixels.
	readonly image: { readonly width: number; readonly height: number }
	// Solution shown.
	readonly solution: PlateSolution
}

// Show Footprint in Sky: draws the outline the solution shown gives to the borders of the image on the Sky map, in
// the frame of its stars, and opens Sky panned to its centre. It replaces an earlier footprint and is dropped once the
// document stops showing this image; nothing is solved or sent to a device.
function SkyFootprint({ documentKey, imageId, name, image, solution }: SkyFootprintProps) {
	const footprint = imageFootprint(solution, wcsFrame(solution), image, documentKey, imageId, name)

	function show() {
		if (!footprint) return
		showFootprintInSky(skyImageState, footprint)
		navigate(routeState, { workspace: 'sky' })
	}

	return (
		<CollapsibleSection id="images.plate-solver.sky" title="Sky">
			<Actions>
				<Button variant="secondary" disabled={!footprint} title={footprint ? undefined : 'The solution cannot locate the centre of the image.'} onClick={show}>
					Show Footprint in Sky
				</Button>
			</Actions>
			<Notice>Draws the outline of the image on the Sky map at the time shown, beside the framing of the selection.</Notice>
		</CollapsibleSection>
	)
}

interface VisualizationProps {
	// Key of the document.
	readonly documentKey: string
	// Plate solving state of the document, whose overlay toggles are its own.
	readonly plateSolving: ImagePlateSolvingState
}

// What is drawn over a solved image: the solved centre and the grid, per document, and the appearance of the grid,
// orientation, scale bar, crosshair, and coordinates, per profile. Showing or changing any of them never solves again.
function Visualization({ documentKey, plateSolving }: VisualizationProps) {
	const profiles = useSnapshot(profileState)
	const { grid, coordinates, crosshair, scaleBar, orientation } = imageAstrometrySettings(activeProfile(profiles).settings)
	const editGrid = (patch: Partial<AstrometryGridSettings>) => setImageAstrometrySettings(profileState, { grid: patch })

	return (
		<CollapsibleSection id="images.plate-solver.visualization" title="Visualization">
			<Checkbox label="Show solution centre" checked={plateSolving.overlay} onChange={(overlay) => setPlateSolveOverlay(imagesState, documentKey, { overlay })} />
			<Checkbox label="RA/Dec grid" checked={plateSolving.grid} onChange={(shown) => setPlateSolveOverlay(imagesState, documentKey, { grid: shown })} />
			<Checkbox label="Grid labels" checked={grid.labels} onChange={(labels) => editGrid({ labels })} />
			<Checkbox label="Minor grid lines" checked={grid.minor} onChange={(minor) => editGrid({ minor })} />
			<Slider label="Grid opacity" value={grid.opacity} min={GRID_OPACITY_RANGE[0]} max={GRID_OPACITY_RANGE[1]} step={0.05} onChange={(opacity) => editGrid({ opacity })} />
			<SegmentedControl label="Grid color" options={GRID_COLORS} value={grid.color} format={(color) => GRID_COLOR_LABELS[color]} onChange={(color) => editGrid({ color })} />
			<SegmentedControl label="Orientation" options={ORIENTATION_MODES} value={orientation} format={(mode) => ORIENTATION_LABELS[mode]} onChange={(next) => setImageAstrometrySettings(profileState, { orientation: next })} />
			<Checkbox label="Scale bar" checked={scaleBar} onChange={(shown) => setImageAstrometrySettings(profileState, { scaleBar: shown })} />
			<Checkbox label="Crosshair" checked={crosshair} onChange={(shown) => setImageAstrometrySettings(profileState, { crosshair: shown })} />
			<SegmentedControl label="Coordinates" options={COORDINATE_FORMATS} value={coordinates.format} format={(format) => COORDINATE_FORMAT_LABELS[format]} onChange={(format) => setImageAstrometrySettings(profileState, { coordinates: { ...coordinates, format } })} />
			<NumberInput
				label="Decimals"
				value={coordinates.precision}
				min={COORDINATE_PRECISION_RANGE[0]}
				max={COORDINATE_PRECISION_RANGE[1]}
				onChange={(precision) => setImageAstrometrySettings(profileState, { coordinates: { ...coordinates, precision: Math.round(Math.min(COORDINATE_PRECISION_RANGE[1], Math.max(COORDINATE_PRECISION_RANGE[0], precision))) } })}
			/>
			<Notice>Display only: the aids follow the solution shown, and decimals are not an accuracy.</Notice>
		</CollapsibleSection>
	)
}

// Names of the grid colors.
const GRID_COLOR_LABELS: Readonly<Record<GridColor, string>> = { neutral: 'Neutral', axes: 'Per axis' }

// Names of the orientation modes.
const ORIENTATION_LABELS: Readonly<Record<OrientationMode, string>> = { hidden: 'Hidden', corner: 'Corner', center: 'Centre' }

// Names of the coordinate formats.
const COORDINATE_FORMAT_LABELS: Readonly<Record<CoordinateFormat, string>> = { sexagesimal: 'Sexagesimal', decimal: 'Decimal' }
