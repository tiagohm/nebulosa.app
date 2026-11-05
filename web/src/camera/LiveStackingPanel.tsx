import type { CalibrationMasterSummary, LiveMasterKind, LiveStackingCohort, LiveStackingComposition, LiveStackingFrame, LiveStackingRecipe, LiveStackingSession } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { Actions, Notice } from '../equipment-control/parts'
import { formatSize } from '../files/files'
import type { CameraOperationContext } from '../images/cameracontext'
import { selectCameraFrame } from '../images/cameratabs'
import { captureFramesState } from '../images/captureframes'
import { type ImageDocument, imagesState, openImage, selectImageTool } from '../images/images'
import { activeProfile, liveStackingSettings, profileState, setLiveStackingSettings } from '../profile/profile'
import type { LiveStackingSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { formatDuration } from '../tools/calculator/values'
import { CUSTOM_PRESET } from '../tools/imagestacking/presets'
import { Button } from '../ui/Button'
import { DataList, DataRow } from '../ui/DataRow'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { StatusBadge, type StatusTone } from '../ui/StatusBadge'
import { TextInput } from '../ui/TextInput'
import {
	cameraLiveSession,
	closeLiveSession,
	LIVE_FALLBACK_LABELS,
	LIVE_FRAME_OUTCOME_LABELS,
	LIVE_INTERPOLATION_LABELS,
	LIVE_METHOD_LABELS,
	LIVE_NORMALIZATION_LABELS,
	LIVE_STACKING_STATE_LABELS,
	LIVE_WEIGHTING_LABELS,
	liveCameraKey,
	liveSessionActive,
	liveSessionCommand,
	liveStackingRuntime,
	livePresets,
	loadLiveFrames,
	loadLiveMasters,
	saveLiveStack,
	setLiveCalibration,
	startLiveStacking,
} from './livestacking'

// Contextual panel sections of Live Stacking, a camera operation of the Images camera tabs: the session of the tab's
// camera (start, pause, resume, stop, abort, reset, a new field, close) with its frame counts, the stacks of its fields
// by filter and acquisition settings, the masters chosen per filter, the integration recipe, which stack or color
// composition the tab shows, and the latest frame outcomes. The session is the server's, shown here whichever tab
// started it, and keeps running when the panel unmounts or the tab closes; it only ever reads the frames Camera
// Acquisition takes, so the acquisition itself is set up in its own panel. The recipe and masters are the camera's form,
// kept in the profile, and the recipe is locked while a session runs. What the tab shows is display only: stretching a
// stack, or composing it into color, never changes it.

// Kinds of master chosen per filter, in the order they are shown.
const MASTER_KINDS = ['dark', 'flat', 'bias'] as const satisfies readonly LiveMasterKind[]

// Label of each kind of master.
const MASTER_LABELS: Readonly<Record<LiveMasterKind, string>> = { dark: 'Dark', flat: 'Flat', bias: 'Bias' }

// Option of a master select that chooses none.
const NO_MASTER = 'none'

// Tone of the badge of each session state.
const STATE_TONES: Readonly<Record<LiveStackingSession['state'], StatusTone>> = { waiting: 'active', processing: 'active', paused: 'warning', stopping: 'warning', stopped: 'neutral', failed: 'danger' }

// What the camera tab shows.
type DisplayMode = 'frame' | 'stack' | 'color'

// Label of each display mode.
const DISPLAY_LABELS: Readonly<Record<DisplayMode, string>> = { frame: 'Latest frame', stack: 'Stack', color: 'Color' }

// Properties of the Live Stacking panel of a camera tab.
export interface LiveStackingSectionsProps {
	// Camera tab the panel belongs to.
	readonly document: ImageDocument
	// Camera of the tab and its equipment.
	readonly camera: CameraOperationContext
}

// Live Stacking panel sections of a camera tab.
export function LiveStackingSections({ document, camera }: LiveStackingSectionsProps) {
	const runtime = useSnapshot(liveStackingRuntime)
	const profiles = useSnapshot(profileState)
	const { connectionId, deviceId } = camera.camera
	const session = cameraLiveSession(runtime, connectionId, deviceId)
	const settings = liveStackingSettings(activeProfile(profiles).settings, camera.settings)

	return (
		<>
			<SessionSection camera={camera} session={session} settings={settings} />
			{session && <StacksSection document={document} session={session} />}
			<CalibrationSection camera={camera} session={session} settings={settings} />
			<IntegrationSection camera={camera} session={session} settings={settings} />
			{session && <DisplaySection document={document} session={session} />}
			{session && <DiagnosticsSection session={session} />}
		</>
	)
}

interface SessionSectionProps {
	readonly camera: CameraOperationContext
	readonly session?: LiveStackingSession
	readonly settings: Readonly<LiveStackingSettings>
}

// Session of the camera: its state and frame counts, the capture it follows, and its commands.
function SessionSection({ camera, session, settings }: SessionSectionProps) {
	const runtime = useSnapshot(liveStackingRuntime)
	const [confirmReset, setConfirmReset] = useState(false)
	const { connectionId, deviceId } = camera.camera
	const startKey = liveCameraKey(connectionId, deviceId)
	const sessionKey = session ? `session:${session.sessionId}` : ''
	const busy = runtime.pending[startKey] || runtime.pending[sessionKey]
	const active = liveSessionActive(session)
	const error = runtime.errors[startKey] ?? runtime.errors[sessionKey]
	const exposure = session?.cohorts.reduce((total, cohort) => total + cohort.exposure, 0) ?? 0
	const send = (action: Parameters<typeof liveSessionCommand>[2]) => void liveSessionCommand(liveStackingRuntime, session!.sessionId, action)

	return (
		<CollapsibleSection id="images.liveStacking.session" title="Session" summary={session ? LIVE_STACKING_STATE_LABELS[session.state] : 'Not started'}>
			<DataList>
				<DataRow label="Camera">
					<DeviceLink device={camera.device.device} fallback={session?.cameraName ?? 'Not connected'} />
				</DataRow>
				{session && (
					<>
						<DataRow label="State">
							<StatusBadge tone={STATE_TONES[session.state]} label={LIVE_STACKING_STATE_LABELS[session.state]} />
						</DataRow>
						{session.error && (
							<DataRow label="Error" tone="danger">
								{session.error}
							</DataRow>
						)}
						<DataRow label="Capture">{session.capture ? `${session.capture.outputMode === 'preview-only' ? 'Preview only' : 'Preview and save'}${session.capture.ended ? ', ended' : ''}` : 'No frame yet'}</DataRow>
						<DataRow label="Frames">
							{session.counters.accepted} accepted · {session.counters.rejected} rejected · {session.counters.skipped} skipped
							{session.counters.deliveryFailed > 0 && ` · ${session.counters.deliveryFailed} not delivered`}
						</DataRow>
						<DataRow label="Backlog">
							{session.counters.queued} queued · {session.counters.processing} integrating{session.counters.held > 0 && ` · ${session.counters.held} held for a new field`}
						</DataRow>
						<DataRow label="Integration">{formatDuration(exposure)}</DataRow>
						<DataRow label="Memory">
							{formatSize(session.retainedBytes + session.backlogBytes)} of {formatSize(runtime.memoryBudget)}
						</DataRow>
						{session.newFieldRequested && <DataRow label="Field">The next good frame starts a new field</DataRow>}
					</>
				)}
			</DataList>
			<Notice>Frames come from Camera Acquisition of this camera, in either output mode; Live Stacking never commands the camera.</Notice>
			<Actions>
				{!active && (
					<Button disabled={busy} onClick={() => void startLiveStacking(liveStackingRuntime, connectionId, deviceId, settings)}>
						{session ? 'Start New Session' : 'Start'}
					</Button>
				)}
				{session?.state === 'paused' && (
					<Button disabled={busy} onClick={() => send('resume')}>
						Resume
					</Button>
				)}
				{active && session?.state !== 'paused' && (
					<Button variant="secondary" disabled={busy} onClick={() => send('pause')}>
						Pause
					</Button>
				)}
				{active && (
					<Button variant="secondary" disabled={busy} onClick={() => send('stop')}>
						Stop
					</Button>
				)}
				{(active || session?.state === 'stopping') && (
					<Button variant="secondary" disabled={busy} onClick={() => send('abort')}>
						Abort
					</Button>
				)}
				{active && (
					<Button variant="secondary" disabled={busy} onClick={() => send('fields')}>
						New Field
					</Button>
				)}
				{session && session.state !== 'failed' && (
					<Button
						variant="secondary"
						disabled={busy}
						onClick={() => {
							if (!confirmReset) return setConfirmReset(true)
							setConfirmReset(false)
							send('reset')
						}}
					>
						{confirmReset ? 'Discard the Stacks' : 'Reset'}
					</Button>
				)}
				{session && !active && session.state !== 'stopping' && (
					<Button variant="secondary" disabled={busy} onClick={() => void closeLiveSession(liveStackingRuntime, session.sessionId)}>
						Close
					</Button>
				)}
			</Actions>
			{confirmReset && <Notice>Reset discards every stack of the session; saved stacks and captured files stay.</Notice>}
			{error && <Notice error>{error}</Notice>}
		</CollapsibleSection>
	)
}

interface SessionProps {
	readonly document: ImageDocument
	readonly session: LiveStackingSession
}

// Describes the acquisition of a stack in one line.
function acquisitionLabel({ acquisition }: LiveStackingCohort) {
	const parts = [`${acquisition.exposure} s`]
	if (acquisition.gain !== undefined) parts.push(`gain ${acquisition.gain}`)
	if (acquisition.offset !== undefined) parts.push(`offset ${acquisition.offset}`)
	if (acquisition.binX !== undefined) parts.push(`bin ${acquisition.binX}×${acquisition.binY ?? acquisition.binX}`)
	if (acquisition.readoutMode !== undefined) parts.push(acquisition.readoutMode)
	parts.push(`${acquisition.width}×${acquisition.height}`)
	return parts.join(' · ')
}

// Describes the calibration of a stack.
function calibrationLabel({ calibration }: LiveStackingCohort) {
	if (!calibration) return 'Uncalibrated'
	return MASTER_KINDS.flatMap((kind) => (calibration[kind] ? [`${MASTER_LABELS[kind]} #${calibration[kind].masterId}`] : [])).join(' · ')
}

// Stacks of the session by field: filter, acquisition, calibration, frames, exposure, and temperatures; each can be shown
// in the tab and saved as a linear FITS.
function StacksSection({ document, session }: SessionProps) {
	const runtime = useSnapshot(liveStackingRuntime)
	const [saved, setSaved] = useState<Record<string, string>>({})
	const exportKey = `export:${session.sessionId}`

	const save = async (cohortId: string) => {
		const product = await saveLiveStack(liveStackingRuntime, session.sessionId, { cohortId })
		if (product) setSaved((paths) => ({ ...paths, [cohortId]: product.path }))
	}

	return (
		<CollapsibleSection id="images.liveStacking.stacks" title="Filters & Stacks" summary={`${session.cohorts.length} stacks`}>
			{session.fields.length === 0 && <Notice>No stack yet: the first good frame starts the first field.</Notice>}
			{session.fields.map((field) => (
				<div key={field.fieldId} className="flex flex-col gap-2">
					<p className="m-0 text-xs text-ink-300">
						Field {field.index} · {field.width}×{field.height}
						{field.channels === 3 ? ' · color' : ''}
					</p>
					{session.cohorts
						.filter((cohort) => cohort.fieldId === field.fieldId)
						.map((cohort) => (
							<div key={cohort.cohortId} className="flex flex-col gap-1 border-l border-line-200 pl-2">
								<DataList>
									<DataRow label="Filter">{cohort.filter}</DataRow>
									<DataRow label="Acquisition">{acquisitionLabel(cohort)}</DataRow>
									<DataRow label="Calibration">{calibrationLabel(cohort)}</DataRow>
									<DataRow label="Frames">
										{cohort.accepted} · {formatDuration(cohort.exposure)}
									</DataRow>
									{cohort.temperature && (
										<DataRow label="Temperature">
											{cohort.temperature[0].toFixed(1)} to {cohort.temperature[1].toFixed(1)} °C
										</DataRow>
									)}
								</DataList>
								<Actions>
									<Button variant="secondary" onClick={() => void selectCameraFrame(imagesState, document.key, { kind: 'liveStack', sessionId: session.sessionId, target: { cohortId: cohort.cohortId } }, captureFramesState)}>
										Show
									</Button>
									<Button variant="secondary" disabled={runtime.pending[exportKey]} onClick={() => void save(cohort.cohortId)}>
										Save
									</Button>
									{saved[cohort.cohortId] && (
										<Button variant="ghost" onClick={() => void openImage(imagesState, saved[cohort.cohortId])}>
											Open Saved
										</Button>
									)}
								</Actions>
							</div>
						))}
				</div>
			))}
			{session.cohorts.some((cohort, index) => session.cohorts.findIndex((other) => other.fieldId === cohort.fieldId && other.filter === cohort.filter) !== index) && <Notice>A filter with several stacks changed its acquisition settings or masters: frames of different settings never share a stack.</Notice>}
			{runtime.errors[exportKey] && <Notice error>{runtime.errors[exportKey]}</Notice>}
		</CollapsibleSection>
	)
}

interface FormProps {
	readonly camera: CameraOperationContext
	readonly session?: LiveStackingSession
	readonly settings: Readonly<LiveStackingSettings>
}

// Masters chosen per filter, exactly as the headers name it, and what is done with the frames of other filters. The
// Calibration Library lists masters but never chooses one; the server checks each choice against every frame.
function CalibrationSection({ camera, session, settings }: FormProps) {
	const runtime = useSnapshot(liveStackingRuntime)
	const [masters, setMasters] = useState<Readonly<Record<LiveMasterKind, readonly CalibrationMasterSummary[]>>>({ dark: [], flat: [], bias: [] })
	const [filter, setFilter] = useState('')
	const { calibration } = settings
	const sessionKey = session ? `session:${session.sessionId}` : ''
	const filters = [...new Set([...Object.keys(calibration.filters), ...(session?.cohorts.map((cohort) => cohort.filter) ?? [])])].sort()
	const cameraName = session?.cameraName ?? camera.device.device?.name

	useEffect(() => {
		let cancelled = false
		void Promise.all(MASTER_KINDS.map((kind) => loadLiveMasters(kind))).then(([dark, flat, bias]) => {
			if (!cancelled) setMasters({ dark, flat, bias })
		})
		return () => {
			cancelled = true
		}
	}, [])

	const update = (next: LiveStackingSettings['calibration']) => setLiveStackingSettings(profileState, camera.settings, { calibration: next })

	const choose = (name: string, kind: LiveMasterKind, masterId: string) => {
		const current = { ...calibration.filters[name] }
		const master = masters[kind].find((candidate) => String(candidate.masterId) === masterId)
		if (master) current[kind] = { masterId: master.masterId, digest: master.contentDigest }
		else delete current[kind]
		update({ ...calibration, filters: { ...calibration.filters, [name]: current } })
	}

	// Masters of a kind offered for a filter: those of this camera, and for a flat those of the filter.
	const offered = (kind: LiveMasterKind, name: string) =>
		masters[kind].filter((master) => (master.metadata.cameraName === undefined || cameraName === undefined || master.metadata.cameraName === cameraName) && (kind !== 'flat' || master.metadata.filter.value === undefined || master.metadata.filter.value.trim() === name))

	return (
		<CollapsibleSection id="images.liveStacking.calibration" title="Calibration" summary={`${Object.keys(calibration.filters).length} filters`} defaultOpen={false}>
			{filters.length === 0 && <Notice>Add the filters to calibrate, exactly as their headers name them, before their frames arrive.</Notice>}
			{filters.map((name) => (
				<div key={name} className="flex flex-col gap-2 border-l border-line-200 pl-2">
					<p className="m-0 text-xs text-ink-200">{name}</p>
					{MASTER_KINDS.map((kind) => {
						const options = [NO_MASTER, ...offered(kind, name).map((master) => String(master.masterId))]
						const chosen = calibration.filters[name]?.[kind]
						const value = chosen && options.includes(String(chosen.masterId)) ? String(chosen.masterId) : NO_MASTER
						const format = (option: string) => {
							if (option === NO_MASTER) return 'None'
							const master = masters[kind].find((candidate) => String(candidate.masterId) === option)
							return master ? `#${master.masterId} · ${master.frames} frames${master.metadata.exposure.value !== undefined ? ` · ${master.metadata.exposure.value / 1000000} s` : ''}${master.metadata.setTemperature.value !== undefined ? ` · ${master.metadata.setTemperature.value} °C` : ''}` : option
						}
						return <Select key={kind} label={MASTER_LABELS[kind]} options={options} value={value} format={format} onChange={(option) => choose(name, kind, option)} />
					})}
				</div>
			))}
			<div className="flex items-end gap-2">
				<TextInput label="Filter" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} className="flex-1" />
				<Button
					variant="secondary"
					disabled={!filter.trim() || filters.includes(filter.trim())}
					onClick={() => {
						update({ ...calibration, filters: { ...calibration.filters, [filter.trim()]: {} } })
						setFilter('')
					}}
				>
					Add
				</Button>
			</div>
			<SegmentedControl label="Other filters" options={['uncalibrated', 'skip'] as const} value={calibration.otherwise} format={(option) => LIVE_FALLBACK_LABELS[option]} onChange={(otherwise) => update({ ...calibration, otherwise })} />
			{session && liveSessionActive(session) && (
				<>
					<Notice>Applying the masters to the running session starts other stacks for the frames that follow; its stacks so far are never recalibrated.</Notice>
					<Actions>
						<Button variant="secondary" disabled={runtime.pending[sessionKey]} onClick={() => void setLiveCalibration(liveStackingRuntime, session.sessionId, calibration)}>
							Apply to Session
						</Button>
					</Actions>
				</>
			)}
		</CollapsibleSection>
	)
}

// Integration recipe: combination, weighting, normalization, resampling, and the quality limits. A running session keeps
// the recipe it started with.
function IntegrationSection({ camera, session, settings }: FormProps) {
	const { recipe } = settings
	const locked = liveSessionActive(session)
	const shown = locked && session ? session.recipe : recipe
	const update = (patch: Partial<LiveStackingRecipe>) => setLiveStackingSettings(profileState, camera.settings, { recipe: { ...recipe, ...patch } })

	return (
		<CollapsibleSection id="images.liveStacking.integration" title="Quality & Integration" summary={LIVE_METHOD_LABELS[shown.method]} defaultOpen={false}>
			<SegmentedControl label="Combination" options={['average', 'weighted-average'] as const} value={shown.method} format={(method) => LIVE_METHOD_LABELS[method]} onChange={(method) => update({ method })} disabled={locked} />
			{shown.method === 'weighted-average' && <Select label="Weighting" options={['quality', 'snr', 'inverse-hfd', 'stars'] as const} value={shown.weighting} format={(weighting) => LIVE_WEIGHTING_LABELS[weighting]} onChange={(weighting) => update({ weighting })} disabled={locked} />}
			<Select label="Normalization" options={['background-scale', 'scale', 'none'] as const} value={shown.normalization} format={(normalization) => LIVE_NORMALIZATION_LABELS[normalization]} onChange={(normalization) => update({ normalization })} disabled={locked} />
			<Select label="Resampling" options={['bilinear', 'bicubic', 'nearest'] as const} value={shown.interpolation} format={(interpolation) => LIVE_INTERPOLATION_LABELS[interpolation]} onChange={(interpolation) => update({ interpolation })} disabled={locked} />
			<NumberInput label="Minimum stars" value={shown.minStars} min={3} max={100} onChange={(minStars) => update({ minStars })} disabled={locked} />
			<NumberInput label="Minimum overlap" value={Math.round(shown.minOverlap * 100)} min={0} max={100} suffix="%" onChange={(overlap) => update({ minOverlap: overlap / 100 })} disabled={locked} />
			<NumberInput label="Maximum HFD (0 for any)" value={shown.maxHfd ?? 0} min={0} max={50} step={0.1} suffix="px" onChange={(maxHfd) => update({ maxHfd: maxHfd > 0 ? maxHfd : undefined })} disabled={locked} />
			<NumberInput label="Minimum SNR (0 for any)" value={shown.minSnr ?? 0} min={0} max={1000} onChange={(minSnr) => update({ minSnr: minSnr > 0 ? minSnr : undefined })} disabled={locked} />
			{locked && <Notice>Locked: the running session keeps the recipe it started with.</Notice>}
		</CollapsibleSection>
	)
}

// Weight of a source in an output channel of a composition, 0 when absent.
function channelWeight(composition: LiveStackingComposition, channel: 'red' | 'green' | 'blue', source: number) {
	return composition.mix[channel].find((term) => term.plane === source)?.weight ?? 0
}

// Returns a composition with the weight of a source in an output channel set, marked Custom.
function withChannelWeight(composition: LiveStackingComposition, channel: 'red' | 'green' | 'blue', source: number, weight: number): LiveStackingComposition {
	const terms = composition.mix[channel].filter((term) => term.plane !== source)
	return { ...composition, preset: CUSTOM_PRESET, mix: { ...composition.mix, [channel]: weight > 0 ? [...terms, { plane: source, weight }].sort((a, b) => a.plane - b.plane) : terms } }
}

// Returns a composition of every mono stack of a field, each in the channels a preset gives it, or none; for a Custom mix.
function customComposition(cohorts: readonly LiveStackingCohort[], fieldId: string, from?: LiveStackingComposition): LiveStackingComposition {
	const mono = cohorts.filter((cohort) => cohort.fieldId === fieldId && cohort.acquisition.channels === 1)
	const sources = mono.map((cohort) => from?.sources.find((source) => source.cohortId === cohort.cohortId) ?? { cohortId: cohort.cohortId, gain: 1, offset: 0 })
	const terms = (channel: 'red' | 'green' | 'blue') =>
		sources.flatMap((source, plane) => {
			const index = from?.sources.findIndex((candidate) => candidate.cohortId === source.cohortId) ?? -1
			const weight = from && index >= 0 ? channelWeight(from, channel, index) : 0
			return weight > 0 ? [{ plane, weight }] : []
		})
	return { preset: CUSTOM_PRESET, sources, mix: { red: terms('red'), green: terms('green'), blue: terms('blue') } }
}

// What the camera tab shows: the latest frame, one stack, or a color composition of the stacks of one field by a preset or
// a custom mix; each composition can be saved as a linear color FITS. Only the display changes.
function DisplaySection({ document, session }: SessionProps) {
	const images = useSnapshot(imagesState)
	const runtime = useSnapshot(liveStackingRuntime)
	const selection = images.documents.find((candidate) => candidate.key === document.key)?.camera?.selection
	const mode: DisplayMode = selection?.kind !== 'liveStack' || selection.sessionId !== session.sessionId ? 'frame' : 'cohortId' in selection.target ? 'stack' : 'color'
	const mono = session.fields.filter((field) => session.cohorts.some((cohort) => cohort.fieldId === field.fieldId && cohort.acquisition.channels === 1))
	const [fieldId, setFieldId] = useState(mono[0]?.fieldId)
	const field = mono.find((candidate) => candidate.fieldId === fieldId) ?? mono[0]
	const presets = field ? livePresets(session.cohorts, field.fieldId) : []
	const [composition, setComposition] = useState<LiveStackingComposition | undefined>()
	const [saved, setSaved] = useState<string>()
	const exportKey = `export:${session.sessionId}`

	const show = (target: { readonly cohortId: string } | { readonly composition: LiveStackingComposition }) => void selectCameraFrame(imagesState, document.key, { kind: 'liveStack', sessionId: session.sessionId, target }, captureFramesState)

	const showComposition = (next: LiveStackingComposition) => {
		setComposition(next)
		show({ composition: next })
	}

	const changeMode = (next: DisplayMode) => {
		if (next === 'frame') return void selectCameraFrame(imagesState, document.key, { kind: 'latest' }, captureFramesState)
		if (next === 'stack' && session.cohorts[0]) return show({ cohortId: session.cohorts[0].cohortId })
		const resolved = presets.find(({ resolution }) => 'composition' in resolution)?.resolution
		if (resolved && 'composition' in resolved) showComposition(resolved.composition)
		else if (field) showComposition(customComposition(session.cohorts, field.fieldId))
	}

	const shownComposition = selection?.kind === 'liveStack' && 'composition' in selection.target ? selection.target.composition : composition
	const shownCohort = selection?.kind === 'liveStack' && 'cohortId' in selection.target ? selection.target.cohortId : undefined
	const presetNames = [...presets.map(({ preset }) => preset.name), CUSTOM_PRESET]
	const presetMissing = (name: string) => {
		const found = presets.find(({ preset }) => preset.name === name)
		return found && 'missing' in found.resolution ? `No stack of ${found.resolution.missing.join(', ')}` : undefined
	}

	return (
		<CollapsibleSection id="images.liveStacking.display" title="Display & Channels" summary={DISPLAY_LABELS[mode]}>
			<SegmentedControl label="Show" options={['frame', 'stack', 'color'] as const} value={mode} format={(option) => DISPLAY_LABELS[option]} onChange={changeMode} />
			{mode === 'stack' && shownCohort && (
				<Select
					label="Stack"
					options={session.cohorts.map((cohort) => cohort.cohortId)}
					value={shownCohort}
					format={(cohortId) => {
						const cohort = session.cohorts.find((candidate) => candidate.cohortId === cohortId)
						const index = session.fields.find((candidate) => candidate.fieldId === cohort?.fieldId)?.index
						return cohort ? `${cohort.filter} · field ${index} · ${acquisitionLabel(cohort)}` : cohortId
					}}
					onChange={(cohortId) => show({ cohortId })}
				/>
			)}
			{mode === 'color' && field && (
				<>
					{mono.length > 1 && <Select label="Field" options={mono.map((candidate) => candidate.fieldId)} value={field.fieldId} format={(id) => `Field ${mono.find((candidate) => candidate.fieldId === id)?.index}`} onChange={setFieldId} />}
					<Select
						label="Preset"
						options={presetNames}
						value={shownComposition?.preset ?? CUSTOM_PRESET}
						disabledReason={presetMissing}
						onChange={(name) => {
							const found = presets.find(({ preset }) => preset.name === name)
							if (found && 'composition' in found.resolution) showComposition(found.resolution.composition)
							else showComposition(customComposition(session.cohorts, field.fieldId, shownComposition))
						}}
					/>
					{shownComposition && (
						<div className="flex flex-col gap-2">
							{shownComposition.sources.map((source, index) => {
								const cohort = session.cohorts.find((candidate) => candidate.cohortId === source.cohortId)
								return (
									<div key={source.cohortId} className="flex flex-col gap-1 border-l border-line-200 pl-2">
										<p className="m-0 text-xs text-ink-200">{cohort ? `${cohort.filter} · ${acquisitionLabel(cohort)}` : 'Unknown stack'}</p>
										<div className="flex flex-col gap-2">
											{(['red', 'green', 'blue'] as const).map((channel) => (
												<NumberInput
													key={channel}
													label={channel === 'red' ? 'Red weight' : channel === 'green' ? 'Green weight' : 'Blue weight'}
													value={channelWeight(shownComposition, channel, index)}
													min={0}
													max={10}
													step={0.1}
													onChange={(weight) => showComposition(withChannelWeight(shownComposition, channel, index, weight))}
												/>
											))}
										</div>
										<NumberInput label="Gain" value={source.gain} min={0.01} max={100} step={0.1} onChange={(gain) => showComposition({ ...shownComposition, preset: CUSTOM_PRESET, sources: shownComposition.sources.map((candidate, i) => (i === index ? { ...candidate, gain } : candidate)) })} />
									</div>
								)
							})}
							<Actions>
								<Button
									variant="secondary"
									disabled={runtime.pending[exportKey]}
									onClick={() =>
										void saveLiveStack(liveStackingRuntime, session.sessionId, { composition: shownComposition }).then((product) => {
											if (product) setSaved(product.path)
										})
									}
								>
									Save Color
								</Button>
								{saved && (
									<Button variant="ghost" onClick={() => void openImage(imagesState, saved)}>
										Open Saved
									</Button>
								)}
							</Actions>
						</div>
					)}
				</>
			)}
			{mode === 'color' && !field && <Notice>Color needs mono stacks of one field.</Notice>}
			<Notice>Stretching and color mixing change only the display; saved stacks are linear.</Notice>
			<Actions>
				<Button variant="ghost" onClick={() => selectImageTool(imagesState, document.key, 'camera-acquisition')}>
					Open Acquisition
				</Button>
			</Actions>
		</CollapsibleSection>
	)
}

// Text of the reason or measurement of a frame outcome.
function frameDetail(frame: LiveStackingFrame) {
	if (frame.outcome === 'accepted' && frame.measurement) {
		const { stars, hfd, snr } = frame.measurement
		const registration = frame.registration ? ` · Δ ${frame.registration.dx.toFixed(1)}, ${frame.registration.dy.toFixed(1)} px` : ''
		return `${stars} stars${hfd !== undefined ? ` · HFD ${hfd.toFixed(2)}` : ''}${snr !== undefined ? ` · SNR ${snr.toFixed(0)}` : ''}${registration}`
	}

	return frame.detail ?? frame.reason ?? ''
}

// Tone of each frame outcome.
const OUTCOME_TONES: Readonly<Record<LiveStackingFrame['outcome'], 'default' | 'success' | 'danger'>> = { queued: 'default', processing: 'default', held: 'default', accepted: 'success', rejected: 'danger', skipped: 'default', deliveryFailed: 'danger' }

// Latest frame outcomes of the session, newest first, fetched when the section opens and as the session changes.
function DiagnosticsSection({ session }: { readonly session: LiveStackingSession }) {
	const runtime = useSnapshot(liveStackingRuntime)
	const frames = runtime.frames[session.sessionId] ?? []
	const total = session.counters.received

	useEffect(() => {
		const timer = setTimeout(() => void loadLiveFrames(liveStackingRuntime, session.sessionId), 300)
		return () => clearTimeout(timer)
	}, [session.sessionId, total, session.counters.accepted, session.counters.rejected])

	return (
		<CollapsibleSection id="images.liveStacking.diagnostics" title="Diagnostics" summary={`${frames.length} recent frames`} defaultOpen={false}>
			{frames.length === 0 && <Notice>No frame yet.</Notice>}
			<DataList>
				{frames.map((frame) => (
					<DataRow key={frame.sequence} label={`#${frame.sequence} ${frame.filter ?? ''}`} tone={OUTCOME_TONES[frame.outcome]}>
						{LIVE_FRAME_OUTCOME_LABELS[frame.outcome]}
						{frameDetail(frame) && ` · ${frameDetail(frame)}`}
					</DataRow>
				))}
			</DataList>
		</CollapsibleSection>
	)
}
