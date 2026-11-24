import type { StreakDetectionJob, StreakDetectionRequest, StreakDetectionResult, StreakDetectorSettings } from 'api'
import type { StreakClassification } from 'nebulosa/src/imaging/analysis/streak/classification.types'
import type { Streak } from 'nebulosa/src/imaging/analysis/streak/types'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { analysisElapsed, isActive } from '../analysis'
import { formatClockTime, formatDegrees, formatDuration, formatExposureTime, formatFixed, formatLocalTime, formatPercent, formatPixelLength, formatPixelPosition, formatSignificant, MISSING } from '../format'
import { useActiveTimeZone } from '../location/useLocation'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { activeProfile, profileState, setStreakDetectionSettings, streakDetectionSettings } from '../profile/profile'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { EmptyState } from '../shell/WorkspaceLayout'
import { useStarResult } from '../stars/useStarResult'
import { CLASS_LABELS, cancelStreakDetection, clampStreakSettings, DEFAULT_STREAK_SETTINGS, MIN_LENGTH_LIMITS, runStreakDetection, sameStreakRequest, streaksState } from '../streaks/streaks'
import { useStreakResult } from '../streaks/useStreakResult'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { List, ListItem } from '../ui/List'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SectionHeading } from '../ui/SectionHeading'
import { useNow } from '../useNow'
import { type ImageStreaksState, imagesState, imageUnavailableReason, selectStreak, setStreakView } from './images'
import type { ImageToolPanelProps } from './tools'

// Streak Detection tool of the Images workspace: runs a detection of the straight streaks of the active document on the
// server, on the samples of its image, and reads the frame as a verdict: how many streaks cross it and what they likely
// are, then the streak selected in the list or the viewer, and how the lines are drawn. The panel has two states:
// before the image has a result it is Run Detection above the settings; once a detection runs or has a result, the
// settings fold into one collapsed section and the result takes the panel. The result shown is that of the newest
// completed detection of the image, so a detection that runs, fails, or is cancelled keeps it. The only detector
// setting, the minimum length, is the profile's, shared by every document, and sent only by Run Detection; the context
// of the classification (the plate solution shown and the latest detected stars of the image) is chosen per document
// and frozen by the server when the detection is submitted. A classification is an uncalibrated evidence weight, never
// shown as a probability. The settings are editable before the document has an image (a camera tab waiting for its
// first frame), with Run Detection disabled until it has one; a result always belongs to the image it measured.

// Display names of the WCS sources of a classification, inside a sentence.
const WCS_LABELS = { header: 'the header WCS', plateSolve: 'the plate solution' } as const

// What the evidence score of a classification is, for its tooltip and the Classification section.
const SCORE_NOTE = 'Scores are uncalibrated weights of the evidence in this image, not probabilities; Unknown means the evidence does not single out a class.'

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

	return <StreakDetection documentKey={document.key} imageId={document.info?.id} streaks={view?.streaks} selectedSolution={view?.plateSolving.selected} unavailable={imageUnavailableReason(document)} />
}

interface StreakDetectionProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of its image; absent until it has one.
	readonly imageId?: string
	// Streak state of the document; absent without a view.
	readonly streaks?: ImageStreaksState
	// Solution chosen for the document, whose job the classification may use.
	readonly selectedSolution?: string
	// Why the document has no image yet.
	readonly unavailable?: string
}

// Sections of the Streak Detection panel of a document: Run Detection and the latest job always, then the settings
// until the image has a detection that runs or a result, or the result, the selected streak, and the lines once it has,
// with the settings folded.
function StreakDetection({ documentKey, imageId, streaks, selectedSolution, unavailable }: StreakDetectionProps) {
	const { latest, job, result, resultError } = useStreakResult(imageId)
	const { submitErrors } = useSnapshot(streaksState)
	const profiles = useSnapshot(profileState)
	const settings = streakDetectionSettings(activeProfile(profiles).settings)
	const solution = usePlateSolution(imageId, selectedSolution)
	const { job: starJob } = useStarResult(imageId)
	const plateSolveJobId = solution.job && solution.solution ? solution.job.jobId : undefined
	const starDetectionJobId = starJob?.state === 'completed' ? starJob.jobId : undefined
	const request: StreakDetectionRequest = { settings, ...(streaks?.useSolution && plateSolveJobId && { plateSolveJobId }), ...(streaks?.useStars && starDetectionJobId && { starDetectionJobId }) }
	const settingsProps: SettingsProps = { documentKey, settings, streaks, request, header: solution.header !== undefined, solutionAvailable: plateSolveJobId !== undefined, starsAvailable: starDetectionJobId !== undefined }
	const analysis = <Analysis imageId={imageId} request={request} latest={latest} shown={job} submitError={imageId === undefined ? undefined : submitErrors[imageId]} unavailable={unavailable} />

	if (imageId === undefined || (!job && !isActive(latest))) {
		return (
			<>
				{analysis}
				<CollapsibleSection id="images.streak-detection.detection" title="Detection Settings" summary={settingsSummary(settingsProps)}>
					<SettingsControls {...settingsProps} />
				</CollapsibleSection>
			</>
		)
	}

	const selectedIndex = result && streaks?.selected?.jobId === result.jobId ? streaks.selected.index : undefined
	const streak = selectedIndex === undefined ? undefined : result?.streaks[selectedIndex]
	const classification = selectedIndex === undefined ? undefined : result?.classifications?.[selectedIndex]

	return (
		<>
			{analysis}
			<CollapsibleSection id="images.streak-detection.settings" title="Detection Settings" summary={settingsSummary(settingsProps)} defaultOpen={false}>
				<SettingsControls {...settingsProps} />
			</CollapsibleSection>
			{job && <Verdict job={job} result={result} resultError={resultError} selected={selectedIndex} onSelect={(index) => result && selectStreak(imagesState, documentKey, { jobId: result.jobId, index })} />}
			{result && <SelectedStreak index={selectedIndex} streak={streak} classification={classification} />}
			{streak && <StreakDetails streak={streak} classification={classification} />}
			{result && streaks && (
				<CollapsibleSection id="images.streak-detection.visualization" title="Visualization" summary={streaks.visible ? (streaks.labels ? 'Lines and numbers' : 'Lines') : 'Hidden'} defaultOpen={false}>
					<Checkbox label="Show streaks" checked={streaks.visible} onChange={(visible) => setStreakView(imagesState, documentKey, { visible })} />
					<Checkbox label="Show numbers" checked={streaks.labels} disabled={!streaks.visible} title={streaks.visible ? undefined : 'The streaks are hidden.'} onChange={(labels) => setStreakView(imagesState, documentKey, { labels })} />
				</CollapsibleSection>
			)}
		</>
	)
}

interface SettingsProps {
	// Key of the document.
	readonly documentKey: string
	// Detector settings of the profile.
	readonly settings: StreakDetectorSettings
	// Streak state of the document, which holds its classification context; absent without a view.
	readonly streaks?: ImageStreaksState
	// Request Run Detection sends.
	readonly request: StreakDetectionRequest
	// Whether the image header has a WCS, used when the plate solution is not.
	readonly header: boolean
	// Whether the plate solution shown is a completed job of the image.
	readonly solutionAvailable: boolean
	// Whether the image has a completed star detection.
	readonly starsAvailable: boolean
}

// Returns the settings of the next detection in one line: "Min 10 px · Header WCS · no stars".
function settingsSummary({ settings, request, header }: Pick<SettingsProps, 'settings' | 'request' | 'header'>) {
	const wcs = request.plateSolveJobId ? 'Plate solution' : header ? 'Header WCS' : 'No WCS'
	return `Min ${settings.minLength} px · ${wcs} · ${request.starDetectionJobId ? 'stars' : 'no stars'}`
}

// Settings of the next detection: the shortest streak reported, then what the classification uses. Every threshold
// adapts to the image, so there is no other detector setting. A context the image lacks is unchecked and disabled
// with the reason, whatever the document asks for, so the boxes show what the next detection sends.
function SettingsControls({ documentKey, settings, streaks, solutionAvailable, starsAvailable }: SettingsProps) {
	const edit = (patch: Partial<StreakDetectorSettings>) => setStreakDetectionSettings(profileState, clampStreakSettings({ ...settings, ...patch }))

	return (
		<>
			<NumberInput label="Min length" value={settings.minLength} min={MIN_LENGTH_LIMITS.min} max={MIN_LENGTH_LIMITS.max} suffix="px" onChange={(minLength) => edit({ minLength })} />
			<Notice>In image pixels. The thresholds adapt to each image, so stars, nebulae, the Moon, edges, and sensor rows or columns are left out.</Notice>
			{streaks && (
				<Group title="Classification">
					<Checkbox
						label="Use the plate solution shown"
						checked={streaks.useSolution && solutionAvailable}
						disabled={!solutionAvailable}
						title={solutionAvailable ? undefined : 'This image shows no plate solution of its own.'}
						onChange={(useSolution) => setStreakView(imagesState, documentKey, { useSolution })}
					/>
					<Checkbox label="Use the detected stars" checked={streaks.useStars && starsAvailable} disabled={!starsAvailable} title={starsAvailable ? undefined : 'This image has no completed star detection.'} onChange={(useStars) => setStreakView(imagesState, documentKey, { useStars })} />
					<Notice>Without the plate solution, the header WCS is used when it has one. Nothing is solved or detected for the classification.</Notice>
				</Group>
			)}
			<Button
				variant="secondary"
				className="self-start"
				onClick={() => {
					edit(DEFAULT_STREAK_SETTINGS)
					setStreakView(imagesState, documentKey, { useSolution: true, useStars: true })
				}}
			>
				Reset to Defaults
			</Button>
		</>
	)
}

// Titled group of controls or data inside a section, below a divider.
function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<div className="mt-1 flex flex-col gap-2 border-t border-line-100 pt-3">
			<SectionHeading>{title}</SectionHeading>
			{children}
		</div>
	)
}

// Returns a count of streaks in words: "No streaks", "1 streak", "3 streaks".
function streakCount(count: number) {
	return count === 0 ? 'No streaks' : count === 1 ? '1 streak' : `${count} streaks`
}

// Returns the outcome of a job in words with the tone that tints it: how many streaks it found once completed, a
// clean frame as a success and a crossed one as asking for attention, else its state.
function jobStatus(job: Pick<StreakDetectionJob, 'state' | 'summary'>): { readonly label: string; readonly tone: 'default' | 'success' | 'warning' | 'danger' } {
	switch (job.state) {
		case 'queued':
			return { label: 'Queued', tone: 'default' }
		case 'running':
			return { label: 'Running', tone: 'default' }
		case 'completed': {
			const count = job.summary?.detectedCount ?? 0
			return { label: streakCount(count), tone: count === 0 ? 'success' : 'warning' }
		}
		case 'failed':
			return { label: 'Failed', tone: 'danger' }
		case 'cancelled':
			return { label: 'Cancelled', tone: 'default' }
	}
}

interface AnalysisProps {
	// Server id of the image; absent until the document has one.
	readonly imageId?: string
	// Why the document has no image yet.
	readonly unavailable?: string
	// Request Run Detection sends.
	readonly request: StreakDetectionRequest
	// Latest job of the image, whatever its state.
	readonly latest?: StreakDetectionJob
	// Completed job whose result is shown, which may be older than the latest.
	readonly shown?: StreakDetectionJob
	// Why the latest submission failed.
	readonly submitError?: string
}

// Run Detection and Cancel, each saying why while disabled, with the outcome of the latest job of the image: its state
// and time while it runs, and what it found once it ends. A detection that ends without becoming the result shown
// says which result stays. Run Detection is disabled while the result shown already answers the request, since the
// server would only hand that result back.
function Analysis({ imageId, request, latest, shown, submitError, unavailable }: AnalysisProps) {
	const active = isActive(latest)
	const now = useNow(active)
	const timeZone = useActiveTimeZone()
	const answered = shown !== undefined && sameStreakRequest(shown.request, request)
	const reason = imageId === undefined ? (unavailable ?? 'The document has no image yet.') : active ? 'A detection of this image is running.' : answered ? 'This result already uses these settings; change them to detect again.' : undefined
	const status = latest && jobStatus(latest)
	// The latest detection is not the result shown, which stays.
	const kept = shown !== undefined && latest !== undefined && shown.jobId !== latest.jobId ? formatClockTime(shown.queuedAt, timeZone, { seconds: true, named: true }) : undefined

	return (
		<CollapsibleSection id="images.streak-detection.analysis" title="Analysis" summary={status?.label}>
			<Actions>
				<Button className="max-sm:min-h-12.5" disabled={reason !== undefined} title={reason} onClick={() => imageId !== undefined && void runStreakDetection(streaksState, imageId, request)}>
					Run Detection
				</Button>
				<Button variant="secondary" className="max-sm:min-h-12.5" disabled={!active} title={active ? undefined : 'No detection of this image is running.'} onClick={() => latest && void cancelStreakDetection(latest.jobId)}>
					Cancel
				</Button>
			</Actions>
			{unavailable && <Notice>{unavailable} The settings apply to the next detection.</Notice>}
			{submitError && <Notice error>{submitError}</Notice>}
			{latest && status ? (
				<DataList>
					<DataRow label="Status" tone={status.tone}>
						{status.label}
					</DataRow>
					<DataRow label={active ? 'Elapsed' : 'Duration'}>{formatDuration(analysisElapsed(latest, now) / 1000)}</DataRow>
				</DataList>
			) : (
				imageId !== undefined && <Notice>No detection of this image yet.</Notice>
			)}
			{latest?.state === 'failed' && latest.error && <Notice error>{latest.error}</Notice>}
			{kept && (active ? <Notice>A new detection is running; the result of {kept} stays shown until it completes.</Notice> : <Notice>The result of {kept} stays shown.</Notice>)}
			{shown && !active && !answered && <Notice warning>The settings or the classification context changed since this result; run the detection again to apply them.</Notice>}
		</CollapsibleSection>
	)
}

// Returns how many streaks of a classified result fall in each class, most first: "2 Satellite · 1 Unknown"; undefined
// for a result without classifications or streaks.
function classTally(result: Pick<StreakDetectionResult, 'classifications'>) {
	if (!result.classifications?.length) return undefined
	const counts = new Map<string, number>()
	for (const { class: kind } of result.classifications) counts.set(CLASS_LABELS[kind], (counts.get(CLASS_LABELS[kind]) ?? 0) + 1)
	return [...counts]
		.sort((a, b) => b[1] - a[1])
		.map(([label, count]) => `${count} ${label}`)
		.join(' · ')
}

// Returns what a completed job classified with, in a sentence: "Classified with the header WCS and 412 stars".
function classifiedWith({ summary, context }: Pick<StreakDetectionJob, 'summary' | 'context'>) {
	if (!summary?.classified) return 'Not classified'
	const used = [...(context.wcs ? [WCS_LABELS[context.wcs]] : []), ...(context.starCount ? [`${context.starCount} stars`] : [])]
	return used.length > 0 ? `Classified with ${used.join(' and ')}` : 'Classified without a WCS or stars'
}

interface VerdictProps {
	// Completed job whose result is shown.
	readonly job: StreakDetectionJob
	// Its result, once fetched.
	readonly result?: StreakDetectionResult
	// Why its result could not be fetched.
	readonly resultError?: string
	// Index of the selected streak.
	readonly selected?: number
	// Selects a streak by index.
	readonly onSelect: (index: number) => void
}

// Number of streaks crossing the frame as the one Readout of the panel, how they classify, what the classification
// used and when the frame was taken, then the list of the streaks.
function Verdict({ job, result, resultError, selected, onSelect }: VerdictProps) {
	const timeZone = useActiveTimeZone()
	const count = job.summary?.detectedCount ?? result?.streaks.length ?? 0
	const tally = result && classTally(result)
	const observed = job.context.date === undefined ? undefined : Date.parse(job.context.date)
	const caption = [classifiedWith(job), ...(job.context.exposure === undefined ? [] : [`${formatExposureTime(job.context.exposure)} exposure`]), ...(observed === undefined ? [] : [`taken ${formatLocalTime(observed, timeZone, Date.now())}`])].join(' · ')

	return (
		<CollapsibleSection id="images.streak-detection.results" title="Result" summary={tally ? `${streakCount(count)} · ${tally}` : streakCount(count)}>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3">
				<SectionHeading>Streaks</SectionHeading>
				<span className="ml-auto text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{count}</span>
			</div>
			{tally && <DataRow label="Classes">{tally}</DataRow>}
			<Notice>{caption}</Notice>
			{result?.warnings.map((warning) => (
				<Notice key={warning}>{warning}</Notice>
			))}
			{resultError && <Notice error>{resultError}</Notice>}
			{count === 0 ? (
				<Notice>No streaks cross this frame longer than the minimum length.</Notice>
			) : (
				result && (
					<List emptyText="No streaks." className="max-h-80 overflow-y-auto">
						{result.streaks.map((streak, index) => {
							const kind = result.classifications?.[index]?.class
							return (
								<ListItem
									key={index}
									title={kind ? `${index + 1} · ${CLASS_LABELS[kind]}` : `Streak ${index + 1}`}
									description={`SNR ${formatFixed(streak.snr, 1)} · ${formatDegrees(streak.angle)}`}
									meta={`${formatFixed(streak.length, 0)} px`}
									selected={index === selected}
									onClick={() => onSelect(index)}
								/>
							)
						})}
					</List>
				)
			)}
		</CollapsibleSection>
	)
}

// Returns the name of the class a classification gives, or "Not classified" without one.
function classLabel(classification: StreakClassification | undefined) {
	if (!classification) return 'Not classified'
	return CLASS_LABELS[classification.class]
}

// Returns the most likely alternative of a classification, if any.
function closest(classification: StreakClassification) {
	let best: StreakClassification['alternatives'][number] | undefined
	for (const alternative of classification.alternatives) if (!best || alternative.score > best.score) best = alternative
	return best
}

interface SelectedStreakProps {
	// Index of the streak selected in the result, if any.
	readonly index?: number
	// Streak selected, if any.
	readonly streak?: Streak
	// Its classification, when the result was classified.
	readonly classification?: StreakClassification
}

// What the selected streak likely is, as the headline of the section, with its evidence score, the closest class when it
// is Unknown, and its length, width, SNR, and angle; summarized while collapsed.
function SelectedStreak({ index, streak, classification }: SelectedStreakProps) {
	const alternative = classification?.class === 'unknown' ? closest(classification) : undefined

	return (
		<CollapsibleSection id="images.streak-detection.selected-streak" title="Selected Streak" summary={streak ? `${classLabel(classification)} · ${formatFixed(streak.length, 0)} px · SNR ${formatFixed(streak.snr, 1)}` : undefined}>
			{streak && index !== undefined ? (
				<>
					<div className="flex flex-wrap items-baseline justify-between gap-x-3">
						<SectionHeading>Streak {index + 1}</SectionHeading>
						<span className={classification ? 'ml-auto text-base leading-6 font-semibold text-ink-100' : 'ml-auto text-sm leading-5 text-ink-200'}>{classLabel(classification)}</span>
					</div>
					<DataList>
						{classification && (
							<DataRow label="Evidence score" title={SCORE_NOTE}>
								{formatFixed(classification.confidence, 2)}
							</DataRow>
						)}
						{alternative && <DataRow label="Closest class">{`${CLASS_LABELS[alternative.class]} · ${formatFixed(alternative.score, 2)}`}</DataRow>}
						<DataRow label="Length">{`${formatFixed(streak.length, 1)} px`}</DataRow>
						<DataRow label="Width (FWHM)">{formatPixelLength(streak.width)}</DataRow>
						<DataRow label="SNR">{formatFixed(streak.snr, 1)}</DataRow>
						<DataRow label="Angle">{formatDegrees(streak.angle)}</DataRow>
					</DataList>
				</>
			) : (
				<Notice>No streak selected. Click a line in the image or a streak in the list.</Notice>
			)}
		</CollapsibleSection>
	)
}

// Returns an evidence description with its first letter capitalized, as a data row label.
function capitalize(text: string) {
	return text.charAt(0).toUpperCase() + text.slice(1)
}

// Measurements of the selected streak beyond its headline, one collapsed section each with a summary: where it lies,
// its signal, how well a line fits it, and the evidence of its classification.
function StreakDetails({ streak, classification }: { readonly streak: Streak; readonly classification?: StreakClassification }) {
	return (
		<>
			<CollapsibleSection id="images.streak-detection.geometry" title="Geometry" summary={`Center ${formatPixelPosition(streak.center.x, streak.center.y)}`} defaultOpen={false}>
				<DataList>
					<DataRow label="Start">{formatPixelPosition(streak.start.x, streak.start.y)}</DataRow>
					<DataRow label="End">{formatPixelPosition(streak.end.x, streak.end.y)}</DataRow>
					<DataRow label="Center">{formatPixelPosition(streak.center.x, streak.center.y)}</DataRow>
					<DataRow label="Cut by the border">{streak.clippedAtBorder ? 'Yes' : 'No'}</DataRow>
				</DataList>
			</CollapsibleSection>
			<CollapsibleSection id="images.streak-detection.signal" title="Signal" summary={`Peak ${formatSignificant(streak.peakSignal)}`} defaultOpen={false}>
				<DataList>
					<DataRow label="Flux">{formatSignificant(streak.flux)}</DataRow>
					<DataRow label="Mean signal">{formatSignificant(streak.meanSignal)}</DataRow>
					<DataRow label="Peak signal">{formatSignificant(streak.peakSignal)}</DataRow>
					<DataRow label="Saturated" title={streak.saturationFraction === undefined ? 'The full scale of the sensor is unknown.' : undefined}>
						{streak.saturationFraction === undefined ? MISSING : formatPercent(streak.saturationFraction, 1)}
					</DataRow>
				</DataList>
			</CollapsibleSection>
			<CollapsibleSection id="images.streak-detection.fit" title="Fit" summary={`Confidence ${formatFixed(streak.confidence, 2)}`} defaultOpen={false}>
				<DataList>
					<DataRow label="Linearity">{formatFixed(streak.linearity, 3)}</DataRow>
					<DataRow label="RMS residual">{formatPixelLength(streak.rmsResidual)}</DataRow>
					<DataRow label="Coverage">{formatPercent(streak.coverage)}</DataRow>
					<DataRow label="Detector confidence">{formatFixed(streak.confidence, 2)}</DataRow>
				</DataList>
			</CollapsibleSection>
			{classification && (
				<CollapsibleSection id="images.streak-detection.classification" title="Classification" summary={`${CLASS_LABELS[classification.class]} · ${formatFixed(classification.confidence, 2)}`} defaultOpen={false}>
					{classification.alternatives.length > 0 && (
						<>
							<SectionHeading>Also possible</SectionHeading>
							<DataList>
								{classification.alternatives.map((alternative) => (
									<DataRow key={alternative.class} label={CLASS_LABELS[alternative.class]}>
										{formatFixed(alternative.score, 2)}
									</DataRow>
								))}
							</DataList>
						</>
					)}
					{classification.evidence.length > 0 && (
						<Group title="Evidence">
							<DataList>
								{classification.evidence.map((evidence, index) => (
									<DataRow key={index} label={capitalize(evidence.description ?? evidence.kind)}>
										{formatFixed(evidence.score, 2)}
									</DataRow>
								))}
							</DataList>
						</Group>
					)}
					<Notice>{SCORE_NOTE}</Notice>
				</CollapsibleSection>
			)}
		</>
	)
}
