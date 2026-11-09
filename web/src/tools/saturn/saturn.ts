import type {
	PlanetaryFallbackReason,
	SaturnElongation,
	SaturnElongations,
	SaturnEvent,
	SaturnEventKind,
	SaturnEvents,
	SaturnEventsRequest,
	SaturnMoon,
	SaturnMoonsState,
	SaturnRingEvent,
	SaturnRingState,
	SaturnRingTimeline,
	SaturnSignature,
	SaturnSourceReport,
	SaturnTrack,
	SaturnVisibilityReason,
	SaturnVisibilityStatus,
} from 'api'
import { proxy } from 'valtio'
import { ApiResponseError, fetchJson, jsonInit } from '../../http'
import { ACTIVE_TOOL_LOCATION, type SiteLocation, type ToolLocation } from '../../location/site'
import { DEFAULT_ZONE_OVERRIDE, type DisplayZoneOverride } from '../../location/zone'
import { createRequestGuard } from '../../sky/selection'
import type { StatusTone } from '../../ui/StatusBadge'
import { planningSite, showTargetInSky } from '../observingplanner/observingplanner'
import { aborted, browserPlannerIo, errorMessage, interpolateTrack as interpolateMoons, type MoonPosition, type PlanetOrientation, type PlanetPeriod, type PlanetRate, type PlannerIo, playClock, scheduleLoad, setTime, VISIBILITY_LABELS } from '../planetary/planetary'

// Saturn Observing Planner of the tab: the tool-local clock and period, the moons drawn, the view, and the answers of the
// server (the rings and moons at the clock's instant, the ring openings and ring-plane events over a season, the moon
// tracks and their greatest separations over the period, and the kernel readiness of the rings and the moons). Every
// position, opening, event, and classification comes from the server; the tab only interpolates the sampled tracks for
// display while the clock moves, and never derives an event from samples. When the moons cannot be computed (spkOnly
// without a satellite kernel) the rings are still read on their own. Nothing here changes the Sky clock, a site, the
// profile, or a device. Times are Unix milliseconds (UTC); angles radians.

// The seven major moons, in orbital order.
export const SATURN_MOONS: readonly SaturnMoon[] = ['mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus']

// Name of each moon.
export const MOON_LABELS: Readonly<Record<SaturnMoon, string>> = { mimas: 'Mimas', enceladus: 'Enceladus', tethys: 'Tethys', dione: 'Dione', rhea: 'Rhea', titan: 'Titan', iapetus: 'Iapetus' }

// Short label of each moon, drawn beside it.
export const MOON_INITIALS: Readonly<Record<SaturnMoon, string>> = { mimas: 'Mi', enceladus: 'En', tethys: 'Te', dione: 'Di', rhea: 'Rh', titan: 'Ti', iapetus: 'Ia' }

// Colour of each moon's curve and marker.
export const MOON_COLORS: Readonly<Record<SaturnMoon, string>> = { mimas: '#9aa4b1', enceladus: '#7fd1e6', tethys: '#e0a030', dione: '#c78ad9', rhea: '#5bbf7a', titan: '#e0763a', iapetus: '#4a8fdf' }

// Name of each ring-plane event kind.
export const RING_EVENT_LABELS: Readonly<Record<SaturnRingEvent['kind'], string>> = {
	earthPlaneCrossing: 'Ring-plane crossing (Earth)',
	solarPlaneCrossing: 'Equinox (Sun crosses the ring plane)',
	nearPlaneApproach: 'Near ring-plane approach',
	openingMaximum: 'Widest ring opening',
	openingMinimum: 'Narrowest ring opening',
}

// What each ring-plane event kind is, in one sentence.
export const RING_EVENT_DEFINITIONS: Readonly<Record<SaturnRingEvent['kind'], string>> = {
	earthPlaneCrossing: 'The Earth passes through the ring plane: the rings are edge-on and nearly vanish, and the Earth starts seeing their other face.',
	solarPlaneCrossing: "Saturn's equinox: the Sun passes through the ring plane and starts lighting the rings' other face. It is a different instant from the Earth's crossings.",
	nearPlaneApproach: 'The Earth comes close to the ring plane and turns back without crossing it.',
	openingMaximum: 'A local maximum of the signed Earth opening: the rings open no further in this stretch.',
	openingMinimum: 'A local minimum of the signed Earth opening.',
}

// Every phenomenon kind, in display order.
export const EVENT_KINDS: readonly SaturnEventKind[] = ['satelliteTransit', 'shadowTransit', 'satelliteOccultation', 'satelliteEclipse', 'mutualOccultation', 'mutualEclipse']

// Name of each phenomenon kind.
export const KIND_LABELS: Readonly<Record<SaturnEventKind, string>> = {
	satelliteTransit: 'Transit',
	shadowTransit: 'Shadow transit',
	satelliteOccultation: 'Occultation',
	satelliteEclipse: 'Eclipse',
	mutualOccultation: 'Mutual occultation',
	mutualEclipse: 'Mutual eclipse',
}

// What each phenomenon kind is, in one sentence.
export const KIND_DEFINITIONS: Readonly<Record<SaturnEventKind, string>> = {
	satelliteTransit: 'The moon crosses in front of the oblate disk. External contacts: the disks touch; internal: the moon is wholly on the disk.',
	shadowTransit: "The moon's shadow crosses the sunlit disk. External contacts: the penumbra touches the disk as seen from the Sun; internal: the whole penumbra is on it. The shadow need not cross with the moon.",
	satelliteOccultation: 'The moon passes behind the disk. External contacts: the disks touch; internal: the moon is wholly hidden.',
	satelliteEclipse: "The moon passes through Saturn's shadow. External contacts: the moon touches the penumbra; centre: its centre crosses the umbra's edge; internal: it is wholly in the umbra.",
	mutualOccultation: 'One moon passes in front of another. Only the first and last contacts and how central it is are predicted, not the drop in light.',
	mutualEclipse: "One moon's shadow falls on another. Only the first and last contacts and how central it is are predicted, not the drop in light.",
}

// Label and tone of each visibility status of a phenomenon.
export const EVENT_VISIBILITY_LABELS: Readonly<Record<SaturnVisibilityStatus, { readonly label: string; readonly tone: StatusTone }>> = {
	...VISIBILITY_LABELS,
	uncertainRingInterference: { label: 'Rings may hide it', tone: 'warning' },
}

// Sentence of each visibility reason.
export const REASON_LABELS: Readonly<Record<SaturnVisibilityReason, string>> = {
	sunTooHigh: 'The Sun is above −6° at the site.',
	saturnTooLow: 'Saturn is below 25° at the site.',
	moonHidden: 'A moon taking part is behind Saturn or in its shadow for part of it.',
	shadowHidden: 'The shadow faces away from the Earth for part of it.',
	ringInterferencePossible: 'A moon or the shadow lies behind the rings for part of it; the rings may hide it, which is not predicted exactly.',
}

// Sentence of each reason the kernels were not used.
export const FALLBACK_LABELS: Readonly<Record<PlanetaryFallbackReason, string>> = {
	noKernel: 'no SPICE kernel is enabled',
	loading: 'the kernels are still being opened',
	targetMissing: 'no enabled kernel has every body needed',
	missingCenter: 'a body is relative to a center no kernel has',
	outOfCoverage: 'the kernels do not cover the whole range',
	unsupportedFrame: 'a selected segment uses an unsupported frame',
	unsupportedType: 'a selected segment uses an unsupported data type',
	cycle: 'a kernel chain never reaches the barycenter',
}

// How much of Saturn's seasons the ring history shows: the year of the first evening, ten years around it, or a whole
// Saturnian year (29.5 years) around it.
export type RingHistory = 'year' | 'decade' | 'season'

// Every history span.
export const RING_HISTORIES: readonly RingHistory[] = ['year', 'decade', 'season']

// Label of each history span.
export const RING_HISTORY_LABELS: Readonly<Record<RingHistory, string>> = { year: 'Year', decade: '±5 years', season: 'Saturnian year' }

// Milliseconds per Julian year.
const YEAR_MS = 365.25 * 86_400_000

// Length of a Saturnian year, milliseconds (29.46 Julian years).
const SATURN_YEAR_MS = 29.46 * YEAR_MS

// Tab-lived state of the tool.
export interface SaturnPlannerState {
	// Where the night windows are judged from.
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
	// Moons drawn and listed.
	moons: SaturnMoon[]
	// Kinds of phenomena listed.
	kinds: SaturnEventKind[]
	// Orientation of the viewer.
	orientation: PlanetOrientation
	// Whether the ring annuli are drawn.
	showRings: boolean
	// Span of the ring history.
	history: RingHistory
	// Id of the event selected in the list.
	selected?: string
	// Rings and moons at the clock's instant, the latest answered.
	moonsState?: SaturnMoonsState
	// Why the moons could not be computed.
	moonsError?: string
	// Whether the moons were refused under spkOnly, so the rings are read on their own.
	moonsRefused: boolean
	// Rings at the clock's instant, read when the moons are refused.
	ringState?: SaturnRingState
	// Why the rings could not be computed.
	ringError?: string
	// Ring openings and events over the history span.
	timeline?: SaturnRingTimeline
	// Whether the ring history is being computed.
	timelineLoading: boolean
	// Why the ring history could not be computed.
	timelineError?: string
	// Moon tracks of the period.
	track?: SaturnTrack
	// Whether the tracks are being computed.
	trackLoading: boolean
	// Why the tracks could not be computed.
	trackError?: string
	// Greatest separations over the period.
	elongations?: SaturnElongations
	// Why the separations could not be computed.
	elongationsError?: string
	// Phenomena of the period.
	events?: SaturnEvents
	// Whether the phenomena are being computed.
	eventsLoading: boolean
	// Why the phenomena could not be computed.
	eventsError?: string
	// Id of the phenomenon selected.
	selectedEvent?: string
	// Readiness of the kernels over the period, for the rings and for the moons.
	source?: SaturnSourceReport
}

// Creates the tab state of the tool.
export function createSaturnPlannerState(): SaturnPlannerState {
	return {
		location: { ...ACTIVE_TOOL_LOCATION },
		zone: { ...DEFAULT_ZONE_OVERRIDE },
		period: 3,
		playing: false,
		rate: 600,
		moons: [...SATURN_MOONS],
		kinds: [...EVENT_KINDS],
		eventsLoading: false,
		orientation: 'north',
		showRings: true,
		history: 'decade',
		moonsRefused: false,
		timelineLoading: false,
		trackLoading: false,
	}
}

// Tab state of the tool.
export const saturnPlannerState = proxy<SaturnPlannerState>(createSaturnPlannerState())

// Guards of the requests of the tool, each superseding its previous one.
const stateGuard = createRequestGuard()
const ringGuard = createRequestGuard()
const timelineGuard = createRequestGuard()
const trackGuard = createRequestGuard()
const elongationsGuard = createRequestGuard()
const sourceGuard = createRequestGuard()
const eventsGuard = createRequestGuard()

// A range of instants, Unix milliseconds.
export interface Range {
	readonly start: number
	readonly end: number
}

// The span of the ring history around an instant: the calendar year (UTC) holding it, ten years centred on it, or a
// Saturnian year centred on it; whole days, so the cache of the server is reused while the clock moves within a day.
export function historyRange(history: RingHistory, time: number): Range {
	if (history === 'year') {
		const year = new Date(time).getUTCFullYear()
		return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) }
	}

	const half = history === 'decade' ? 5 * YEAR_MS : SATURN_YEAR_MS / 2
	const day = 86_400_000
	return { start: Math.floor((time - half) / day) * day, end: Math.ceil((time + half) / day) * day }
}

// Reads the rings on their own at the clock's instant, when the moons are refused.
export async function loadRingState(state: SaturnPlannerState, io: PlannerIo = browserPlannerIo) {
	if (state.time === undefined) return
	const request = ringGuard.begin()

	try {
		const answer = await fetchJson<SaturnRingState>(io, '/api/saturn/rings/state', jsonInit('POST', { time: state.time }, request.signal))
		if (!request.current()) return
		state.ringState = answer
		state.ringError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.ringError = errorMessage(error)
	}
}

// Reads the rings and moons at the clock's instant, dropping the answer of a superseded request. A refusal of the moons
// (503) reads the rings on their own.
export async function loadState(state: SaturnPlannerState, io: PlannerIo = browserPlannerIo) {
	if (state.time === undefined) return
	const request = stateGuard.begin()

	try {
		const answer = await fetchJson<SaturnMoonsState>(io, '/api/saturn/moons/state', jsonInit('POST', { time: state.time }, request.signal))
		if (!request.current()) return
		state.moonsState = answer
		state.moonsError = undefined
		state.moonsRefused = false
		state.ringState = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.moonsState = undefined
		state.moonsError = errorMessage(error)
		state.moonsRefused = error instanceof ApiResponseError && error.status === 503
		if (state.moonsRefused) await loadRingState(state, io)
	}
}

// Reads the ring openings and events over a range.
export async function loadTimeline(state: SaturnPlannerState, range: Range, io: PlannerIo = browserPlannerIo) {
	const request = timelineGuard.begin()
	state.timelineLoading = true

	try {
		const answer = await fetchJson<SaturnRingTimeline>(io, '/api/saturn/rings/timeline', jsonInit('POST', range, request.signal))
		if (!request.current()) return
		state.timeline = answer
		state.timelineError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.timeline = undefined
		state.timelineError = errorMessage(error)
	} finally {
		if (request.current()) state.timelineLoading = false
	}
}

// Reads the moon tracks of a period.
export async function loadTrack(state: SaturnPlannerState, range: Range, io: PlannerIo = browserPlannerIo) {
	const request = trackGuard.begin()
	state.trackLoading = true

	try {
		const answer = await fetchJson<SaturnTrack>(io, '/api/saturn/moons/track', jsonInit('POST', range, request.signal))
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

// Reads the greatest separations of every moon over a period; the moon filter only chooses what is listed.
export async function loadElongations(state: SaturnPlannerState, range: Range, io: PlannerIo = browserPlannerIo) {
	const request = elongationsGuard.begin()

	try {
		const answer = await fetchJson<SaturnElongations>(io, '/api/saturn/moons/elongations', jsonInit('POST', range, request.signal))
		if (!request.current()) return
		state.elongations = answer
		state.elongationsError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.elongations = undefined
		state.elongationsError = errorMessage(error)
	}
}

// Reads the phenomena of a period, judged from a site when one is given; every kind and moon is asked for, and the
// filters only choose what is listed.
export async function loadEvents(state: SaturnPlannerState, range: Range, site: SiteLocation | undefined, io: PlannerIo = browserPlannerIo) {
	const request = eventsGuard.begin()
	state.eventsLoading = true
	const body: SaturnEventsRequest = { ...range, ...(site && { site: planningSite(site) }) }

	try {
		const answer = await fetchJson<SaturnEvents>(io, '/api/saturn/moons/events', jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.events = answer
		state.eventsError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.events = undefined
		state.eventsError = errorMessage(error)
	} finally {
		if (request.current()) state.eventsLoading = false
	}
}

// The phenomena listed: the filtered kinds, with at least one of the filtered moons.
export function listedPhenomena(events: readonly SaturnEvent[], kinds: readonly SaturnEventKind[], moons: readonly SaturnMoon[]) {
	return events.filter((e) => kinds.includes(e.kind) && e.moons.some((moon) => moons.includes(moon)))
}

// Name of a phenomenon: its kind and the moons taking part.
export function phenomenonName(event: Pick<SaturnEvent, 'kind' | 'moons'>) {
	if (event.moons.length === 2) return `${KIND_LABELS[event.kind]}: ${MOON_LABELS[event.moons[0]]} ${event.kind === 'mutualOccultation' ? 'in front of' : 'shadowing'} ${MOON_LABELS[event.moons[1]]}`
	return `${MOON_LABELS[event.moons[0]]} ${KIND_LABELS[event.kind].toLowerCase()}`
}

// Selects a phenomenon and moves the tool's clock to its maximum; the Sky clock, the site, and the devices are left alone.
export function selectPhenomenon(state: SaturnPlannerState, event: Pick<SaturnEvent, 'id' | 'maximum'>) {
	state.selectedEvent = event.id
	setTime(state, event.maximum)
}

// Reads the readiness of the kernels over a period.
export async function loadSource(state: SaturnPlannerState, range: Range, io: PlannerIo = browserPlannerIo) {
	const request = sourceGuard.begin()

	try {
		const answer = await fetchJson<SaturnSourceReport>(io, '/api/saturn/source', jsonInit('POST', range, request.signal))
		if (request.current()) state.source = answer
	} catch {
		// The readiness only explains; the computations answer for themselves.
	}
}

// An entry of the event list: a ring-plane event or a greatest separation, with a stable id.
export type SaturnListedEvent = ({ readonly type: 'ring' } & SaturnRingEvent) | ({ readonly type: 'separation' } & SaturnElongation)

// Id of a listed event.
export function listedId(event: SaturnListedEvent) {
	return event.type === 'ring' ? `ring|${event.kind}|${event.time}` : `separation|${event.moon}|${event.time}`
}

// The events listed for the period: the ring-plane events in it and the greatest separations of the moons drawn,
// chronologically.
export function listedEvents(timeline: SaturnRingTimeline | undefined, elongations: SaturnElongations | undefined, range: Range | undefined, moons: readonly SaturnMoon[]): SaturnListedEvent[] {
	const out: SaturnListedEvent[] = []
	if (timeline && range) for (const event of timeline.events) if (event.time >= range.start && event.time < range.end) out.push({ type: 'ring', ...event })
	if (elongations) for (const event of elongations.elongations) if (moons.includes(event.moon)) out.push({ type: 'separation', ...event })
	return out.sort((a, b) => a.time - b.time)
}

// Selects a listed event and moves the tool's clock to it; the Sky clock, the site, and the devices are left alone.
export function selectEvent(state: SaturnPlannerState, event: SaturnListedEvent) {
	state.selected = listedId(event)
	setTime(state, event.time)
}

// Positions of the seven moons at an instant by linear interpolation between the samples of the tracks, for display
// only; undefined outside the tracks.
export function interpolateTrack(track: Pick<SaturnTrack, 'times' | 'moons'> | undefined, time: number): Record<SaturnMoon, MoonPosition> | undefined {
	return interpolateMoons(track, time, SATURN_MOONS)
}

// One-line description of the source of an answer.
export function describeSource(signature: SaturnSignature | undefined) {
	if (!signature) return undefined
	const { source } = signature
	if (source.kind === 'spk') {
		const files = new Set(Object.values(source.kernels).flat())
		return `SPICE kernels (${files.size} file${files.size === 1 ? '' : 's'}, generation ${signature.generation})`
	}

	return `${source.satellites ? 'VSOP87E + TASS 1.7' : 'VSOP87E'}, because ${FALLBACK_LABELS[source.fallbackReason]}`
}

// Schedules the request of the exact view after the clock settles, returning its cancellation.
export function scheduleState(state: SaturnPlannerState, io: PlannerIo = browserPlannerIo, delay?: number) {
	return scheduleLoad(() => loadState(state, io), delay)
}

// Advances a playing clock at its rate, asking for the exact view at intervals (see playClock). Returns the stop of the loop.
export function play(state: SaturnPlannerState, reducedMotion: boolean, io: PlannerIo = browserPlannerIo, frame?: (run: (now: number) => void) => number, cancel?: (id: number) => void) {
	return playClock(state, reducedMotion, () => loadState(state, io), frame, cancel)
}

// Shows Saturn in the Sky at the Sky's own time, through the Observing Planner's handoff, which changes no clock.
export function showSaturnInSky(site: SiteLocation | undefined) {
	showTargetInSky({ target: { kind: 'body', code: '699' }, name: 'Saturn' }, site)
}
