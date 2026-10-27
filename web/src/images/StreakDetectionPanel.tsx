import type { ImageInfo, StreakDetectionJob, StreakDetectionRequest, StreakDetectionResult, StreakDetectorSettings } from 'api'
import type { StreakClassification } from 'nebulosa/src/imaging/analysis/streak/classification.types'
import type { Streak } from 'nebulosa/src/imaging/analysis/streak/types'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { type ReactNode, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Actions, Notice } from '../equipment-control/parts'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { activeProfile, profileState, setStreakDetectionSettings, streakDetectionSettings } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { EmptyState } from '../shell/WorkspaceLayout'
import { useStarResult } from '../stars/useStarResult'
import { CLASS_LABELS, cancelStreakDetection, clampStreakSettings, DEFAULT_STREAK_SETTINGS, isActive, maxOrientationTolerance, PLANE_LABELS, runStreakDetection, sameStreakRequest, STREAK_LIMITS, STREAK_PLANES, streakPlanes, streaksState } from '../streaks/streaks'
import { useStreakResult } from '../streaks/useStreakResult'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { List, ListItem } from '../ui/List'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { holdCameraFrame } from './cameratabs'
import { type ImageStreaksState, type ImageViewState, imagesState, imageUnavailableReason, selectStreak, setStreakView } from './images'
import type { ImageToolPanelProps } from './tools'

// Streak Detection tool of the Images workspace: runs a detection of the straight streaks of the active document on the
// server, on a native plane of its samples, and shows the outcome, the list of streaks, the streak selected in the list or
// the viewer with its measurements and classification, and how the lines are drawn. The detector settings are the
// profile's, shared by every document, and sent only by Run Detection; the context of the classification (the plate
// solution shown and the latest detected stars of the image) is chosen per document and frozen by the server when the
// detection is submitted. A classification is an uncalibrated evidence weight, never shown as a probability. The
// settings are editable before the document has an image (a camera tab waiting for its first frame), with Run Detection
// disabled until it has one; a result always belongs to the image it measured.

// Text shown for a value the result does not have.
const MISSING = '—'

// Display names of the job states.
const STATE_LABELS: Readonly<Record<StreakDetectionJob['state'], string>> = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }

// Display names of the WCS sources of a classification.
const WCS_LABELS = { header: 'Image header', plateSolve: 'Plate solving' } as const

// Streak Detection panel of the active document.
export function StreakDetectionPanel({ document, view, onOpen }: ImageToolPanelProps) {
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

	return <StreakDetection documentKey={document.key} info={document.info} view={view} unavailable={imageUnavailableReason(document)} />
}

interface StreakDetectionProps {
	// Key of the document.
	readonly documentKey: string
	// Server description of its image; absent until it has one.
	readonly info?: ImageInfo
	// View state of the document; absent without a view.
	readonly view?: ImageViewState
	// Why the document has no image yet.
	readonly unavailable?: string
}

// Sections of the Streak Detection panel of a document: the settings always, the analysis and the results once it has an
// image.
function StreakDetection({ documentKey, info, view, unavailable }: StreakDetectionProps) {
	const imageId = info?.id
	const { job, result, resultError } = useStreakResult(imageId)
	const { submitErrors } = useSnapshot(streaksState)
	const profiles = useSnapshot(profileState)
	const settings = streakDetectionSettings(activeProfile(profiles).settings)
	const streaks = view?.streaks
	const solution = usePlateSolution(imageId, view?.plateSolving.selected)
	const { job: starJob } = useStarResult(imageId)
	const plateSolveJobId = solution.job && solution.solution ? solution.job.jobId : undefined
	const starDetectionJobId = starJob?.state === 'completed' ? starJob.jobId : undefined
	const request: StreakDetectionRequest = { settings, ...(streaks?.useSolution && plateSolveJobId && { plateSolveJobId }), ...(streaks?.useStars && starDetectionJobId && { starDetectionJobId }) }
	const selectedIndex = result && streaks?.selected?.jobId === result.jobId ? streaks.selected.index : undefined
	const cfa = info !== undefined && info.channels === 1 && info.cfa !== undefined
	const planes = info ? streakPlanes(info.channels, cfa) : undefined
	const planeUnavailable = planes && !planes.includes(settings.plane) ? `The ${PLANE_LABELS[settings.plane].toLowerCase()} plane is not one of this image; choose another in Advanced Settings.` : undefined
	const edit = (patch: Partial<StreakDetectorSettings>) => setStreakDetectionSettings(profileState, clampStreakSettings({ ...settings, ...patch }))

	return (
		<>
			<PanelSection title="Detection Settings">
				<DetectionSettings settings={settings} cfa={cfa} onChange={edit} />
			</PanelSection>
			<PanelSection title="Advanced Settings">
				<AdvancedSettings settings={settings} planes={planes} onChange={edit} />
			</PanelSection>
			<Analysis
				documentKey={documentKey}
				imageId={imageId}
				request={request}
				job={job}
				streaks={streaks}
				solutionAvailable={plateSolveJobId !== undefined}
				starsAvailable={starDetectionJobId !== undefined}
				submitError={imageId === undefined ? undefined : submitErrors[imageId]}
				unavailable={unavailable ?? planeUnavailable}
			/>
			{imageId !== undefined && (
				<>
					<Results job={job} result={result} resultError={resultError} selected={selectedIndex} onSelect={(index) => result && selectStreak(imagesState, documentKey, { jobId: result.jobId, index })} />
					<SelectedStreak streak={selectedIndex === undefined ? undefined : result?.streaks[selectedIndex]} classification={selectedIndex === undefined ? undefined : result?.classifications?.[selectedIndex]} />
				</>
			)}
			{streaks && (
				<PanelSection title="Visualization">
					<Checkbox label="Show streaks" checked={streaks.visible} onChange={(visible) => setStreakView(imagesState, documentKey, { visible })} />
					<Checkbox label="Show labels" checked={streaks.labels} disabled={!streaks.visible} onChange={(labels) => setStreakView(imagesState, documentKey, { labels })} />
					<Notice>Click a line in the image or a streak in the list to inspect it. Showing or hiding the lines never runs a detection.</Notice>
				</PanelSection>
			)}
		</>
	)
}

interface SettingsProps {
	// Detector settings of the profile.
	readonly settings: StreakDetectorSettings
	// Called with the settings changed.
	readonly onChange: (patch: Partial<StreakDetectorSettings>) => void
}

// Main settings of the detector: what a streak must be to be reported.
function DetectionSettings({ settings, cfa, onChange }: SettingsProps & { readonly cfa: boolean }) {
	return (
		<>
			<NumberInput label="Min length" value={settings.minLength} min={STREAK_LIMITS.minLength.min} max={10000} suffix="px" onChange={(minLength) => onChange({ minLength })} />
			<NumberInput label="Max width (FWHM)" value={settings.maxWidth} min={cfa ? 2 : STREAK_LIMITS.maxWidth.min} max={STREAK_LIMITS.maxWidth.max} step={0.5} suffix="px" onChange={(maxWidth) => onChange({ maxWidth })} />
			<NumberInput label="Min SNR" value={settings.minSNR} min={STREAK_LIMITS.minSNR.min} max={1000} step={0.5} onChange={(minSNR) => onChange({ minSNR })} />
			<NumberInput label="Min linearity" value={settings.minLinearity} min={STREAK_LIMITS.minLinearity.min} max={STREAK_LIMITS.minLinearity.max} step={0.05} onChange={(minLinearity) => onChange({ minLinearity })} />
			<NumberInput label="Max streaks" value={settings.maxStreaks} min={STREAK_LIMITS.maxStreaks.min} max={STREAK_LIMITS.maxStreaks.max} onChange={(maxStreaks) => onChange({ maxStreaks })} />
			<Checkbox label="Keep streaks cut by the image border" checked={settings.allowBorderClipping} onChange={(allowBorderClipping) => onChange({ allowBorderClipping })} />
			<Notice>Lengths and widths are in image pixels. A CFA mosaic is measured on one color plane, so its widths are at least 2 px.</Notice>
			<Button variant="secondary" className="self-start" onClick={() => onChange(DEFAULT_STREAK_SETTINGS)}>
				Reset to Defaults
			</Button>
		</>
	)
}

// Returns an angle in radians as degrees rounded to 0.001°, for an input field.
function degrees(angle: number): number {
	return Math.round(toDeg(angle) * 1000) / 1000
}

// Plane and algorithm settings of the detector, folded by default.
function AdvancedSettings({ settings, planes, onChange }: SettingsProps & { readonly planes?: readonly StreakDetectorSettings['plane'][] }) {
	const tolerance = degrees(maxOrientationTolerance(settings.angleStep))

	return (
		<details>
			<summary className="cursor-pointer text-ink-200 select-none">Plane and algorithm</summary>
			<div className="mt-2 flex flex-col gap-2">
				<Select label="Analysis plane" options={STREAK_PLANES} value={settings.plane} format={(plane) => PLANE_LABELS[plane]} disabledReason={(plane) => (planes && !planes.includes(plane) ? 'Not a plane of this image.' : undefined)} onChange={(plane) => onChange({ plane })} />
				<Notice>Automatic measures a mono image, the green channel of a color image, or the first green plane of a CFA mosaic, never a debayered or stretched copy.</Notice>
				<NumberInput label="Background cell" value={settings.backgroundCellSize} min={STREAK_LIMITS.backgroundCellSize.min} max={1024} suffix="px" onChange={(backgroundCellSize) => onChange({ backgroundCellSize })} />
				<NumberInput label="Signal threshold" value={settings.thresholdSigma} min={STREAK_LIMITS.thresholdSigma.min} max={STREAK_LIMITS.thresholdSigma.max} step={0.1} suffix="σ" onChange={(thresholdSigma) => onChange({ thresholdSigma })} />
				<NumberInput label="Gradient threshold" value={settings.gradientSigma} min={STREAK_LIMITS.gradientSigma.min} max={STREAK_LIMITS.gradientSigma.max} step={0.1} suffix="σ" onChange={(gradientSigma) => onChange({ gradientSigma })} />
				<NumberInput label="Min coherence" value={settings.minCoherence} min={STREAK_LIMITS.minCoherence.min} max={STREAK_LIMITS.minCoherence.max} step={0.05} onChange={(minCoherence) => onChange({ minCoherence })} />
				<NumberInput label="Angle step" value={degrees(settings.angleStep)} min={degrees(STREAK_LIMITS.angleStep.min)} max={10} step={0.1} suffix="°" onChange={(angleStep) => onChange({ angleStep: deg(angleStep) })} />
				<NumberInput label="Orientation tolerance" value={degrees(settings.orientationTolerance)} min={0} max={tolerance} step={0.1} suffix="°" onChange={(orientationTolerance) => onChange({ orientationTolerance: deg(orientationTolerance) })} />
				<NumberInput label="Distance step" value={settings.distanceStep} min={STREAK_LIMITS.distanceStep.min} max={16} step={0.25} suffix="px" onChange={(distanceStep) => onChange({ distanceStep })} />
				<NumberInput label="Max candidates" value={settings.maxCandidates} min={STREAK_LIMITS.maxCandidates.min} max={STREAK_LIMITS.maxCandidates.max} onChange={(maxCandidates) => onChange({ maxCandidates })} />
				<NumberInput label="Merge angle" value={degrees(settings.mergeAngleTolerance)} min={0} max={degrees(STREAK_LIMITS.mergeAngleTolerance.max)} step={0.1} suffix="°" onChange={(mergeAngleTolerance) => onChange({ mergeAngleTolerance: deg(mergeAngleTolerance) })} />
				<NumberInput label="Merge gap" value={settings.mergeGap} min={0} max={10000} suffix="px" onChange={(mergeGap) => onChange({ mergeGap })} />
				<NumberInput label="Merge distance" value={settings.mergeDistance} min={0} max={1000} step={0.5} suffix="px" onChange={(mergeDistance) => onChange({ mergeDistance })} />
				<Notice>
					The background cell and the distance step are in pixels of the analysis plane, which are 2 image pixels apart on a CFA mosaic. Bright pixels whose gradients are less coherent than the min coherence (stars, hot pixels) are ignored, so a trail among many stars is still found; 0 keeps them, which a
					dotted trail of very short dashes needs. The orientation tolerance is at most {tolerance}° with this angle step.
				</Notice>
			</div>
		</details>
	)
}

interface AnalysisProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of the image; absent until the document has one.
	readonly imageId?: string
	// Why no detection can run yet.
	readonly unavailable?: string
	// Request Run Detection sends.
	readonly request: StreakDetectionRequest
	// Latest job of the image.
	readonly job?: StreakDetectionJob
	// Streak state of the document; absent without a view.
	readonly streaks?: ImageStreaksState
	// Whether the plate solution shown is a completed job of the image.
	readonly solutionAvailable: boolean
	// Whether the image has a completed star detection.
	readonly starsAvailable: boolean
	// Why the latest submission failed.
	readonly submitError?: string
}

// Run and Cancel, the context of the classification, and the state of the latest job. Running holds the frame a camera
// tab shows first, so the frame analyzed stays shown.
function Analysis({ documentKey, imageId, request, job, streaks, solutionAvailable, starsAvailable, submitError, unavailable }: AnalysisProps) {
	const active = isActive(job)
	const now = useNow(active)
	const changed = job && !sameStreakRequest(job.request, request)

	return (
		<PanelSection title="Analysis">
			{streaks && (
				<>
					<Checkbox label="Classify with the plate solution shown" checked={streaks.useSolution} disabled={!solutionAvailable} onChange={(useSolution) => setStreakView(imagesState, documentKey, { useSolution })} />
					<Checkbox label="Classify with the detected stars" checked={streaks.useStars} disabled={!starsAvailable} onChange={(useStars) => setStreakView(imagesState, documentKey, { useStars })} />
					<Notice>Without a plate solution, the WCS of the image header is used when it has one. Nothing is solved or detected for the classification.</Notice>
				</>
			)}
			<Actions>
				<Button
					disabled={active || imageId === undefined || unavailable !== undefined}
					onClick={() => {
						if (imageId === undefined) return
						holdCameraFrame(imagesState, documentKey)
						void runStreakDetection(streaksState, imageId, request)
					}}
				>
					Run Detection
				</Button>
				<Button variant="secondary" disabled={!active || !job} onClick={() => job && void cancelStreakDetection(job.jobId)}>
					Cancel
				</Button>
			</Actions>
			{unavailable && <Notice>{unavailable} The settings apply to the next detection.</Notice>}
			{submitError && <Notice error>{submitError}</Notice>}
			{job ? (
				<>
					<Property label="Status">{STATE_LABELS[job.state]}</Property>
					<Property label="Elapsed">{formatSeconds(elapsedOf(job, now))}</Property>
					<Property label="WCS">{job.context.wcs ? WCS_LABELS[job.context.wcs] : 'None'}</Property>
					<Property label="Stars">{job.context.starCount ?? 'None'}</Property>
					<Property label="Exposure">{job.context.exposure === undefined ? MISSING : `${job.context.exposure} s`}</Property>
					<Property label="Observation">{job.context.date ?? MISSING}</Property>
					{job.error && <Notice error>{job.error}</Notice>}
					{changed && <Notice>The settings or the context changed since this detection; run it again to apply them.</Notice>}
				</>
			) : (
				imageId !== undefined && <Notice>No detection of this image yet.</Notice>
			)}
		</PanelSection>
	)
}

interface ResultsProps {
	// Latest job of the image.
	readonly job?: StreakDetectionJob
	// Its result, once fetched.
	readonly result?: StreakDetectionResult
	// Why its result could not be fetched.
	readonly resultError?: string
	// Index of the selected streak.
	readonly selected?: number
	// Selects a streak by index.
	readonly onSelect: (index: number) => void
}

// Counts of the latest completed job and the list of its streaks.
function Results({ job, result, resultError, selected, onSelect }: ResultsProps) {
	const summary = job?.summary

	return (
		<PanelSection title="Results">
			{summary ? (
				<>
					<Property label="Detected streaks">{summary.detectedCount}</Property>
					<Property label="Classified">{summary.classified ? 'Yes' : 'No'}</Property>
					<Property label="Duration">{formatSeconds(summary.elapsed)}</Property>
					{result?.warnings.map((warning) => (
						<Notice key={warning}>{warning}</Notice>
					))}
					{resultError && <Notice error>{resultError}</Notice>}
					{result && (
						<List emptyText="No streaks detected." className="max-h-80 overflow-y-auto">
							{result.streaks.map((streak, index) => (
								<ListItem key={index} title={`Streak ${index + 1}`} description={CLASS_LABELS[result.classifications?.[index]?.class ?? 'unknown']} meta={`${streak.length.toFixed(0)} px`} selected={index === selected} onClick={() => onSelect(index)} />
							))}
						</List>
					)}
				</>
			) : (
				<Notice>{job && isActive(job) ? 'Detecting…' : 'No results.'}</Notice>
			)}
		</PanelSection>
	)
}

interface SelectedStreakProps {
	// Streak selected, if any.
	readonly streak?: Streak
	// Its classification, when the result was classified.
	readonly classification?: StreakClassification
}

// Measurements and classification of the streak selected in the list or the viewer.
function SelectedStreak({ streak, classification }: SelectedStreakProps) {
	return (
		<PanelSection title="Selected Streak">
			{streak ? (
				<>
					<Property label="Start">{formatPoint(streak.start)}</Property>
					<Property label="End">{formatPoint(streak.end)}</Property>
					<Property label="Center">{formatPoint(streak.center)}</Property>
					<Property label="Length">{streak.length.toFixed(1)} px</Property>
					<Property label="Width (FWHM)">{streak.width.toFixed(2)} px</Property>
					<Property label="Angle">{toDeg(streak.angle).toFixed(2)}°</Property>
					<Property label="SNR">{streak.snr === undefined ? MISSING : streak.snr.toFixed(1)}</Property>
					<Property label="Linearity">{streak.linearity.toFixed(3)}</Property>
					<Property label="RMS residual">{streak.rmsResidual.toFixed(2)} px</Property>
					<Property label="Coverage">{(streak.coverage * 100).toFixed(0)}%</Property>
					<Property label="Support">{streak.supportPixels} px</Property>
					<Property label="Cut by the border">{streak.clippedAtBorder ? 'Yes' : 'No'}</Property>
					<Property label="Flux">{formatSignal(streak.flux)}</Property>
					<Property label="Mean signal">{formatSignal(streak.meanSignal)}</Property>
					<Property label="Peak signal">{formatSignal(streak.peakSignal)}</Property>
					<Property label="Saturated">{streak.saturationFraction === undefined ? MISSING : `${(streak.saturationFraction * 100).toFixed(1)}%`}</Property>
					<Property label="Detector confidence">{streak.confidence.toFixed(2)}</Property>
					<Classification classification={classification} />
				</>
			) : (
				<Notice>No streak selected.</Notice>
			)}
		</PanelSection>
	)
}

// Class of a streak, its evidence score, the alternatives, and the evidence that voted.
function Classification({ classification }: { readonly classification?: StreakClassification }) {
	if (!classification) return <Property label="Class">{MISSING}</Property>

	return (
		<>
			<Property label="Class">{CLASS_LABELS[classification.class]}</Property>
			<Property label="Evidence score">{classification.confidence.toFixed(2)}</Property>
			<Notice>The evidence score is an uncalibrated weight of the evidence available in this image, not a probability; Unknown means the evidence does not single out a class.</Notice>
			{classification.alternatives.length > 0 && (
				<>
					<span className="text-xs text-ink-300">Alternatives</span>
					{classification.alternatives.map((alternative) => (
						<Property key={alternative.class} label={CLASS_LABELS[alternative.class]}>
							{alternative.score.toFixed(2)}
						</Property>
					))}
				</>
			)}
			{classification.evidence.length > 0 && (
				<>
					<span className="text-xs text-ink-300">Evidence</span>
					{classification.evidence.map((evidence, index) => (
						<Property key={index} label={evidence.description ?? evidence.kind}>
							{evidence.score.toFixed(2)}
						</Property>
					))}
				</>
			)}
		</>
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

// Returns the current time in Unix milliseconds, refreshed every second while running.
function useNow(running: boolean): number {
	const [now, setNow] = useState(() => Date.now())

	useEffect(() => {
		if (!running) return
		setNow(Date.now())
		const timer = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [running])

	return now
}

// Returns how long a job ran, or has been running, in milliseconds; 0 while it waits.
function elapsedOf(job: StreakDetectionJob, now: number): number {
	if (job.summary) return job.summary.elapsed
	if (job.startedAt === undefined) return 0
	return (job.endedAt ?? now) - job.startedAt
}

// Returns a duration in milliseconds as seconds with two decimals below 10 s, one above.
function formatSeconds(milliseconds: number): string {
	const seconds = milliseconds / 1000
	return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`
}

// Returns a point in pixels with one decimal.
function formatPoint({ x, y }: Streak['start']): string {
	return `${x.toFixed(1)}, ${y.toFixed(1)} px`
}

// Returns a signal in normalized sample units with four significant digits, in exponential notation when large or small.
function formatSignal(value: number): string {
	return value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-2) ? value.toExponential(3) : value.toPrecision(4)
}
