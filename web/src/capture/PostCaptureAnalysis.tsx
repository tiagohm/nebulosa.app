import type { CaptureAnalysisState, CaptureFrame, PostCaptureAnalysisPolicy } from 'api'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { Notice } from '../equipment-control/parts'
import type { CameraRole } from '../equipment/roles'
import { activeProfile, analysisSettings, profileState, setAnalysisSettings } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { AcceptanceControls, DetectorControls, DetectorSettingsControls, useAstapConfigured } from '../stars/StarRequestControls'
import { PROVIDER_LABELS } from '../stars/stars'
import { useStarResult } from '../stars/useStarResult'
import { Checkbox } from '../ui/Checkbox'
import { SegmentedControl } from '../ui/SegmentedControl'

// Post-Capture Analysis section of the Camera Capture panel: whether the next capture detects the stars of
// its frames, how frames are forwarded (Every Frame or Latest Frame Only), the detector settings collapsed
// below, and whether the markers are drawn, all kept per camera view in the profile and off by default. It
// also shows the analysis counters of the running or last capture and the compact result of the frame
// shown; the detailed inspection of a frame stays in Images → Star Detection. The analysis itself runs on
// the server: showing or hiding the markers, or leaving the workspace, never changes it.

// Processing policies, in display order.
const POLICIES: readonly PostCaptureAnalysisPolicy[] = ['everyFrame', 'latestFrame']

// Label of each processing policy.
const POLICY_LABELS: Readonly<Record<PostCaptureAnalysisPolicy, string>> = { everyFrame: 'Every Frame', latestFrame: 'Latest Frame Only' }

// What each processing policy does to the capture.
const POLICY_NOTES: Readonly<Record<PostCaptureAnalysisPolicy, string>> = {
	everyFrame: 'Every frame is analyzed; when the analysis lags, the next exposure waits for it on top of the delay.',
	latestFrame: 'The newest frame is analyzed; frames still waiting are skipped, and the capture never waits.',
}

// Text of the analysis state of the frame shown, by job state.
const FRAME_ANALYSIS_LABELS = { queued: 'Pending', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped' } as const

export interface PostCaptureAnalysisProps {
	// Camera role of the view.
	readonly role: CameraRole
	// Whether a running capture locks the settings.
	readonly locked: boolean
	// Analysis state of the running or last capture of the camera.
	readonly state?: CaptureAnalysisState
	// Frame shown.
	readonly frame?: CaptureFrame
}

// Post-Capture Analysis section.
export function PostCaptureAnalysis({ role, locked, state, frame }: PostCaptureAnalysisProps) {
	const profiles = useSnapshot(profileState)
	const settings = analysisSettings(activeProfile(profiles).settings.capture, role)
	const astapConfigured = useAstapConfigured()
	const update = (patch: Parameters<typeof setAnalysisSettings>[2]) => setAnalysisSettings(profileState, role, patch)

	return (
		<PanelSection title="Post-Capture Analysis">
			<Checkbox label="Enable star detection" checked={settings.enabled} disabled={locked} onChange={(enabled) => update({ enabled })} />
			{settings.enabled && (
				<>
					<SegmentedControl label="Processing Policy" options={POLICIES} value={settings.policy} format={(policy) => POLICY_LABELS[policy]} disabled={locked} onChange={(policy) => update({ policy })} />
					<Notice>{POLICY_NOTES[settings.policy]}</Notice>
					<details>
						<summary className="cursor-pointer text-ink-200 select-none">{PROVIDER_LABELS[settings.request.detector.provider]} detector settings</summary>
						<div className="mt-2 flex flex-col gap-2">
							<DetectorControls request={settings.request} disabled={locked} onChange={(request) => update({ request })} />
							<DetectorSettingsControls request={settings.request} disabled={locked} onChange={(request) => update({ request })} />
							<AcceptanceControls request={settings.request} disabled={locked} onChange={(request) => update({ request })} />
						</div>
					</details>
					{settings.request.detector.provider === 'astap' && !astapConfigured && <Notice error>ASTAP is not configured: a capture with this analysis cannot start.</Notice>}
				</>
			)}
			<Checkbox label="Show star overlay" checked={settings.overlay} onChange={(overlay) => update({ overlay })} />
			{state && <AnalysisCounters state={state} />}
			{frame && state && <FrameAnalysis frame={frame} />}
		</PanelSection>
	)
}

// Counters of the analysis of the running or last capture, apart from its captured and saved frames.
function AnalysisCounters({ state }: { readonly state: CaptureAnalysisState }) {
	return (
		<>
			<dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1">
				<Count label="Analyzed">{state.analyzed}</Count>
				<Count label="Pending">{state.pending}</Count>
				<Count label="Failed">{state.failed}</Count>
				<Count label="Skipped">{state.skipped}</Count>
			</dl>
			{state.waiting && <Notice>Waiting for analysis capacity.</Notice>}
			{state.halted && <Notice error>Analysis stopped: {state.halted}</Notice>}
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

// Compact star detection result of the frame shown, matched by its image id.
function FrameAnalysis({ frame }: { readonly frame: CaptureFrame }) {
	const { job } = useStarResult(frame.imageId)
	const summary = job?.summary

	return (
		<dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line-100 pt-2">
			<Count label={`Frame #${frame.generation}`}>{job ? FRAME_ANALYSIS_LABELS[job.state] : 'Not analyzed'}</Count>
			{job && summary && (
				<>
					<Count label="Detector">{PROVIDER_LABELS[job.request.detector.provider]}</Count>
					<Count label="Stars">
						{summary.acceptedCount} / {summary.detectedCount}
					</Count>
					<Count label="HFD">{summary.aggregateHfd === undefined ? '—' : `${summary.aggregateHfd.toFixed(2)} px`}</Count>
					<Count label="Duration">{(summary.elapsed / 1000).toFixed(2)} s</Count>
				</>
			)}
			{job?.error && <dd className="col-span-2 m-0 text-xs leading-4 text-danger">{job.error}</dd>}
		</dl>
	)
}
