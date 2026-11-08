import { interpolatedSaturnianEphemeris, SATURNIAN_MOONS, type SaturnianEphemeris } from 'nebulosa/src/astronomy/ephemeris/saturnian'
import { findSaturnianMutualEvents, type MutualEvent } from 'nebulosa/src/astronomy/events/mutual'
import type { SatellitePhenomenonKind } from 'nebulosa/src/astronomy/events/satellites.phenomena'
import { type SaturnianView, saturnianView } from 'nebulosa/src/astronomy/events/saturn.geometry'
import { type SaturnianPhenomenon, saturnianPhenomena } from 'nebulosa/src/astronomy/events/saturn.phenomena'
import { SATURN_RING_MODEL } from 'nebulosa/src/astronomy/events/saturn.rings'
import { type Time, tdb, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { SATURN_EQUATORIAL_RADIUS_KM } from 'nebulosa/src/core/constants'
import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import type { PlanningSite } from './observingplanner.astronomy'
import { toolkitTime, yieldToEventLoop } from './planetary.source'
// oxfmt-ignore
import { definedContacts, hiddenIntervals, type MoonEventContacts, overlapsOf, physicallyVisible, type PlanetEventVisibility, type PlanetNight, rank, siteNights, type SiteReasons, siteVisibility, unixMillisOf, type VisiblePart } from './planetary.visibility'
import { type SaturnKernels, type SaturnMoon, type SaturnSourced, withSaturnianSource } from './saturn.astronomy'
import type { TimeSpan } from './sky/sun'

// Phenomena of the Saturn Observing Planner: the transits, shadow transits, occultations and eclipses of the seven
// major moons and their mutual occultations and eclipses over a range, all from one moons source, with the contacts the
// toolkit reached, the events they overlap, whether the rings may interfere with seeing them, and their visibility from
// a site. Contacts are geocentric observed instants and never change with the site. The rings are geometric only: an
// event whose moon passes behind the projected rings, or whose shadow falls on the disk behind the near rings, is
// marked as possibly hidden (status uncertainRingInterference, reason ringInterferencePossible), never as an exact
// ring occultation. Times are Unix milliseconds (UTC), angles radians.

// Kind of Saturn event.
export type SaturnEventKind = SatellitePhenomenonKind | 'mutualOccultation' | 'mutualEclipse'

// Every Saturn event kind, in display order.
export const SATURN_EVENT_KINDS: readonly SaturnEventKind[] = ['satelliteTransit', 'shadowTransit', 'satelliteOccultation', 'satelliteEclipse', 'mutualOccultation', 'mutualEclipse']

// Contacts of an event, Unix milliseconds; each only where it is computed and reached (see the toolkit's
// SatellitePhenomenon). A mutual event has only external1 and external2.
export type SaturnEventContacts = MoonEventContacts

// Whether an event can be watched from the site; uncertainRingInterference when it could be, but the rings may hide it.
export type SaturnVisibilityStatus = PlanetEventVisibility<string>['status'] | 'uncertainRingInterference'

// Why an event, or part of it, cannot be watched from the site, or may not be:
// - sunTooHigh: the Sun is above the planetary limit (−6°); saturnTooLow: Saturn is below the planetary minimum (25°);
// - moonHidden: a participating moon is behind Saturn or in its shadow; shadowHidden: a shadow faces away from the Earth;
// - ringInterferencePossible: a moon or a shadow lies behind the projected rings for part of it.
export type SaturnVisibilityReason = 'sunTooHigh' | 'saturnTooLow' | 'moonHidden' | 'shadowHidden' | 'ringInterferencePossible'

// Visibility of an event from the site.
export interface SaturnEventVisibility extends Omit<PlanetEventVisibility<SaturnVisibilityReason>, 'status'> {
	readonly status: SaturnVisibilityStatus
}

// One Saturn event.
export interface SaturnEvent {
	// Stable identity: the kind, the participants, and the maximum to the second.
	readonly id: string
	readonly kind: SaturnEventKind
	// Moons taking part: one for a satellite phenomenon, [front, back] for a mutual event.
	readonly moons: readonly SaturnMoon[]
	// First instant: the external contact, or the maximum when it was not found.
	readonly start: number
	// Maximum: the conjunction or the mutual event's middle.
	readonly maximum: number
	// Last instant, as start.
	readonly end: number
	readonly contacts: SaturnEventContacts
	// Whether the event starts before the requested range.
	readonly startsBeforeRange: boolean
	// Whether the event ends after the requested range.
	readonly endsAfterRange: boolean
	// Whether a satellite phenomenon is a zero-duration tangency.
	readonly grazing: boolean
	// Deepest external margin of a satellite phenomenon, in Saturn radii (negative).
	readonly depth?: number
	// Impact parameter of a mutual event, in [0, 1): 0 central, near 1 grazing.
	readonly impactParameter?: number
	// Whether a participating moon, or the shadow, lies behind the projected rings at some sampled instant of the event.
	readonly ringInterference: boolean
	// Ids of the other events whose intervals intersect this one.
	readonly overlaps: readonly string[]
	readonly visibility: SaturnEventVisibility
}

// Request of the events over a range.
export interface SaturnEventsRequest {
	// First instant of the range, Unix milliseconds.
	readonly start: number
	// End of the range, exclusive, Unix milliseconds.
	readonly end: number
	// Site whose visibility is evaluated; absent for global predictions only.
	readonly site?: PlanningSite
	// Kinds returned; every kind when absent.
	readonly kinds?: readonly SaturnEventKind[]
	// Moons whose events are returned (a mutual event when either moon is selected); every moon when absent.
	readonly moons?: readonly SaturnMoon[]
}

// A night of the site over the range, with Saturn's watchable windows.
export type SaturnNight = PlanetNight

// Days the event scan reaches beyond each end of the range, so an event overlapping the range whose maximum lies outside
// it is found: longer than half of the longest phenomenon (a central Iapetus eclipse, ~10.5 hours).
const EVENT_PAD_DAYS = 0.5

// Span of one chunk of the event scan, in days.
const EVENT_CHUNK_DAYS = 1

// Events whose visibility is evaluated between two yields to the event loop.
const VISIBILITY_YIELD_EVERY = 10

// Instants sampled across an event for the ring interference, both ends included.
const RING_SAMPLES = 7

// Reason codes of Saturn's site limits.
const SITE_REASONS: SiteReasons<SaturnVisibilityReason> = { sunTooHigh: 'sunTooHigh', planetTooLow: 'saturnTooLow' }

// NAIF code of Saturn's centre in the Observing Planner's planning bodies.
const SATURN_CODE = '699'

// Inner and outer radii of the modeled rings, in Saturn equatorial radii.
const RING_INNER = SATURN_RING_MODEL.annuli[0].inner / SATURN_EQUATORIAL_RADIUS_KM
const RING_OUTER = SATURN_RING_MODEL.outerRadius / SATURN_EQUATORIAL_RADIUS_KM

// An event of the scan before the site and the overlaps are considered.
type ScannedEvent = Omit<SaturnEvent, 'overlaps' | 'visibility'>

// Whether a sky offset (Saturn radii) lies over the near half of the projected ring annulus, so the rings are in front
// of what lies there on the disk: between the C ring's inner and the A ring's outer ellipses, on the side away from the
// far half (the far half lies toward the projected north pole when the Earth is north of the ring plane).
function underNearRings(view: SaturnianView, east: number, north: number) {
	const p = view.polePositionAngle
	const along = east * Math.cos(p) - north * Math.sin(p)
	const across = east * Math.sin(p) + north * Math.cos(p)
	const sinB = Math.abs(Math.sin(view.earthOpening))
	// Whether the point lies inside the projected circle of a ring radius: an ellipse of semi-axes radius and radius·|sin B|.
	const inside = (radius: number) => {
		const minor = radius * sinB
		if (minor === 0) return across === 0 && Math.abs(along) <= radius
		return (along / radius) ** 2 + (across / minor) ** 2 <= 1
	}
	const near = view.earthOpening >= 0 ? across < 0 : across > 0
	return near && inside(RING_OUTER) && !inside(RING_INNER)
}

// Whether the rings may interfere with an event, from views sampled across its interval: a moon taking part lies behind
// the rings, or, for a shadow transit, the shadow falls on the disk under the near rings.
function ringInterference(ephemeris: SaturnianEphemeris, kind: SaturnEventKind, moons: readonly SaturnMoon[], start: number, end: number) {
	for (let j = 0; j < RING_SAMPLES; j++) {
		const time = end > start ? start + ((end - start) * j) / (RING_SAMPLES - 1) : start
		const view = saturnianView(ephemeris, toolkitTime(time), moons)

		for (const moon of view.moons) {
			if (kind === 'shadowTransit') {
				if (moon.shadow?.visible && underNearRings(view, moon.shadow.east, moon.shadow.north)) return true
			} else if (moon.ringOverlap === 'behind') {
				return true
			}
		}

		if (end <= start) break
	}

	return false
}

// Builds the events of one chunk: the phenomena and mutual events whose maximum lies in it, with their identity,
// interval, contacts, range flags and ring interference, all from `ephemeris`.
function scanChunk(ephemeris: SaturnianEphemeris, from: Time, to: Time, start: number, end: number): ScannedEvent[] {
	const events: ScannedEvent[] = []
	const push = (event: Omit<ScannedEvent, 'id' | 'startsBeforeRange' | 'endsAfterRange' | 'ringInterference'>) => {
		if (event.end < start || event.start >= end) return
		events.push({ ...event, id: `${event.kind}|${event.moons.join('-')}|${Math.round(event.maximum / 1000)}`, startsBeforeRange: event.start < start, endsAfterRange: event.end > end, ringInterference: ringInterference(ephemeris, event.kind, event.moons, event.start, event.end) })
	}

	for (const p of saturnianPhenomena(ephemeris, from, to) satisfies SaturnianPhenomenon[]) {
		const maximum = timeToUnixMillis(p.maximum)
		const contacts = definedContacts({
			external1: unixMillisOf(p.external1),
			internal1: unixMillisOf(p.internal1),
			center1: unixMillisOf(p.center1),
			center2: unixMillisOf(p.center2),
			internal2: unixMillisOf(p.internal2),
			external2: unixMillisOf(p.external2),
			visibleStart: unixMillisOf(p.visibleStart),
			visibleEnd: unixMillisOf(p.visibleEnd),
		})
		push({ kind: p.kind, moons: [p.moon], start: contacts.external1 ?? maximum, maximum, end: contacts.external2 ?? maximum, contacts, grazing: p.grazing, depth: p.depth })
	}

	for (const e of findSaturnianMutualEvents(ephemeris, from, to) satisfies MutualEvent<SaturnMoon>[]) {
		const maximum = timeToUnixMillis(e.middle)
		const contacts = definedContacts({ external1: unixMillisOf(e.start), external2: unixMillisOf(e.end) })
		push({ kind: e.kind === 'occultation' ? 'mutualOccultation' : 'mutualEclipse', moons: [e.front, e.back], start: contacts.external1 ?? maximum, maximum, end: contacts.external2 ?? maximum, contacts, grazing: false, impactParameter: e.impactParameter })
	}

	return events
}

// Applies the ring interference to a visibility: a watchable event becomes uncertain, and the reason is added.
function withRings(visibility: PlanetEventVisibility<SaturnVisibilityReason>, interference: boolean): SaturnEventVisibility {
	if (!interference) return visibility
	const status = visibility.status === 'observable' || visibility.status === 'partial' ? 'uncertainRingInterference' : visibility.status
	return { ...visibility, status, reasons: [...visibility.reasons, 'ringInterferencePossible'] }
}

// Computes the events over a range: scans the padded range in day chunks with one moons source, keeps the events
// overlapping the range, filters them by kind and moon, and evaluates their visibility from the site when one is given.
// The visibility of a mutual event or an eclipse uses the occultations and eclipses of every moon, filtered or not.
export async function computeEvents(
	kernels: SaturnKernels,
	nights: (request: AstroWeatherNightRequest) => AstroWeatherNight,
	request: SaturnEventsRequest,
	signal?: AbortSignal,
): Promise<{ readonly start: number; readonly end: number; readonly events: SaturnEvent[]; readonly nights: SaturnNight[]; readonly sourced: Omit<SaturnSourced<unknown>, 'results'> }> {
	const { start, end, site } = request
	const kinds = new Set(request.kinds ?? SATURN_EVENT_KINDS)
	const moons = new Set(request.moons ?? SATURNIAN_MOONS)
	const from = start - EVENT_PAD_DAYS * 86_400_000
	const to = end + EVENT_PAD_DAYS * 86_400_000
	const chunkMs = EVENT_CHUNK_DAYS * 86_400_000
	const count = Math.max(1, Math.ceil((to - from) / chunkMs))
	const chunk = (ephemeris: SaturnianEphemeris, i: number) => scanChunk(ephemeris, tdb(toolkitTime(from + i * chunkMs)), tdb(toolkitTime(Math.min(to, from + (i + 1) * chunkMs))), start, end)
	const { results, source, snapshot } = await withSaturnianSource(kernels, 'moons', count, chunk, interpolatedSaturnianEphemeris, signal)

	const all = results.flat().sort((a, b) => a.maximum - b.maximum || a.id.localeCompare(b.id))
	const hidden = hiddenIntervals(all, SATURNIAN_MOONS)
	const selected = all.filter((e) => kinds.has(e.kind) && e.moons.some((moon) => moons.has(moon)))
	const overlaps = overlapsOf(selected)
	// Nights over the padded range, so the parts of the events beyond the range are judged too.
	const siteNightList = site ? await siteNights(nights, site, SATURN_CODE, from, to, signal) : []
	const events: SaturnEvent[] = []

	for (let i = 0; i < selected.length; i++) {
		if (site && i > 0 && i % VISIBILITY_YIELD_EVERY === 0) {
			await yieldToEventLoop()
			signal?.throwIfAborted()
		}

		const event = selected[i]
		const visible = physicallyVisible(event, hidden)
		const base: PlanetEventVisibility<SaturnVisibilityReason> = site ? siteVisibility(event, visible, siteNightList, SATURN_CODE, SITE_REASONS) : { status: 'unknownNoSite', windows: [], longestMs: 0, reasons: visible.reason ? [visible.reason] : [] }
		events.push({ ...event, overlaps: overlaps[i], visibility: withRings(base, event.ringInterference) })
	}

	rank(events)
	const shown = siteNightList.map((e) => e.night).filter((e) => e.end > start && e.start < end)
	return { start, end, events, nights: shown, sourced: { source, snapshot } }
}
