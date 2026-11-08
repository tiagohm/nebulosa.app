import type { OrbitCompareRequest, OrbitCompareResponse, OrbitResolveRequest, OrbitResolveResponse, OrbitVector } from 'api'
import { AU_KM, DAYSEC } from 'nebulosa/src/core/constants'
import type { MutVec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { hermiteVec3 } from 'nebulosa/src/math/numerical/spline'
import { ApiResponseError, fetchJson, jsonInit } from '../../http'
import type { GeographicLocation } from '../../location/site'
import { collapsibleSections, setSectionOpen } from '../../shell/collapsible'
import { navigate, type RouteState, routeState } from '../../shell/route'
import { createRequestGuard } from '../../sky/selection'
import { browserSkyIo, type SkyIo, type SkyState, selectSkyObject, skyState } from '../../sky/sky'
// oxfmt-ignore
import { addOrbit, addRefusal, anchorOf, clearOrbits, formatTdb, initialView, type OrbitalMechanicsIo, type OrbitalMechanicsState, type OrbitComparison, orbitalMechanicsState, type PendingOrbit, referenceCenter, unitOf } from './orbitalmechanics'

// Real objects of the Orbital Mechanics Explorer: a minor body's published SBDB solution or an SPK target's osculating
// state resolved by the server, the minor bodies other tools hand over, the comparison of the two-body model with the
// SPICE kernels, and the Sky handoff of a minor body. JPL is asked only when the operator says so: a handoff and a plain
// lookup read the bodies the server resolved recently, and say when only JPL can answer. A resolved orbit about another
// center than the scene's waits for the operator to replace the scene, since orbits about different centers are never
// drawn together.

// Side effects of a handoff into the explorer, replaced in tests.
export interface ExplorerHandoff {
	// Explorer state.
	readonly state: OrbitalMechanicsState
	// Route of the tab.
	readonly route: RouteState
	// History of the tab.
	readonly history: Pick<History, 'pushState'>
}

// Side effects of the Sky handoff, replaced in tests.
export interface ExplorerSkyHandoff {
	// Sky workspace state.
	readonly sky: SkyState
	// Route of the tab.
	readonly route: RouteState
	// Requests of the selection.
	readonly io: SkyIo
	// History of the tab.
	readonly history: Pick<History, 'pushState'>
}

// Browser implementation of the side effects.
const browserIo: OrbitalMechanicsIo = {
	fetch: (input, init) => fetch(input, init),
	schedule: (callback, delay) => {
		const id = setTimeout(callback, delay)
		return () => clearTimeout(id)
	},
}

// The explorer of the tab.
function browserExplorerHandoff(): ExplorerHandoff {
	return { state: orbitalMechanicsState, route: routeState, history: window.history }
}

// The Sky of the tab.
function browserSkyHandoff(): ExplorerSkyHandoff {
	return { sky: skyState, route: routeState, io: browserSkyIo, history: window.history }
}

// Request of the lookup in flight; a newer lookup supersedes it.
const lookupGuard = createRequestGuard()

// Request of the comparison in flight; a newer comparison supersedes it.
const comparisonGuard = createRequestGuard()

// Default number of instants of a comparison.
export const DEFAULT_COMPARE_COUNT = 241

// Largest number of instants of a comparison, the server's limit.
export const COMPARE_COUNT_LIMIT = 2048

// Id of the section of the lookups, opened when a handoff needs the operator.
export const SOURCES_SECTION = 'orbitalmechanics.sources'

// Asks the server for a real object's orbit and adds it, or keeps it waiting when it is about another center; with
// `replace` (a handoff, which asked for this very orbit) it replaces the scene instead.
async function resolve(state: OrbitalMechanicsState, request: OrbitResolveRequest, io: OrbitalMechanicsIo, replace = false) {
	const guard = lookupGuard.begin()
	const { lookup } = state
	lookup.loading = true
	lookup.error = undefined
	lookup.offerOnline = false
	lookup.kernelProblem = false
	lookup.matches = undefined
	lookup.pending = undefined

	try {
		const response = await fetchJson<OrbitResolveResponse>(io, '/api/orbital-mechanics/resolve', jsonInit('POST', request, guard.signal))
		if (!guard.current()) return
		if (response.kind === 'ambiguous') lookup.matches = response.matches
		else if (replace) {
			lookup.pending = response
			replaceSceneWithPending(state, io)
		} else acceptOrbit(state, response, io)
	} catch (error) {
		if (!guard.current()) return
		lookup.error = error instanceof Error ? error.message : String(error)
		// An offline lookup the server could not answer from the bodies it read recently is a 404; JPL may know it.
		lookup.offerOnline = request.kind === 'minorBody' && !request.online && error instanceof ApiResponseError && error.status === 404
		lookup.kernelProblem = request.kind === 'spk' && error instanceof ApiResponseError && error.status !== 404
	}

	lookup.loading = false
}

// Looks a minor body up by SPK-ID, designation, or name: from the bodies the server read recently, or from JPL when
// `online` allows it.
export function resolveMinorBody(state: OrbitalMechanicsState, query: string, online: boolean, io: OrbitalMechanicsIo = browserIo) {
	state.lookup.query = query
	return resolve(state, { kind: 'minorBody', query, online }, io)
}

// Reads the osculating state of an SPK target (NAIF ID) about a center (NAIF ID) at an instant (Julian date TDB) from the
// server's SPICE kernels.
export function resolveSpkState(state: OrbitalMechanicsState, target: number, center: number, epoch: number, io: OrbitalMechanicsIo = browserIo) {
	return resolve(state, { kind: 'spk', target, center, epoch }, io)
}

// Adds a resolved orbit when it is about the scene's center, keeping it waiting otherwise.
function acceptOrbit(state: OrbitalMechanicsState, orbit: PendingOrbit, io: OrbitalMechanicsIo) {
	if (state.center?.code !== orbit.center) {
		state.lookup.pending = orbit
		return
	}

	const refusal = addRefusal(state)
	if (refusal) state.lookup.error = refusal
	else addOrbit(state, orbit.definition, orbit.name, orbit.source, io)
}

// Replaces the scene with the orbit waiting, about its own center, with the clock at its anchor.
export function replaceSceneWithPending(state: OrbitalMechanicsState, io: OrbitalMechanicsIo = browserIo) {
	const orbit = state.lookup.pending
	const center = orbit && state.reference && referenceCenter(state.reference, orbit.center)
	if (!orbit || !center) return

	clearOrbits(state)
	state.lookup.pending = undefined
	state.center = JSON.parse(JSON.stringify(center)) as typeof center
	state.unit = unitOf(center)
	state.plane = center.code === 10 ? 'ecliptic' : 'equator'
	state.comparison = undefined
	addOrbit(state, orbit.definition, orbit.name, orbit.source, io)
	state.time = anchorOf(orbit.definition)
	state.view = initialView()
	state.fitPending = true
	state.ratePending = true
}

// Opens the explorer on a minor body another tool shows, by its identity only, never by a position. The explorer reads
// it from the bodies the server resolved recently once it opens, and asks before going to JPL.
export function exploreMinorBody(target: { readonly spkId: string; readonly name: string }, handoff: ExplorerHandoff = browserExplorerHandoff()) {
	handoff.state.pendingTarget = { spkId: target.spkId, name: target.name }
	navigate(handoff.route, { workspace: 'tools', tool: 'orbital-mechanics-explorer' }, handoff.history)
}

// Resolves the minor body handed over, once the reference is read, from the bodies the server read recently, and shows
// its orbit in place of the scene; when only JPL can answer, opens the lookups so the operator can ask it. Does nothing
// without a body handed over.
export async function consumePendingTarget(state: OrbitalMechanicsState, io: OrbitalMechanicsIo = browserIo, sections = collapsibleSections) {
	const target = state.pendingTarget
	if (!target || !state.reference) return
	state.pendingTarget = undefined
	state.lookup.query = target.spkId
	await resolve(state, { kind: 'minorBody', query: target.spkId, online: false }, io, true)
	if (state.lookup.error) setSectionOpen(sections, SOURCES_SECTION, true)
}

// Selects the minor body of an orbit in the Sky through the Sky's own path from `site` (undefined without one), leaving
// the Sky's clock, the site, and every device alone; the Sky computes the body's position with its own ephemeris.
export function showMinorBodyInSky(source: { readonly spkId: string; readonly designation: string }, name: string, site: GeographicLocation | undefined, handoff: ExplorerSkyHandoff = browserSkyHandoff()) {
	selectSkyObject(handoff.sky, { ref: { kind: 'minorBody', spkId: source.spkId, designation: source.designation }, source: 'search', name, category: 'minorBody' }, site, handoff.io)
	navigate(handoff.route, { workspace: 'sky' }, handoff.history)
}

// Why a comparison cannot be asked, or undefined when it can.
export function comparisonRefusal(request: Pick<OrbitCompareRequest, 'target' | 'center' | 'start' | 'end' | 'count'>, limits: { readonly epochMin: number; readonly epochMax: number }) {
	if (!Number.isInteger(request.target)) return 'The target must be a NAIF ID.'
	if (request.target === request.center) return 'The target cannot be its own center.'
	if (!(request.end > request.start)) return 'The comparison needs a span after its start.'
	if (!(request.start >= limits.epochMin && request.end <= limits.epochMax)) return 'The span is outside the supported range.'
	if (!(request.count >= 2 && request.count <= COMPARE_COUNT_LIMIT)) return `A comparison has from 2 to ${COMPARE_COUNT_LIMIT} instants.`
	return undefined
}

// Compares the two-body model with the SPICE kernels and, about the scene's center, adds the osculating orbit to the
// scene so both are drawn.
export async function runComparison(state: OrbitalMechanicsState, request: OrbitCompareRequest, io: OrbitalMechanicsIo = browserIo) {
	const guard = comparisonGuard.begin()
	state.comparing = true
	state.comparisonError = undefined

	try {
		const response = await fetchJson<OrbitCompareResponse>(io, '/api/orbital-mechanics/compare', jsonInit('POST', request, guard.signal))
		if (!guard.current()) return
		state.comparison = { request, response }
		const present = state.orbits.some((e) => e.source.kind === 'spk' && e.source.target === request.target && e.source.center === request.center && e.source.epoch === request.anchor)
		if (state.center?.code === request.center && !present && !addRefusal(state)) addOrbit(state, response.definition, `${response.name} (osculating)`, response.source, io)
	} catch (error) {
		if (!guard.current()) return
		state.comparisonError = error instanceof Error ? error.message : String(error)
	}

	state.comparing = false
}

// Position (AU) of the SPK reference of a comparison at `time` (Julian date TDB), interpolated between its exact states
// for drawing only; undefined outside its span.
export function referencePositionAt(response: Pick<OrbitCompareResponse, 'nodes' | 'reference'>, time: number, out: MutVec3 = [0, 0, 0]): MutVec3 | undefined {
	const { nodes, reference } = response
	if (nodes.length < 2 || time < nodes[0].time || time > nodes.at(-1)!.time) return undefined
	let k = 1
	while (k < nodes.length - 1 && nodes[k].time < time) k++
	const width = nodes[k].time - nodes[k - 1].time
	return hermiteVec3(reference.positions[k - 1], reference.velocities[k - 1], reference.positions[k], reference.velocities[k], width, width > 0 ? (time - nodes[k - 1].time) / width : 0, out)
}

// Kilometers of AU.
function km(au: number) {
	return au * AU_KM
}

// Meters per second of AU/day.
function ms(auPerDay: number) {
	return (auPerDay * AU_KM * 1000) / DAYSEC
}

// A component of an optional RTN vector in a unit, or empty when the frame is undefined.
function rtn(vector: OrbitVector | undefined, index: number, convert: (value: number) => number) {
	return vector ? String(convert(vector[index])) : ''
}

// CSV of a comparison (RFC 4180, CRLF): per instant the Kepler − SPK differences with their units in the column names,
// and the target, center, anchor, library generation, and kernels in columns of their own.
export function comparisonCsv(comparison: OrbitComparison) {
	const { request, response } = comparison
	const header = 'jd_tdb,time_tdb,dr_km,dv_m_per_s,dr_radial_km,dr_along_track_km,dr_normal_km,dv_radial_m_per_s,dv_along_track_m_per_s,dv_normal_m_per_s,target_naif,center_naif,anchor_jd_tdb,library_generation,kernels,difference'
	const source = response.source.kind === 'spk' ? response.source : undefined
	const tail = [response.target, response.center, request.anchor, source?.generation ?? '', `"${(source?.kernels ?? []).join(' ').replaceAll('"', '""')}"`, 'two-body Kepler minus SPK, geometric, J2000 equatorial'].join(',')
	const rows = response.nodes.map((e) => [e.time.toFixed(9), formatTdb(e.time).replace(' TDB', ''), km(e.distance), ms(e.speed), rtn(e.rtnPosition, 0, km), rtn(e.rtnPosition, 1, km), rtn(e.rtnPosition, 2, km), rtn(e.rtnVelocity, 0, ms), rtn(e.rtnVelocity, 1, ms), rtn(e.rtnVelocity, 2, ms), tail].join(','))
	return `${[header, ...rows].join('\r\n')}\r\n`
}
