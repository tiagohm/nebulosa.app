import type { CalibrationMasterSummary, LiveMasterKind, LiveStackingCohort, LiveStackingComposition, LiveStackingRecipe, LiveStackingSession } from 'api'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { calibrationLibraryRuntime } from '../calibrationlibrary/calibrationlibrary'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { DeviceLink } from '../equipment-control/DeviceLink'
import { CatalogCameraNotice, useBoundCamera } from '../equipment/CatalogCameraNotice'
import { formatByteSize, formatDuration, formatExposureTime, formatTemperature } from '../format'
import type { CameraOperationContext } from '../images/cameracontext'
import { selectCameraFrame } from '../images/cameratabs'
import { captureFramesState } from '../images/captureframes'
import { type ImageDocument, imagesState, openImage, selectImageTool } from '../images/images'
import { activeProfile, liveStackingSettings, profileState, setLiveStackingSettings } from '../profile/profile'
import type { LiveStackingSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { CUSTOM_PRESET } from '../tools/imagestacking/presets'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { NumberInput } from '../ui/NumberInput'
import { SectionHeading } from '../ui/SectionHeading'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { StatusBadge, type StatusTone } from '../ui/StatusBadge'
import {
	calibrationFilters,
	cameraLiveSession,
	closeLiveSession,
	LIVE_FALLBACK_LABELS,
	LIVE_INTERPOLATION_LABELS,
	LIVE_MASTER_LABELS,
	LIVE_MASTER_ORDER,
	LIVE_METHOD_LABELS,
	LIVE_NORMALIZATION_LABELS,
	LIVE_SKIP_LABELS,
	LIVE_WEIGHTING_LABELS,
	liveAcquisitionLabel,
	liveCameraKey,
	liveDiscardText,
	liveIntegration,
	liveNoneStacked,
	liveSessionActive,
	liveSessionCommand,
	liveStackingRuntime,
	livePresets,
	liveSkips,
	liveStacks,
	liveStateLabel,
	loadLiveMasters,
	NO_FILTER,
	removeFilterCalibration,
	saveLiveStack,
	setLiveCalibration,
	startLiveStacking,
	wheelFilterNames,
} from './livestacking'

// Contextual panel sections of Live Stacking, a camera operation of the Images camera tabs: the session of the tab's
// camera (start, pause, resume, stop, abort, reset, a new field, close) led by what it stacked, with its frame counts and
// why frames were skipped, the masters chosen per filter, the integration recipe, and which stack or color composition
// the tab shows, saved from here. The session is the server's, shown here whichever tab
// started it, and keeps running when the panel unmounts or the tab closes; it only ever reads the frames Camera
// Acquisition takes, so the acquisition itself is set up in its own panel. The recipe and masters are the camera's form,
// kept in the profile, and the recipe is locked while a session runs. What the tab shows is display only: stretching a
// stack, or composing it into color, never changes it.

// HFD limit a recipe takes when the operator turns it on, in pixels, to be tuned to the seeing and the image scale;
// valid from 0.1 to 50 px.
const DEFAULT_MAX_HFD = 5

// SNR limit a recipe takes when the operator turns it on, to be tuned to the target; valid from 1 to 1000.
const DEFAULT_MIN_SNR = 10

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
			<SessionSection document={document} camera={camera} session={session} settings={settings} />
			<CalibrationSection camera={camera} session={session} settings={settings} />
			<IntegrationSection camera={camera} session={session} settings={settings} />
			{session && <DisplaySection document={document} session={session} />}
		</>
	)
}

interface SessionSectionProps {
	readonly document: ImageDocument
	readonly camera: CameraOperationContext
	readonly session?: LiveStackingSession
	readonly settings: Readonly<LiveStackingSettings>
}

// Session of the camera: what it stacked so far as the one Readout of the panel, its state and frame counts with why
// frames were skipped, the capture it follows, and its commands. The routine commands come first; Abort, Reset, and
// Close stand apart, and those that discard stacks ask first while the session holds any.
function SessionSection({ document, camera, session, settings }: SessionSectionProps) {
	const runtime = useSnapshot(liveStackingRuntime)
	const { connectionId, deviceId } = camera.camera
	const startKey = liveCameraKey(connectionId, deviceId)
	const sessionKey = session ? `session:${session.sessionId}` : ''
	const busy = runtime.pending[startKey] || runtime.pending[sessionKey]
	const active = liveSessionActive(session)
	const stopping = session?.state === 'stopping'
	const error = runtime.errors[startKey] ?? runtime.errors[sessionKey]
	const noneStacked = session !== undefined && liveNoneStacked(session)
	const skips = session ? liveSkips(session) : []
	// What closing, starting anew, or resetting would discard; a failed session already lost its stacks.
	const discards = session && session.state !== 'failed' ? liveDiscardText(session) : undefined
	// Whether a capture that has not ended feeds the session.
	const fed = session?.capture !== undefined && !session.capture.ended
	// Guarded rather than asserted: the React Compiler of the executable reads an asserted `session!.sessionId` during the
	// render to memoize this closure, which throws while the camera has no session.
	const send = (action: Parameters<typeof liveSessionCommand>[2]) => session && void liveSessionCommand(liveStackingRuntime, session.sessionId, action)
	const start = () => void startLiveStacking(liveStackingRuntime, connectionId, deviceId, settings)
	const close = () => session && void closeLiveSession(liveStackingRuntime, session.sessionId)

	return (
		<CollapsibleSection id="images.liveStacking.session" title="Session" summary={session ? liveStateLabel(session) : 'Not started'}>
			{session && <SessionReadout session={session} />}
			<DataList>
				<DataRow label="Camera">
					<DeviceLink device={camera.device.device} fallback={session?.cameraName ?? 'Not connected'} />
				</DataRow>
				{session && (
					<>
						<DataRow label="State">
							<StatusBadge tone={noneStacked ? 'warning' : STATE_TONES[session.state]} label={liveStateLabel(session)} />
						</DataRow>
						{session.error && (
							<DataRow label="Error" tone="danger">
								{session.error}
							</DataRow>
						)}
						<DataRow label="Capture">{session.capture ? `${session.capture.outputMode === 'preview-only' ? 'Preview only' : 'Preview and save'}${session.capture.ended ? ', ended' : ''}` : 'No frame yet'}</DataRow>
						{session.counters.rejected > 0 && <DataRow label="Rejected">{frameCount(session.counters.rejected)}</DataRow>}
						{session.counters.skipped > 0 && (
							<DataRow label="Skipped" tone={noneStacked ? 'warning' : undefined}>
								{frameCount(session.counters.skipped)}
							</DataRow>
						)}
						{session.counters.deliveryFailed > 0 && (
							<DataRow label="Not delivered" tone="warning">
								{frameCount(session.counters.deliveryFailed)}
							</DataRow>
						)}
						{(active || stopping) && (
							<DataRow label="Backlog">
								{session.counters.queued} queued · {session.counters.processing} integrating{session.counters.held > 0 && ` · ${session.counters.held} held for a new field`}
							</DataRow>
						)}
						<DataRow label="Memory">
							{formatByteSize(session.retainedBytes + session.backlogBytes)} of {formatByteSize(runtime.memoryBudget)}
						</DataRow>
						{session.newFieldRequested && <DataRow label="Field">The next good frame starts a new field</DataRow>}
					</>
				)}
			</DataList>
			{skips.length > 0 && <Notice warning={noneStacked}>{skips.map(({ reason, count }) => `${frameCount(count)} ${LIVE_SKIP_LABELS[reason]}.`).join(' ')}</Notice>}
			{!fed && (!session || active) && (
				<>
					<Notice>Frames come from Camera Acquisition of this camera, in either output mode; Live Stacking never commands the camera.</Notice>
					{session && (
						<Actions>
							<Button variant="ghost" onClick={() => selectImageTool(imagesState, document.key, 'camera-acquisition')}>
								Open Acquisition
							</Button>
						</Actions>
					)}
				</>
			)}
			{!active && !stopping && (
				<Actions>
					{discards ? (
						<ConfirmButton variant="secondary" disabled={busy} title="Start a new session?" message={`Starting a new session closes this one. ${discards}`} confirmLabel="Discard and Start" destructive onConfirm={start}>
							Start New Session
						</ConfirmButton>
					) : (
						<Button disabled={busy} onClick={start}>
							{session ? 'Start New Session' : 'Start'}
						</Button>
					)}
				</Actions>
			)}
			{active && (
				<Actions>
					{session?.state === 'paused' ? (
						<Button disabled={busy} title="Stack the frames that arrive again" onClick={() => send('resume')}>
							Resume
						</Button>
					) : (
						<Button variant="secondary" disabled={busy} title="Skip the frames that arrive; those already queued are still stacked" onClick={() => send('pause')}>
							Pause
						</Button>
					)}
					<Button variant="secondary" disabled={busy} title="Stack the frames already queued, then stop; the stacks stay" onClick={() => send('stop')}>
						Stop
					</Button>
					<Button variant="secondary" disabled={busy} title="Start a new field with the next good frame, as after a slew to another target" onClick={() => send('fields')}>
						New Field
					</Button>
				</Actions>
			)}
			{session && (
				<Actions>
					{(active || stopping) && (
						<Button variant="secondary" disabled={busy} title="Stop now: the queued frames are skipped, the frame being stacked completes, and the stacks stay" onClick={() => send('abort')}>
							Abort
						</Button>
					)}
					{session.state !== 'failed' &&
						(discards ? (
							<ConfirmButton variant="secondary" disabled={busy} tooltip="Discard every stack and start over; frames already queued go into new stacks" title="Reset the session?" message={discards} confirmLabel="Discard the Stacks" destructive onConfirm={() => send('reset')}>
								Reset
							</ConfirmButton>
						) : (
							<Button variant="secondary" disabled={busy} title="Start over; the session holds no stack yet" onClick={() => send('reset')}>
								Reset
							</Button>
						))}
					{!active &&
						!stopping &&
						(discards ? (
							<ConfirmButton variant="secondary" disabled={busy} tooltip="Close the session; its stacks are discarded" title="Close the session?" message={discards} confirmLabel="Discard and Close" destructive onConfirm={close}>
								Close
							</ConfirmButton>
						) : (
							<Button variant="secondary" disabled={busy} title="Close the session" onClick={close}>
								Close
							</Button>
						))}
				</Actions>
			)}
			{error && <Notice error>{error}</Notice>}
		</CollapsibleSection>
	)
}

// Text of a count of frames, such as "1 frame" or "12 frames".
function frameCount(count: number) {
	return `${count} ${count === 1 ? 'frame' : 'frames'}`
}

// What a session stacked, read from across the room: its integration time, or that nothing is stacked yet, over its
// stacked frames and stacks.
function SessionReadout({ session }: { readonly session: LiveStackingSession }) {
	const stacks = liveStacks(session)
	const frames = session.counters.accepted

	return (
		<div className="flex flex-col gap-0.5">
			<p className={cn('m-0 text-3xl leading-9 font-semibold tracking-[-0.01em] tabular-nums', frames > 0 ? 'text-ink-100' : 'text-ink-300')}>{frames > 0 ? formatDuration(liveIntegration(session)) : 'Nothing stacked'}</p>
			<p className="m-0 text-xs leading-4 text-ink-300 tabular-nums">{frames > 0 ? `${frameCount(frames)} stacked in ${stacks.length} ${stacks.length === 1 ? 'stack' : 'stacks'}` : 'Stacked frames add up here'}</p>
		</div>
	)
}

interface SessionProps {
	readonly document: ImageDocument
	readonly session: LiveStackingSession
}

interface FormProps {
	readonly camera: CameraOperationContext
	readonly session?: LiveStackingSession
	readonly settings: Readonly<LiveStackingSettings>
}

// Masters chosen per filter, exactly as the headers name it, and what is done with the frames of other filters. With
// the filter wheel of the setup connected (only the Main Camera has one), a filter is chosen among the names of its
// slots; without one, the frames have no filter and take the masters of None, as the Calibration Library lists a flat
// without filter. Each filter is a section of its own and can be removed. The Calibration Library lists masters but
// never chooses one; the server checks each choice against every frame.
function CalibrationSection({ camera, session, settings }: FormProps) {
	const runtime = useSnapshot(liveStackingRuntime)
	const control = useSnapshot(controlRuntime)
	const [masters, setMasters] = useState<Readonly<Record<LiveMasterKind, readonly CalibrationMasterSummary[]>>>({ dark: [], flat: [], bias: [] })
	const [mastersFailed, setMastersFailed] = useState(false)
	const library = useSnapshot(calibrationLibraryRuntime)
	const { calibration } = settings
	const sessionKey = session ? `session:${session.sessionId}` : ''
	const wheel = camera.wheel?.device?.connected ? watchedDeviceState(control, 'wheel', camera.wheel.device) : undefined
	const wheelNames = wheel ? wheelFilterNames(wheel.names, wheel.count) : undefined
	const filters = calibrationFilters(calibration, wheelNames)
	const addable = wheelNames?.filter((name) => !filters.includes(name)) ?? []
	const [filter, setFilter] = useState<string>()
	const chosenFilter = filter !== undefined && addable.includes(filter) ? filter : addable[0]
	const cameraName = session?.cameraName ?? camera.device.device?.name
	// Camera of the Equipment Catalog the masters come from: the one the session started with, else the one bound now.
	const boundCamera = useBoundCamera(camera.device.device)
	const catalogCamera = session ? session.cameraId : boundCamera

	// Fetches the masters offered, again whenever the Calibration Library changes; a failed fetch keeps the masters known.
	useEffect(() => {
		let cancelled = false

		void Promise.all(LIVE_MASTER_ORDER.map((kind) => loadLiveMasters(kind, catalogCamera))).then(([dark, flat, bias]) => {
			if (cancelled) return
			const failed = !dark || !flat || !bias
			setMastersFailed(failed)
			if (!failed) setMasters({ dark, flat, bias })
		})

		return () => {
			cancelled = true
		}
	}, [library.changes, catalogCamera])

	const update = (next: LiveStackingSettings['calibration']) => setLiveStackingSettings(profileState, camera.settings, { calibration: next })

	const choose = (name: string, kind: LiveMasterKind, masterId: string) => {
		const current = { ...calibration.filters[name] }
		const master = masters[kind].find((candidate) => String(candidate.masterId) === masterId)
		if (master) current[kind] = { masterId: master.masterId, digest: master.contentDigest }
		else delete current[kind]
		update({ ...calibration, filters: { ...calibration.filters, [name]: current } })
	}

	// Masters of a kind offered for a filter: those of this camera, and for a flat those of the filter, or those without
	// a filter for frames that have none.
	const offered = (kind: LiveMasterKind, name: string) =>
		masters[kind].filter((master) => {
			if (master.metadata.cameraName !== undefined && cameraName !== undefined && master.metadata.cameraName !== cameraName) return false
			if (kind !== 'flat') return true
			const flatFilter = master.metadata.filter.value?.trim()
			return name === NO_FILTER ? !flatFilter : flatFilter === undefined || flatFilter === '' || flatFilter === name
		})

	// Summary of the masters chosen for a filter.
	const chosenSummary = (name: string) => {
		const chosen = calibration.filters[name]
		const kinds = LIVE_MASTER_ORDER.filter((kind) => chosen?.[kind] !== undefined).map((kind) => LIVE_MASTER_LABELS[kind])
		return kinds.length > 0 ? kinds.join(' · ') : 'Uncalibrated'
	}

	// Summary of the section: the masters of the frames without filter, or how many filters of the wheel are calibrated.
	const calibrated = filters.filter((name) => chosenSummary(name) !== 'Uncalibrated').length
	const summary = !wheelNames ? chosenSummary(NO_FILTER) : calibrated === 0 ? 'Uncalibrated' : `${calibrated} of ${filters.length} ${filters.length === 1 ? 'filter' : 'filters'} calibrated`
	// Whether the frames have no filter and no other filter is calibrated, so the masters need no filter heading.
	const unnamed = !wheelNames && filters.length === 1

	return (
		<CollapsibleSection id="images.liveStacking.calibration" title="Calibration" summary={summary} defaultOpen={false}>
			{wheelNames ? <Notice>Choose the filters of the wheel to calibrate before their frames arrive.</Notice> : <Notice>Without a connected filter wheel the frames have no filter, so the masters below calibrate them all.</Notice>}
			<CatalogCameraNotice device={camera.device.device} lead="Masters come from" purpose="to calibrate with the Calibration Library" />
			{mastersFailed && <Notice error>The masters of the Calibration Library could not be read; the list may be out of date.</Notice>}
			{filters.map((name) => (
				<div key={name} className="flex flex-col gap-2">
					{!unnamed && <SectionHeading>{name === NO_FILTER ? 'No filter' : name}</SectionHeading>}
					{LIVE_MASTER_ORDER.map((kind) => {
						const options = [NO_MASTER, ...offered(kind, name).map((master) => String(master.masterId))]
						const chosen = calibration.filters[name]?.[kind]
						const value = chosen && options.includes(String(chosen.masterId)) ? String(chosen.masterId) : NO_MASTER
						const format = (option: string) => {
							if (option === NO_MASTER) return 'None'
							const master = masters[kind].find((candidate) => String(candidate.masterId) === option)
							return master
								? `#${master.masterId} · ${master.frames} frames${master.metadata.exposure.value !== undefined ? ` · ${formatExposureTime(master.metadata.exposure.value / 1000000)}` : ''}${master.metadata.setTemperature.value !== undefined ? ` · ${formatTemperature(master.metadata.setTemperature.value)}` : ''}`
								: option
						}
						return <Select key={kind} label={LIVE_MASTER_LABELS[kind]} options={options} value={value} format={format} onChange={(option) => choose(name, kind, option)} />
					})}
					{calibration.filters[name] && !unnamed && (
						<Actions>
							<Button variant="secondary" title={`Forget the masters of ${name === NO_FILTER ? 'the frames without filter' : name}`} onClick={() => update(removeFilterCalibration(calibration, name))}>
								Remove
							</Button>
						</Actions>
					)}
				</div>
			))}
			{wheelNames && (
				<div className="flex items-end gap-2">
					<Select label="Filter" options={addable.length > 0 ? addable : ['']} value={chosenFilter ?? ''} format={(option) => option || 'Every filter is added'} disabled={addable.length === 0} onChange={setFilter} className="flex-1" />
					<Button
						variant="secondary"
						disabled={chosenFilter === undefined}
						onClick={() => {
							if (chosenFilter === undefined) return
							update({ ...calibration, filters: { ...calibration.filters, [chosenFilter]: {} } })
							setFilter(undefined)
						}}
					>
						Add
					</Button>
				</div>
			)}
			{wheelNames && <SegmentedControl label="Other filters" options={['uncalibrated', 'skip'] as const} value={calibration.otherwise} format={(option) => LIVE_FALLBACK_LABELS[option]} onChange={(otherwise) => update({ ...calibration, otherwise })} />}
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
			{locked && <Notice>Locked: the running session keeps the recipe it started with.</Notice>}
			<SegmentedControl label="Combination" options={['average', 'weighted-average'] as const} value={shown.method} format={(method) => LIVE_METHOD_LABELS[method]} onChange={(method) => update({ method })} disabled={locked} />
			{shown.method === 'weighted-average' && <Select label="Weighting" options={['quality', 'snr', 'inverse-hfd', 'stars'] as const} value={shown.weighting} format={(weighting) => LIVE_WEIGHTING_LABELS[weighting]} onChange={(weighting) => update({ weighting })} disabled={locked} />}
			<Select label="Normalization" options={['background-scale', 'scale', 'none'] as const} value={shown.normalization} format={(normalization) => LIVE_NORMALIZATION_LABELS[normalization]} onChange={(normalization) => update({ normalization })} disabled={locked} />
			<Select label="Resampling" options={['bilinear', 'bicubic', 'nearest'] as const} value={shown.interpolation} format={(interpolation) => LIVE_INTERPOLATION_LABELS[interpolation]} onChange={(interpolation) => update({ interpolation })} disabled={locked} />
			<NumberInput label="Minimum stars" value={shown.minStars} min={3} max={100} onChange={(minStars) => update({ minStars })} disabled={locked} />
			<NumberInput label="Minimum overlap" value={Math.round(shown.minOverlap * 100)} min={0} max={100} suffix="%" onChange={(overlap) => update({ minOverlap: overlap / 100 })} disabled={locked} />
			<Checkbox label="Reject frames above an HFD" checked={shown.maxHfd !== undefined} disabled={locked} onChange={(limited) => update({ maxHfd: limited ? DEFAULT_MAX_HFD : undefined })} />
			{shown.maxHfd !== undefined && <NumberInput label="Maximum HFD" value={shown.maxHfd} min={0.1} max={50} step={0.1} suffix="px" onChange={(maxHfd) => update({ maxHfd })} disabled={locked} />}
			<Checkbox label="Reject frames below an SNR" checked={shown.minSnr !== undefined} disabled={locked} onChange={(limited) => update({ minSnr: limited ? DEFAULT_MIN_SNR : undefined })} />
			{shown.minSnr !== undefined && <NumberInput label="Minimum SNR" value={shown.minSnr} min={1} max={1000} onChange={(minSnr) => update({ minSnr })} disabled={locked} />}
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
// a custom mix, offered once the session has them; the stack or composition shown can be saved as a linear FITS. Only
// the display changes.
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
			<SegmentedControl
				label="Show"
				options={['frame', 'stack', 'color'] as const}
				value={mode}
				format={(option) => DISPLAY_LABELS[option]}
				disabledReason={(option) => (option === 'stack' && session.cohorts.length === 0 ? 'No stack yet' : option === 'color' && !field ? 'Color needs mono stacks of one field' : undefined)}
				onChange={changeMode}
			/>
			{mode === 'stack' && shownCohort && (
				<Select
					label="Stack"
					className="min-w-0"
					options={session.cohorts.map((cohort) => cohort.cohortId)}
					value={shownCohort}
					format={(cohortId) => {
						const cohort = session.cohorts.find((candidate) => candidate.cohortId === cohortId)
						const index = session.fields.find((candidate) => candidate.fieldId === cohort?.fieldId)?.index
						return cohort ? `${cohort.filter} · field ${index} · ${liveAcquisitionLabel(cohort)}` : cohortId
					}}
					onChange={(cohortId) => show({ cohortId })}
				/>
			)}
			{mode === 'stack' && shownCohort && (
				<Actions>
					<Button
						variant="secondary"
						disabled={runtime.pending[exportKey]}
						onClick={() =>
							void saveLiveStack(liveStackingRuntime, session.sessionId, { cohortId: shownCohort }).then((product) => {
								if (product) setSaved(product.path)
							})
						}
					>
						Save Stack
					</Button>
					{saved && (
						<Button variant="ghost" onClick={() => void openImage(imagesState, saved)}>
							Open Saved
						</Button>
					)}
				</Actions>
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
										<p className="m-0 text-xs text-ink-200">{cohort ? `${cohort.filter} · ${liveAcquisitionLabel(cohort)}` : 'Unknown stack'}</p>
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
			{runtime.errors[exportKey] && <Notice error>{runtime.errors[exportKey]}</Notice>}
			<Notice>Stretching and color mixing change only the display; saved stacks are linear.</Notice>
		</CollapsibleSection>
	)
}
