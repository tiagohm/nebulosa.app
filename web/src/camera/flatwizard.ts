import type { CameraCapabilities, CaptureSnoop, DarkGroup, FlatWizardCaptureSettings, FlatWizardFilterRun, FlatWizardFilterState, FlatWizardPendingStep, FlatWizardRequest, FlatWizardSession, FlatWizardSessionSummary, FlatWizardState, FlatWizardVerdict, OperationDevice, ServerEvent, WheelState } from 'api'
import { nanoid } from 'nanoid'
import type { FlatDiagnosticCode, FlatPlane } from 'nebulosa/src/imaging/analysis/flat/types'
import { proxy } from 'valtio'
import type { RoleAvailability } from '../equipment/availability'
import { type ApiFetch, browserFetch, deviceUrl, jsonInit } from '../http'
import type { CameraExposureSettings, FlatWizardSettings } from '../profile/schema'
import { SnapshotRefreshes } from '../refresh'
import { cameraKey, fitExposure } from './capture'
import { applySession, type CameraSessionKind, type CameraSessionRecords, refreshSessionRecords, sendSessionCommand } from './sessions'

// Flat Wizard sessions as this tab knows them. The server owns every session, whichever tab started it, and every
// filter change, exposure, measurement, and saved file of it, so this store only mirrors it: the summary of the latest
// session of each camera arrives with every flatWizard:updated event and, on every socket (re)open, with the snapshot;
// the complete record (the latest exposures) is fetched when a summary reports a new exposure or an end. Summaries are
// ordered by their revision, so a late event never replaces a newer state. Cameras, wheels, and panels are addressed
// by their exact connection and device ids, never by role. A start carries a token, so a retried request answers the
// session of the first one; a manual step is confirmed with the step id the server published, so a stale or repeated
// confirmation never skips a later step.

// Flat Wizard state of the tab.
export type FlatWizardRuntime = CameraSessionRecords<FlatWizardSessionSummary, FlatWizardSession>

// Flat Wizard state of the tab.
export const flatWizardRuntime = proxy<FlatWizardRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })

// How the sessions are mirrored (sessions.ts): the complete record is fetched again when the summary reports
// a new session, a new exposure, or its end.
const FLAT_WIZARD_SESSIONS: CameraSessionKind<FlatWizardSessionSummary, FlatWizardSession> = {
	url: '/api/flat-wizard',
	refreshes: new SnapshotRefreshes(),
	stale: (session, known) => known?.sessionId !== session.sessionId || known.lastAttempt?.index !== session.lastAttempt?.index || known.endedAt !== session.endedAt,
}

// Label of each session state.
export const FLAT_WIZARD_STATE_LABELS: Readonly<Record<FlatWizardState, string>> = {
	preparing: 'Preparing',
	closingCover: 'Closing the cover',
	waitingForFilter: 'Waiting for the filter',
	movingFilter: 'Moving the filter wheel',
	waitingForIllumination: 'Waiting for the light',
	settingLight: 'Setting the flat panel',
	settling: 'Letting the light settle',
	exposing: 'Exposing',
	measuring: 'Measuring',
	saving: 'Saving',
	assessingSequence: 'Assessing the sequence',
	stopping: 'Stopping',
	completed: 'Completed',
	cancelled: 'Stopped',
	failed: 'Failed',
}

// Label of each filter group state.
export const FLAT_WIZARD_FILTER_STATE_LABELS: Readonly<Record<FlatWizardFilterState, string>> = { pending: 'Pending', calibrating: 'Searching the exposure', acquiring: 'Acquiring', completed: 'Completed', failed: 'Failed', cancelled: 'Stopped' }

// Label of each frame verdict.
export const FLAT_WIZARD_VERDICT_LABELS: Readonly<Record<FlatWizardVerdict, string>> = { usable: 'Trial', clipped: 'Trial, clipped', noSignal: 'Trial, no signal', accepted: 'Accepted', rejected: 'Rejected', inconclusive: 'Inconclusive' }

// Explanation of the diagnostics the operator can act on; the others need no explanation.
export const FLAT_WIZARD_DIAGNOSTIC_LABELS: Readonly<Partial<Record<FlatDiagnosticCode, string>>> = {
	effectiveClipUnknown: 'Saturation is not proven absent: set the effective clipping level of the camera.',
	storageClipping: 'Some samples reach the limit of the file format.',
	effectiveClipping: 'Some samples reach the effective clipping level.',
	targetBelowRange: 'The level is below the target.',
	targetAboveRange: 'The level is above the target.',
	nonFiniteSamples: 'Some samples are not finite.',
	sequenceDrift: 'The light drifted across the frames.',
	sequenceVariation: 'The frames vary more than expected.',
	sequenceOutlier: 'A frame stands apart from the others.',
	sequenceMetadataUnknown: 'Missing metadata prevents proving the frames homogeneous.',
}

// Returns one dark-flat group per exposure a session saved flats at, with as many frames as its largest filter group
// asked for at that exposure. A dark-flat matches the exposure of its flats, whatever their filter was.
export function darkFlatGroups(session: Pick<FlatWizardSessionSummary, 'filters'>): DarkGroup[] {
	const counts = new Map<number, number>()

	for (const { exposure, accepted, required } of session.filters) {
		if (exposure !== undefined && accepted > 0) counts.set(exposure, Math.max(counts.get(exposure) ?? 0, required))
	}

	return Array.from(counts, ([exposure, count]) => ({ exposure, count })).toSorted((a, b) => a.exposure - b.exposure)
}

// Returns whether a session is running: it has not ended.
export function flatWizardRunning(session: Pick<FlatWizardSessionSummary, 'endedAt'> | undefined): boolean {
	return session !== undefined && session.endedAt === undefined
}

// Equipment a start uses besides the camera: the setup's wheel and panel, when assigned.
export interface FlatWizardEquipment {
	// Filter wheel to move, by exact ids; absent makes every filter change manual.
	readonly wheel?: OperationDevice
	// Flat panel to light the frames, by exact ids; absent makes the light manual.
	readonly panel?: OperationDevice
	// Dust cover to close before the frames and open after them, by exact ids; absent leaves the cover as it is.
	readonly cover?: OperationDevice
}

// Returns the name of the filter at a 0-based slot, as the server names it: the name the wheel reports (names in slot
// order, given only when a wheel is used), else the name the operator gave it (given only without a wheel), or
// "Filter <slot + 1>" when neither names it.
export function flatWizardFilterName(names: readonly string[] | undefined, slot: number, name?: string) {
	return (names ? names[slot]?.trim() : name?.trim()) || `Filter ${slot + 1}`
}

// Fewest accepted frames of a filter whose stability the server assesses; fewer are saved but never proven stable.
export const FLAT_WIZARD_STABILITY_FRAMES = 3

// Label of the level row of each measured plane: a mono sensor has one level, a color sensor one per plane.
export const FLAT_WIZARD_PLANE_LABELS: Readonly<Record<FlatPlane, string>> = { mono: 'Level', red: 'Level R', green: 'Level G', green1: 'Level G1', green2: 'Level G2', blue: 'Level B' }

// Session states in which the filter in progress is being exposed or measured, so its step (searching the exposure or
// acquiring) describes what the session does; in the others the session state says it.
const EXPOSURE_STATES: ReadonlySet<FlatWizardState> = new Set(['exposing', 'measuring', 'saving'])

// Returns whether the step of the filter in progress describes what a session in a state does.
export function flatWizardShowsStep(state: FlatWizardState) {
	return EXPOSURE_STATES.has(state)
}

// Conjunction of a list in English, such as "L, R, and G".
const LIST = new Intl.ListFormat('en', { type: 'conjunction' })

// Names of the devices a start uses, absent for a step the operator does by hand.
export interface FlatWizardPreflightDevices {
	// Name of the filter wheel moved through the filters.
	readonly wheel?: string
	// Name of the flat panel lit for the frames.
	readonly panel?: string
	// Name of the dust cover closed before the frames.
	readonly cover?: string
}

// Returns the sentence that tells, before a start, what the session will move and ask for, and how many flats it saves:
// filter names in order, and the number of accepted frames of every filter added up.
export function flatWizardPreflight({ wheel, panel, cover }: FlatWizardPreflightDevices, filters: readonly string[], frames: number) {
	const actions: string[] = []
	if (cover) actions.push(`closes ${cover} (opened again at the end unless it was already closed)`)
	if (panel) actions.push(`lights ${panel}`)
	actions.push(wheel ? `moves ${wheel} through ${LIST.format(filters)}` : `asks you to put ${LIST.format(filters)} in place`)
	if (!panel) actions.push(wheel ? 'asks you to switch the light on' : 'to switch the light on')
	return `Start ${LIST.format(actions)}, then saves ${frames} ${frames === 1 ? 'flat' : 'flats'}.`
}

// Returns the instruction of the manual step a session waits for: the filter to put in place, with the light to switch
// on at the first filter when there is no panel, or the light to ready for a filter.
export function flatWizardStepText(step: FlatWizardPendingStep, filters: readonly Pick<FlatWizardFilterRun, 'name'>[], panel: boolean) {
	const { name } = filters[step.filter]
	if (step.kind === 'illumination') return `Make sure the light is on and stable for ${name}, then continue.`
	return `Put ${name} in place${!panel && step.filter === 0 ? ' and switch the light on' : ''}, then continue.`
}

// One note of the results: the filters it applies to, its text, and whether it reports a failure.
export interface FlatWizardResultNote {
	// Names of the filters with this note, in session order.
	readonly filters: readonly string[]
	// Text after the filter names.
	readonly text: string
	// Whether the note reports a failure or an unstable sequence.
	readonly error: boolean
}

// Returns the failure and stability notes of the filters of a session, one per distinct text, naming every filter it
// applies to, so three filters short of frames read as one line.
export function flatWizardResultNotes(filters: readonly Pick<FlatWizardFilterRun, 'name' | 'error' | 'sequence'>[]): FlatWizardResultNote[] {
	const notes = new Map<string, { filters: string[]; text: string; error: boolean }>()

	for (const { name, error, sequence } of filters) {
		let note: { readonly text: string; readonly error: boolean } | undefined

		if (error) note = { text: error, error: true }
		else if (sequence?.status === 'notEvaluated') note = { text: `stability not evaluated. ${sequence.reason}.`, error: false }
		else if (sequence) {
			const verdict = sequence.verdict === 'accepted' ? 'stable' : sequence.verdict === 'rejected' ? 'unstable' : 'not proven stable'
			const outliers = sequence.outliers.length > 0 ? ` Outliers: ${sequence.outliers.join(', ')}.` : ''
			const reasons = sequence.reasons.flatMap((reason) => FLAT_WIZARD_DIAGNOSTIC_LABELS[reason] ?? [])
			note = { text: `${verdict}.${outliers}${reasons.length > 0 ? ` ${reasons.join(' ')}` : ''}`, error: sequence.verdict === 'rejected' }
		}

		if (!note) continue
		const key = `${note.error}:${note.text}`
		const known = notes.get(key)
		if (known) known.filters.push(name)
		else notes.set(key, { filters: [name], ...note })
	}

	return [...notes.values()]
}

// Builds the start request of the Flat Wizard form of a camera. The frames take the camera settings of Camera
// Acquisition, fitted to the camera's capabilities as a capture is, but never its exposure time, which the wizard
// searches. Brightness is sent only with a panel.
export function flatWizardRequest(settings: Readonly<FlatWizardSettings>, exposure: Readonly<CameraExposureSettings>, { wheel, panel, cover }: FlatWizardEquipment, snoop: CaptureSnoop, capabilities?: CameraCapabilities): Omit<FlatWizardRequest, 'token'> {
	const { exposureTime: _, ...capture } = fitExposure(exposure, capabilities)
	const filters = settings.filters.map(({ brightness, ...filter }) => ({ ...filter, ...(panel && brightness !== undefined && { brightness }) }))

	return {
		capture: capture satisfies FlatWizardCaptureSettings,
		filters,
		...(wheel && { wheel }),
		...(panel && { panel }),
		...(cover && { cover }),
		settleTime: settings.settleTime,
		...(settings.directory && { directory: settings.directory }),
		...(settings.effectiveClip !== undefined && { effectiveClip: settings.effectiveClip }),
		maximumTrials: settings.maximumTrials,
		maximumRejections: settings.maximumRejections,
		snoop,
		...(settings.generateMasters && { generateMasters: true }),
	}
}

// Returns why no session can start now, or undefined when one can, from the availability of the camera and of the
// assigned wheel, panel, and cover (absent when not assigned, so manual or left as it is), the slots and names that
// wheel reports (absent while unknown), and the form. An assigned device that cannot be used blocks the start
// instead of being replaced by a manual step. The server checks again.
export function flatWizardBlocker(camera: RoleAvailability, wheel: RoleAvailability | undefined, panel: RoleAvailability | undefined, settings: Readonly<FlatWizardSettings>, wheelState?: Pick<WheelState, 'count' | 'names'>, cover?: RoleAvailability): string | undefined {
	if (camera.status !== 'ready') return camera.message
	if (wheel && wheel.status !== 'ready') return wheel.message
	if (panel && panel.status !== 'ready') return panel.message
	if (cover && cover.status !== 'ready') return cover.message
	if (settings.filters.length === 0) return 'Add a filter.'

	for (const filter of settings.filters) {
		const name = flatWizardFilterName(wheel ? (wheelState?.names ?? []) : undefined, filter.slot, filter.name)
		if (wheel && wheelState && filter.slot >= wheelState.count) return `The wheel has no slot ${filter.slot + 1}.`
		const problems = flatWizardFilterProblems(filter)
		if (problems.exposure) return `${name}: ${problems.exposure}`
		if (problems.target) return `${name}: ${problems.target}`
	}

	return undefined
}

// What keeps a filter group from starting, by the field to fix; each absent when that field is valid.
export interface FlatWizardFilterProblems {
	// Why the exposure bounds cannot be searched.
	readonly exposure?: string
	// Why the target level cannot be reached.
	readonly target?: string
}

// Returns what keeps a filter group from starting, said as the fix, for the fields to show under them.
export function flatWizardFilterProblems(filter: Pick<FlatWizardSettings['filters'][number], 'minimumExposure' | 'maximumExposure' | 'targetRange'>): FlatWizardFilterProblems {
	return {
		...(!(filter.minimumExposure > 0 && filter.minimumExposure < filter.maximumExposure) && { exposure: 'Max Exposure must be above Min Exposure.' }),
		...(!(filter.targetRange[0] < filter.targetRange[1]) && { target: 'Target Max must be above Target Min.' }),
	}
}

// Applies a Flat Wizard event (applySession); any other event is ignored.
export function handleFlatWizardEvent(state: FlatWizardRuntime, event: ServerEvent, request: ApiFetch = browserFetch) {
	if (event.type === 'flatWizard:updated') applySession(state, FLAT_WIZARD_SESSIONS, event.session, request)
}

// Replaces the sessions with the server's snapshot and fetches their complete records (refreshSessionRecords).
export function refreshFlatWizard(state: FlatWizardRuntime, request: ApiFetch = browserFetch) {
	return refreshSessionRecords(state, FLAT_WIZARD_SESSIONS, request)
}

// Sends a command of a camera (sendSessionCommand).
function command(state: FlatWizardRuntime, key: string, url: string, body: unknown, request: ApiFetch) {
	return sendSessionCommand(state, key, url, jsonInit('POST', body), () => refreshFlatWizard(state, request), request)
}

// Starts a Flat Wizard session with a camera; progress arrives as events.
export function startFlatWizard(state: FlatWizardRuntime, connectionId: string, deviceId: string, body: Omit<FlatWizardRequest, 'token'>, request: ApiFetch = browserFetch) {
	const url = deviceUrl(connectionId, 'camera', deviceId, 'flat-wizard')
	return command(state, cameraKey(connectionId, deviceId), url, { ...body, token: nanoid() } satisfies FlatWizardRequest, request)
}

// Confirms the manual step a session waits for, by the step id the session published.
export function continueFlatWizard(state: FlatWizardRuntime, session: Pick<FlatWizardSessionSummary, 'sessionId' | 'camera'>, stepId: string, request: ApiFetch = browserFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/flat-wizard/${encodeURIComponent(session.sessionId)}/continue`, { stepId }, request)
}

// Stops a running session; the exposure in flight is lost and the frames already saved stay.
export function stopFlatWizard(state: FlatWizardRuntime, session: Pick<FlatWizardSessionSummary, 'sessionId' | 'camera'>, request: ApiFetch = browserFetch) {
	return command(state, cameraKey(session.camera.connectionId, session.camera.deviceId), `/api/flat-wizard/${encodeURIComponent(session.sessionId)}/stop`, undefined, request)
}
