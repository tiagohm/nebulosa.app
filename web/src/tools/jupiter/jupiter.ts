import type {
	JupiterEvent,
	JupiterEventKind,
	JupiterEvents,
	JupiterEventsRequest,
	JupiterFallbackReason,
	JupiterGrsModel,
	JupiterGrsResponse,
	JupiterGrsSaveRequest,
	JupiterMoonState,
	JupiterSignature,
	JupiterSourceReport,
	JupiterState,
	JupiterTrack,
	JupiterVisibilityReason,
	JupiterVisibilityStatus,
	ServerEvent,
} from 'api'
import { proxy } from 'valtio'
import { ApiResponseError, fetchJson, jsonInit } from '../../http'
import { ACTIVE_TOOL_LOCATION, type SiteLocation, type ToolLocation } from '../../location/site'
import { DEFAULT_ZONE_OVERRIDE, type DisplayZoneOverride, wallTimeToInstant, zonedWallTime } from '../../location/zone'
import { navigate, type RouteState, routeState } from '../../shell/route'
import { createRequestGuard } from '../../sky/selection'
import type { StatusTone } from '../../ui/StatusBadge'
import { planningSite, showTargetInSky } from '../observingplanner/observingplanner'

// Jupiter Observing Planner of the tab: the tool-local clock and period, the filters, the answers of the server (the view
// at the clock's instant, the satellite tracks and the events over the period), and the mirror of the server's Great Red
// Spot model. Every position, contact, and classification comes from the server; the tab only interpolates the sampled
// tracks for display while the clock moves, and never derives a contact from them. Nothing here changes the Sky clock, a
// site, the profile, or a device. Times are Unix milliseconds (UTC); angles radians.

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

// Label of each contact.
export const CONTACT_LABELS: Readonly<Record<string, string>> = {
	external1: 'First external contact',
	internal1: 'First internal contact',
	center1: 'Centre on the edge (ingress)',
	center2: 'Centre on the edge (egress)',
	internal2: 'Last internal contact',
	external2: 'Last external contact',
	visibleStart: 'Shadow centre starts facing the Earth',
	visibleEnd: 'Shadow centre stops facing the Earth',
}

// Order the contacts are listed in.
export const CONTACT_ORDER = ['external1', 'internal1', 'center1', 'visibleStart', 'visibleEnd', 'center2', 'internal2', 'external2'] as const

// Label and tone of each visibility status.
export const VISIBILITY_LABELS: Readonly<Record<JupiterVisibilityStatus, { readonly label: string; readonly tone: StatusTone }>> = {
	observable: { label: 'Observable', tone: 'success' },
	partial: { label: 'Partly observable', tone: 'warning' },
	notObservable: { label: 'Not observable here', tone: 'danger' },
	unknownNoSite: { label: 'No site', tone: 'muted' },
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

// Days a period may span.
export type JupiterPeriod = 1 | 3 | 7 | 14

// Every period, in days.
export const JUPITER_PERIODS: readonly JupiterPeriod[] = [1, 3, 7, 14]

// Clock rates while playing, in simulated seconds per real second.
export type JupiterRate = 60 | 600 | 3600

// Every rate.
export const JUPITER_RATES: readonly JupiterRate[] = [60, 600, 3600]

// Label of each rate.
export const RATE_LABELS: Readonly<Record<JupiterRate, string>> = { 60: '1 min/s', 600: '10 min/s', 3600: '1 h/s' }

// How the viewer is oriented: north up with east left as the naked eye sees it, south up as an inverting telescope
// shows it, or north up with east right as a star diagonal shows it.
export type JupiterOrientation = 'north' | 'south' | 'mirrored'

// Every orientation.
export const JUPITER_ORIENTATIONS: readonly JupiterOrientation[] = ['north', 'south', 'mirrored']

// Label of each orientation.
export const ORIENTATION_LABELS: Readonly<Record<JupiterOrientation, string>> = { north: 'North up, east left', south: 'South up (inverting)', mirrored: 'North up, east right (diagonal)' }

// Scale of the viewer: the disk close up, or the whole system of the moons.
export type JupiterScale = 'disk' | 'system'

// Label of each scale.
export const SCALE_LABELS: Readonly<Record<JupiterScale, string>> = { disk: 'Disk', system: 'System' }

// Step of the step buttons, in milliseconds (10 minutes).
export const STEP_MS = 600_000

// Milliseconds per day.
const DAY_MS = 86_400_000

// Milliseconds per hour.
const HOUR_MS = 3_600_000

// Delay between the last change of the clock and the request of the exact view, in milliseconds.
const STATE_DELAY_MS = 120

// Shortest wait between two requests of the exact view while the clock plays, in milliseconds.
const PLAY_STATE_INTERVAL_MS = 750

// Requests of the tool, replaced in tests.
export interface JupiterIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Real current time, Unix milliseconds (UTC).
	readonly time: () => number
}

// Browser implementation of JupiterIo.
export const browserJupiterIo: JupiterIo = { fetch: (input, init) => fetch(input, init), time: () => Date.now() }

// Tab-lived state of the tool.
export interface JupiterPlannerState {
	// Where the visibility is judged from.
	location: ToolLocation
	// Zone the times are shown in.
	zone: DisplayZoneOverride
	// Civil date of the first evening of the period, in the zone that names the dates; absent until the tool opens.
	eveningDate?: string
	// Days of the period.
	period: JupiterPeriod
	// Instant of the tool's clock; absent until the tool opens, then real now.
	time?: number
	// Whether the clock plays.
	playing: boolean
	// Rate of the clock while it plays.
	rate: JupiterRate
	// Kinds of events listed.
	kinds: JupiterEventKind[]
	// Moons whose events are listed and whose curves are drawn.
	moons: GalileanMoon[]
	// Orientation of the viewer.
	orientation: JupiterOrientation
	// Scale of the viewer.
	scale: JupiterScale
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

// Returns whether a failure is the abort of a superseded request.
function aborted(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError'
}

// Returns the message of a failure.
function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

// Civil date of the evening holding an instant in a zone: the date of twelve hours earlier, so the small hours belong
// to the evening before. Only the default of the date picker; the server names each event's night itself.
export function eveningOf(time: number, timeZone: string) {
	const { year, month, day } = zonedWallTime(time - 12 * HOUR_MS, timeZone)
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// The period of an evening date: from its local noon in the zone, for `period` days. A noon the clocks skip falls back
// to UTC noon of the date.
export function periodRange(eveningDate: string, period: JupiterPeriod, timeZone: string) {
	const [year, month, day] = eveningDate.split('-').map(Number)
	const instant = wallTimeToInstant({ year, month, day, hour: 12, minute: 0, second: 0 }, timeZone)
	const start = instant.kind === 'exact' ? instant.time : instant.kind === 'ambiguous' ? instant.earlier : Date.UTC(year, month - 1, day, 12)
	return { start, end: start + period * DAY_MS }
}

// Reads the view of Jupiter at the clock's instant, dropping the answer of a superseded request.
export async function loadState(state: JupiterPlannerState, io: JupiterIo = browserJupiterIo) {
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
export async function loadTrack(state: JupiterPlannerState, range: { readonly start: number; readonly end: number }, io: JupiterIo = browserJupiterIo) {
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
export async function loadEvents(state: JupiterPlannerState, range: { readonly start: number; readonly end: number }, site: SiteLocation | undefined, io: JupiterIo = browserJupiterIo) {
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
export async function loadSource(state: JupiterPlannerState, range: { readonly start: number; readonly end: number }, io: JupiterIo = browserJupiterIo) {
	const request = sourceGuard.begin()

	try {
		const answer = await fetchJson<JupiterSourceReport>(io, '/api/jupiter/source', jsonInit('POST', range, request.signal))
		if (request.current()) state.source = answer
	} catch {
		// The readiness only explains; the computations answer for themselves.
	}
}

// Value of a datetime-local input for an instant in a zone.
export function localInput(time: number, timeZone: string) {
	const { year, month, day, hour, minute } = zonedWallTime(time, timeZone)
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

// Instant of a datetime-local input in a zone: the earlier of a repeated reading, undefined for an empty value or one
// the clocks skip.
export function inputInstant(value: string, timeZone: string) {
	const [date, clock] = value.split('T')
	if (!date || !clock) return undefined
	const [year, month, day] = date.split('-').map(Number)
	const [hour, minute] = clock.split(':').map(Number)
	const instant = wallTimeToInstant({ year, month, day, hour, minute, second: 0 }, timeZone)
	return instant.kind === 'exact' ? instant.time : instant.kind === 'ambiguous' ? instant.earlier : undefined
}

// Sets the clock to an instant and stops playing.
export function setTime(state: JupiterPlannerState, time: number) {
	state.time = time
	state.playing = false
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

// The listed event whose maximum is the next after (direction 1) or the last before (direction −1) an instant.
export function adjacentEvent(events: readonly JupiterEvent[], time: number, direction: 1 | -1) {
	let best: JupiterEvent | undefined

	for (const event of events) {
		if (direction > 0 ? event.maximum > time + 1000 : event.maximum < time - 1000) {
			if (!best || (direction > 0 ? event.maximum < best.maximum : event.maximum > best.maximum)) best = event
		}
	}

	return best
}

// A moon's sky offsets at an instant, from the tracks: east, north, and depth in Jupiter radii.
export interface MoonPosition {
	readonly east: number
	readonly north: number
	readonly depth: number
}

// Positions of the moons at an instant by linear interpolation between the samples of the tracks, for display only;
// undefined outside the tracks.
export function interpolateTrack(track: Pick<JupiterTrack, 'times' | 'moons'> | undefined, time: number): Record<GalileanMoon, MoonPosition> | undefined {
	if (!track || track.times.length < 2) return undefined
	const { times } = track
	if (time < times[0] || time > times.at(-1)!) return undefined

	let low = 0
	let high = times.length - 1

	while (high - low > 1) {
		const middle = (low + high) >> 1
		if (times[middle] <= time) low = middle
		else high = middle
	}

	const f = (time - times[low]) / (times[high] - times[low])
	const at = (values: readonly number[]) => values[low] + (values[high] - values[low]) * f
	const position = (moon: GalileanMoon): MoonPosition => ({ east: at(track.moons[moon].east), north: at(track.moons[moon].north), depth: at(track.moons[moon].depth) })
	return { io: position('io'), europa: position('europa'), ganymede: position('ganymede'), callisto: position('callisto') }
}

// Offset along Jupiter's equator toward the east (in Jupiter radii) of a sky offset, given the position angle of the
// projected pole.
export function equatorOffset(east: number, north: number, poleAngle: number) {
	return east * Math.cos(poleAngle) - north * Math.sin(poleAngle)
}

// Screen offsets (x to the right, y down, in Jupiter radii) of a sky offset in an orientation.
export function screenOffset(east: number, north: number, orientation: JupiterOrientation): readonly [number, number] {
	if (orientation === 'south') return [east, north]
	if (orientation === 'mirrored') return [east, -north]
	return [-east, -north]
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
export function scheduleState(state: JupiterPlannerState, io: JupiterIo = browserJupiterIo, delay: number = STATE_DELAY_MS) {
	const timer = setTimeout(() => void loadState(state, io), delay)
	return () => clearTimeout(timer)
}

// Advances a playing clock by the real time elapsed, at its rate; the exact view is asked for at most every
// PLAY_STATE_INTERVAL_MS. Returns the stop of the loop. A hidden tab stops playing.
export function play(state: JupiterPlannerState, reducedMotion: boolean, io: JupiterIo = browserJupiterIo, frame: (run: (now: number) => void) => number = requestAnimationFrame, cancel: (id: number) => void = cancelAnimationFrame) {
	let last: number | undefined
	let lastState = 0
	let id = 0

	const tick = (now: number) => {
		if (!state.playing || state.time === undefined) return
		// With reduced motion the clock jumps once a second instead of gliding.
		if (last === undefined || !reducedMotion || now - last >= 1000) {
			if (last !== undefined) state.time += (now - last) * state.rate
			last = now
		}

		if (now - lastState >= PLAY_STATE_INTERVAL_MS) {
			lastState = now
			void loadState(state, io)
		}

		id = frame(tick)
	}

	id = frame(tick)
	return () => cancel(id)
}

// Opens the SPICE Kernel Library, where the operator adds or enables a Jovian kernel; nothing is downloaded here.
export function openKernelLibrary(route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	navigate(route, { workspace: 'tools', tool: 'spice-kernel-library' }, history)
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
export async function refreshJupiterGrs(state: JupiterGrsState, io: Pick<JupiterIo, 'fetch'> = browserJupiterIo) {
	try {
		state.grs = await fetchJson<JupiterGrsResponse>(io, '/api/jupiter/grs')
	} catch {
		// Read again on the next socket open.
	}
}

// Applies an event of the Great Red Spot model, keeping the newest revision. The state is the server's as of the
// save; the tab reads it again to refresh the staleness.
export function handleJupiterGrsEvent(state: JupiterGrsState, event: ServerEvent, io: Pick<JupiterIo, 'fetch'> = browserJupiterIo) {
	if (event.type !== 'jupiter:grsUpdated') return
	if (state.grs && state.grs.revision >= event.grs.revision) return
	void refreshJupiterGrs(state, io)
}

// Saves a model edited from the revision the tab knows. A refusal keeps the model and shows what the other tab saved,
// until the operator keeps theirs or saves this one over it.
export async function saveJupiterGrs(state: JupiterGrsState, model: JupiterGrsModel, io: Pick<JupiterIo, 'fetch'> = browserJupiterIo) {
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
export function saveMineGrs(state: JupiterGrsState, io: Pick<JupiterIo, 'fetch'> = browserJupiterIo) {
	if (state.pending) return saveJupiterGrs(state, state.pending, io)
	return Promise.resolve()
}
