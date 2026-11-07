import type { JupiterEvent, JupiterEventKind, JupiterEvents, JupiterEventsRequest, JupiterFallbackReason, JupiterGrsModel, JupiterGrsResponse, JupiterGrsSaveRequest, JupiterMoonState, JupiterSignature, JupiterSourceReport, JupiterState, JupiterTrack, JupiterVisibilityReason, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { ApiResponseError, fetchJson, jsonInit } from '../../http'
import { ACTIVE_TOOL_LOCATION, type SiteLocation, type ToolLocation } from '../../location/site'
import { DEFAULT_ZONE_OVERRIDE, type DisplayZoneOverride } from '../../location/zone'
import { createRequestGuard } from '../../sky/selection'
import { planningSite, showTargetInSky } from '../observingplanner/observingplanner'
// oxfmt-ignore
import { aborted, browserPlannerIo, errorMessage, interpolateTrack as interpolateMoons, type MoonPosition, type PlanetOrientation, type PlanetPeriod, type PlanetRate, type PlanetScale, type PlannerIo, playClock, scheduleLoad, setTime } from '../planetary/planetary'

// Jupiter Observing Planner of the tab: the tool-local clock and period, the filters, the answers of the server (the view
// at the clock's instant, the satellite tracks and the events over the period), and the mirror of the server's Great Red
// Spot model. Every position, contact, and classification comes from the server; the tab only interpolates the sampled
// tracks for display while the clock moves, and never derives a contact from them. The clock, periods, orientations and
// track interpolation are the shared planetary planner pieces of ../planetary/planetary.ts. Nothing here changes the Sky
// clock, a site, the profile, or a device. Times are Unix milliseconds (UTC); angles radians.

// A Galilean satellite, as the server names it.
export type GalileanMoon = JupiterMoonState['moon']

// The four moons, in orbital order.
export const GALILEAN_MOONS: readonly GalileanMoon[] = ['io', 'europa', 'ganymede', 'callisto']

// Name of each moon.
export const MOON_LABELS: Readonly<Record<GalileanMoon, string>> = { io: 'Io', europa: 'Europa', ganymede: 'Ganymede', callisto: 'Callisto' }

// Initial of each moon, drawn beside it.
export const MOON_INITIALS: Readonly<Record<GalileanMoon, string>> = { io: 'I', europa: 'E', ganymede: 'G', callisto: 'C' }

// Colour of each moon's curve and marker.
export const MOON_COLORS: Readonly<Record<GalileanMoon, string>> = { io: '#e0a030', europa: '#4aa3df', ganymede: '#9b7fd4', callisto: '#5bbf7a' }

// Every event kind, in display order.
export const EVENT_KINDS: readonly JupiterEventKind[] = ['grsTransit', 'satelliteTransit', 'shadowTransit', 'satelliteOccultation', 'satelliteEclipse', 'mutualOccultation', 'mutualEclipse']

// Name of each event kind.
export const KIND_LABELS: Readonly<Record<JupiterEventKind, string>> = {
	grsTransit: 'Great Red Spot transit',
	satelliteTransit: 'Transit',
	shadowTransit: 'Shadow transit',
	satelliteOccultation: 'Occultation',
	satelliteEclipse: 'Eclipse',
	mutualOccultation: 'Mutual occultation',
	mutualEclipse: 'Mutual eclipse',
}

// What each event kind is, in one sentence.
export const KIND_DEFINITIONS: Readonly<Record<JupiterEventKind, string>> = {
	grsTransit: 'The Great Red Spot crosses the central meridian; the window is while it lies within the viewing half-width of the meridian, not a physical contact. Its longitude comes from the model you entered.',
	satelliteTransit: 'The moon crosses in front of the disk. External contacts: the disks touch; internal: the moon is wholly on the disk.',
	shadowTransit: "The moon's shadow crosses the sunlit disk. External contacts: the penumbra touches the disk as seen from the Sun; internal: the whole penumbra is on it. Away from opposition the shadow lies well off the moon.",
	satelliteOccultation: 'The moon passes behind the disk. External contacts: the disks touch; internal: the moon is wholly hidden.',
	satelliteEclipse: "The moon passes through Jupiter's shadow. External contacts: the moon touches the penumbra; centre: its centre crosses the umbra's edge (disappearance and reappearance); internal: it is wholly in the umbra.",
	mutualOccultation: 'One moon passes in front of another. Only the first and last contacts and how central it is are predicted, not the drop in light.',
	mutualEclipse: "One moon's shadow falls on another. Only the first and last contacts and how central it is are predicted, not the drop in light.",
}

// Sentence of each visibility reason.
export const REASON_LABELS: Readonly<Record<JupiterVisibilityReason, string>> = {
	sunTooHigh: 'The Sun is above −6° at the site.',
	jupiterTooLow: 'Jupiter is below 25° at the site.',
	moonHidden: 'A moon taking part is behind Jupiter or in its shadow for part of it.',
	shadowHidden: 'The shadow faces away from the Earth for part of it.',
}

// Sentence of each reason the kernels were not used.
export const FALLBACK_LABELS: Readonly<Record<JupiterFallbackReason, string>> = {
	noKernel: 'no SPICE kernel is enabled',
	loading: 'the kernels are still being opened',
	targetMissing: 'no enabled kernel has every Jovian body',
	missingCenter: 'a body is relative to a center no kernel has',
	outOfCoverage: 'the kernels do not cover the whole period',
	unsupportedFrame: 'a selected segment uses an unsupported frame',
	unsupportedType: 'a selected segment uses an unsupported data type',
	cycle: 'a kernel chain never reaches the barycenter',
}

// Tab-lived state of the tool.
export interface JupiterPlannerState {
	// Where the visibility is judged from.
	location: ToolLocation
	// Zone the times are shown in.
	zone: DisplayZoneOverride
	// Civil date of the first evening of the period, in the zone that names the dates; absent until the tool opens.
	eveningDate?: string
	// Days of the period.
	period: PlanetPeriod
	// Instant of the tool's clock; absent until the tool opens, then real now.
	time?: number
	// Whether the clock plays.
	playing: boolean
	// Rate of the clock while it plays.
	rate: PlanetRate
	// Kinds of events listed.
	kinds: JupiterEventKind[]
	// Moons whose events are listed and whose curves are drawn.
	moons: GalileanMoon[]
	// Orientation of the viewer.
	orientation: PlanetOrientation
	// Scale of the viewer.
	scale: PlanetScale
	// Id of the event selected.
	selected?: string
	// View at the clock's instant, the latest answered.
	state?: JupiterState
	// Why the view could not be computed.
	stateError?: string
	// Tracks of the period.
	track?: JupiterTrack
	// Whether the tracks are being computed.
	trackLoading: boolean
	// Why the tracks could not be computed.
	trackError?: string
	// Events of the period.
	events?: JupiterEvents
	// Whether the events are being computed.
	eventsLoading: boolean
	// Why the events could not be computed.
	eventsError?: string
	// Whether the error of the events is the kernels' refusal under spkOnly.
	kernelsRefused: boolean
	// Readiness of the kernels over the period.
	source?: JupiterSourceReport
}

// Creates the tab state of the tool.
export function createJupiterPlannerState(): JupiterPlannerState {
	return {
		location: { ...ACTIVE_TOOL_LOCATION },
		zone: { ...DEFAULT_ZONE_OVERRIDE },
		period: 3,
		playing: false,
		rate: 600,
		kinds: [...EVENT_KINDS],
		moons: [...GALILEAN_MOONS],
		orientation: 'north',
		scale: 'system',
		trackLoading: false,
		eventsLoading: false,
		kernelsRefused: false,
	}
}

// Tab state of the tool.
export const jupiterPlannerState = proxy<JupiterPlannerState>(createJupiterPlannerState())

// Guards of the requests of the tool, each superseding its previous one.
const stateGuard = createRequestGuard()
const trackGuard = createRequestGuard()
const eventsGuard = createRequestGuard()
const sourceGuard = createRequestGuard()

// Reads the view of Jupiter at the clock's instant, dropping the answer of a superseded request.
export async function loadState(state: JupiterPlannerState, io: PlannerIo = browserPlannerIo) {
	if (state.time === undefined) return
	const request = stateGuard.begin()

	try {
		const answer = await fetchJson<JupiterState>(io, '/api/jupiter/state', jsonInit('POST', { time: state.time }, request.signal))
		if (!request.current()) return
		state.state = answer
		state.stateError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.stateError = errorMessage(error)
	}
}

// Reads the tracks of a period.
export async function loadTrack(state: JupiterPlannerState, range: { readonly start: number; readonly end: number }, io: PlannerIo = browserPlannerIo) {
	const request = trackGuard.begin()
	state.trackLoading = true

	try {
		const answer = await fetchJson<JupiterTrack>(io, '/api/jupiter/track', jsonInit('POST', range, request.signal))
		if (!request.current()) return
		state.track = answer
		state.trackError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.track = undefined
		state.trackError = errorMessage(error)
	} finally {
		if (request.current()) state.trackLoading = false
	}
}

// Reads the events of a period, judged from a site when one is given; every kind and moon is asked for, and the
// filters only choose what is listed.
export async function loadEvents(state: JupiterPlannerState, range: { readonly start: number; readonly end: number }, site: SiteLocation | undefined, io: PlannerIo = browserPlannerIo) {
	const request = eventsGuard.begin()
	state.eventsLoading = true
	const body: JupiterEventsRequest = { ...range, ...(site && { site: planningSite(site) }) }

	try {
		const answer = await fetchJson<JupiterEvents>(io, '/api/jupiter/events', jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.events = answer
		state.eventsError = undefined
		state.kernelsRefused = false
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.events = undefined
		state.eventsError = errorMessage(error)
		state.kernelsRefused = error instanceof ApiResponseError && error.status === 503
	} finally {
		if (request.current()) state.eventsLoading = false
	}
}

// Reads the readiness of the kernels over a period.
export async function loadSource(state: JupiterPlannerState, range: { readonly start: number; readonly end: number }, io: PlannerIo = browserPlannerIo) {
	const request = sourceGuard.begin()

	try {
		const answer = await fetchJson<JupiterSourceReport>(io, '/api/jupiter/source', jsonInit('POST', range, request.signal))
		if (request.current()) state.source = answer
	} catch {
		// The readiness only explains; the computations answer for themselves.
	}
}

// Selects an event and moves the clock to its maximum; the Sky clock, the site, and the devices are left alone.
export function selectEvent(state: JupiterPlannerState, event: Pick<JupiterEvent, 'id' | 'maximum'>) {
	state.selected = event.id
	setTime(state, event.maximum)
}

// The events listed: the filtered kinds, and for an event of moons, at least one of the filtered moons.
export function listedEvents(events: readonly JupiterEvent[], kinds: readonly JupiterEventKind[], moons: readonly GalileanMoon[]) {
	return events.filter((e) => kinds.includes(e.kind) && (e.moons.length === 0 || e.moons.some((moon) => moons.includes(moon))))
}

// Positions of the four moons at an instant by linear interpolation between the samples of the tracks, for display
// only; undefined outside the tracks.
export function interpolateTrack(track: Pick<JupiterTrack, 'times' | 'moons'> | undefined, time: number): Record<GalileanMoon, MoonPosition> | undefined {
	return interpolateMoons(track, time, GALILEAN_MOONS)
}

// One-line description of the source of an answer.
export function describeSource(signature: JupiterSignature | undefined) {
	if (!signature) return undefined
	const { source } = signature
	if (source.kind === 'spk') {
		const files = new Set(Object.values(source.kernels).flat())
		return `SPICE kernels (${files.size} file${files.size === 1 ? '' : 's'}, generation ${signature.generation})`
	}

	return `VSOP87E + L1.2, because ${FALLBACK_LABELS[source.fallbackReason]}`
}

// Schedules the request of the exact view after the clock settles, returning its cancellation.
export function scheduleState(state: JupiterPlannerState, io: PlannerIo = browserPlannerIo, delay?: number) {
	return scheduleLoad(() => loadState(state, io), delay)
}

// Advances a playing clock at its rate, asking for the exact view at intervals (see playClock). Returns the stop of the loop.
export function play(state: JupiterPlannerState, reducedMotion: boolean, io: PlannerIo = browserPlannerIo, frame?: (run: (now: number) => void) => number, cancel?: (id: number) => void) {
	return playClock(state, reducedMotion, () => loadState(state, io), frame, cancel)
}

// Shows Jupiter in the Sky at the Sky's own time, through the Observing Planner's handoff, which changes no clock.
export function showJupiterInSky(site: SiteLocation | undefined) {
	showTargetInSky({ target: { kind: 'body', code: '599' }, name: 'Jupiter' }, site)
}

// Mirror of the server's Great Red Spot model, with the save in flight and its conflict.
export interface JupiterGrsState {
	// The model and its state, once read.
	grs?: JupiterGrsResponse
	// Whether a save is in flight.
	saving: boolean
	// The model another tab saved meanwhile, after a refused save.
	conflict?: JupiterGrsResponse
	// The model the refused save carried, kept to save again.
	pending?: JupiterGrsModel
	// Why the latest save failed.
	error?: string
}

// Mirror of the Great Red Spot model of the tab.
export const jupiterGrsState = proxy<JupiterGrsState>({ saving: false })

// Reads the Great Red Spot model.
export async function refreshJupiterGrs(state: JupiterGrsState, io: Pick<PlannerIo, 'fetch'> = browserPlannerIo) {
	try {
		state.grs = await fetchJson<JupiterGrsResponse>(io, '/api/jupiter/grs')
	} catch {
		// Read again on the next socket open.
	}
}

// Applies an event of the Great Red Spot model, keeping the newest revision. The state is the server's as of the
// save; the tab reads it again to refresh the staleness.
export function handleJupiterGrsEvent(state: JupiterGrsState, event: ServerEvent, io: Pick<PlannerIo, 'fetch'> = browserPlannerIo) {
	if (event.type !== 'jupiter:grsUpdated') return
	if (state.grs && state.grs.revision >= event.grs.revision) return
	void refreshJupiterGrs(state, io)
}

// Saves a model edited from the revision the tab knows. A refusal keeps the model and shows what the other tab saved,
// until the operator keeps theirs or saves this one over it.
export async function saveJupiterGrs(state: JupiterGrsState, model: JupiterGrsModel, io: Pick<PlannerIo, 'fetch'> = browserPlannerIo) {
	const revision = state.conflict?.revision ?? state.grs?.revision ?? 0
	state.saving = true
	state.error = undefined

	try {
		const response = await io.fetch('/api/jupiter/grs', jsonInit('PUT', { model, revision } satisfies JupiterGrsSaveRequest))

		if (response.status === 409) {
			const body = (await response.json()) as { readonly grs: JupiterGrsResponse }
			state.conflict = body.grs
			state.pending = model
			return
		}

		if (!response.ok) throw new Error(((await response.json()) as { readonly error?: string }).error ?? response.statusText)
		state.grs = (await response.json()) as JupiterGrsResponse
		state.conflict = undefined
		state.pending = undefined
	} catch (error) {
		state.error = errorMessage(error)
	} finally {
		state.saving = false
	}
}

// Drops the refused save and keeps what the other tab saved.
export function keepTheirGrs(state: JupiterGrsState) {
	if (state.conflict) state.grs = state.conflict
	state.conflict = undefined
	state.pending = undefined
}

// Saves the refused model over what the other tab saved.
export function saveMineGrs(state: JupiterGrsState, io: Pick<PlannerIo, 'fetch'> = browserPlannerIo) {
	if (state.pending) return saveJupiterGrs(state, state.pending, io)
	return Promise.resolve()
}
