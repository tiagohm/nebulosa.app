import type { OrbitalMechanicsLimits, OrbitalMechanicsReference, OrbitCenterPayload, OrbitCompareRequest, OrbitCompareResponse, OrbitDefinitionPayload, OrbitPreset, OrbitResolveResponse, OrbitSolveResponse, OrbitSourcePayload, OrbitTrajectoryResponse, OrbitVector, ReferencePlane } from 'api'
import { nanoid } from 'nanoid'
import { AU_KM, DAYSEC, DEG2RAD, MU_AU3_D2_TO_KM3_S2, MU_KM3_S2_TO_AU3_D2, RAD2DEG } from 'nebulosa/src/core/constants'
import type { MutVec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { hermiteVec3 } from 'nebulosa/src/math/numerical/spline'
import { proxy } from 'valtio'
import { csvField } from '../../download'
import { fetchJson, jsonInit } from '../../http'
import { createRequestGuard, type RequestGuard } from '../../sky/selection'

// State of the Orbital Mechanics Explorer, tab-lived and never persisted or mirrored from the server: the orbits shown,
// each with the draft being edited and the last definition the server solved, the shared simulation clock, and the view.
// The server computes every state; this module only interpolates its exact samples to place a body on screen
// (interpolatedPosition), which is a drawing, never a value shown as exact. Drafts are in display units (degrees, km or
// AU, km/s or AU/day, Julian dates TDB) and become a definition in radians, AU, and AU/day only once checked, since the
// server takes what it receives as valid.

// Kind of definition an orbit is edited as.
export type DraftKind = OrbitDefinitionPayload['kind']

// Unit of the distances and velocities shown and typed: km with km/s, or AU with AU/day.
export type DistanceUnit = 'km' | 'au'

// Layers of the scene that can be shown or hidden.
export type OverlayKey = 'referencePlane' | 'orbitalPlane' | 'axes' | 'nodes' | 'apsides' | 'positionVector' | 'velocityVector' | 'angularMomentum' | 'eccentricityVector' | 'labels'

// Projection of the scene's camera.
export type Projection = 'perspective' | 'orthographic'

// How the central body is drawn: at its true radius, or as a fixed marker that is not to scale.
export type CenterDrawing = 'true' | 'marker'

// An orbit as edited, in display units.
export interface OrbitDraft {
	// Kind of definition.
	kind: DraftKind
	// Plane of the angles of a conic definition.
	plane: ReferencePlane
	// Semi-major axis of an elliptic definition, in the scene's distance unit.
	semiMajorAxis: number
	// Eccentricity of an elliptic definition, 0 <= e < 1.
	eccentricity: number
	// Periapsis distance of an open definition, in the scene's distance unit.
	periapsisDistance: number
	// Eccentricity of a hyperbolic definition, above 1.
	hyperbolicEccentricity: number
	// Inclination, degrees, 0..180.
	inclination: number
	// Longitude of the ascending node, degrees.
	node: number
	// Argument of periapsis, degrees.
	argumentOfPeriapsis: number
	// Mean anomaly at the epoch of an elliptic definition, degrees.
	meanAnomaly: number
	// Epoch of an elliptic or Cartesian definition, Julian date TDB.
	epoch: number
	// Time of periapsis passage of an open definition, Julian date TDB.
	periapsisTime: number
	// Position of a Cartesian definition, in the scene's distance unit, J2000 equatorial axes.
	position: [number, number, number]
	// Velocity of a Cartesian definition, in km/s or AU/day by the distance unit, J2000 equatorial axes.
	velocity: [number, number, number]
}

// Where an orbit comes from, kept with it and exported with the scenario: typed by hand, a preset, or a real object's
// SBDB solution or SPK state as the server resolved it.
export type ExplorerOrbitSource = { readonly kind: 'manual' } | { readonly kind: 'preset'; readonly id: string; readonly name: string; readonly sourced: boolean; readonly citation?: string } | OrbitSourcePayload

// A resolved orbit waiting for the operator, since it is about another center than the scene's.
export type PendingOrbit = Extract<OrbitResolveResponse, { readonly kind: 'resolved' }>

// Lookup of a real object.
export interface OrbitLookup {
	// Text of a minor body: an SPK-ID, a designation, or a name.
	query: string
	// Whether a lookup is pending.
	loading: boolean
	// Why the last lookup failed.
	error?: string
	// Whether the last failure was an offline lookup of a body not read recently, which JPL may answer.
	offerOnline: boolean
	// Whether the last failure was the SPICE library's, which the SPICE Kernel Library may fix.
	kernelProblem: boolean
	// Candidates of an ambiguous name.
	matches?: readonly { readonly designation: string; readonly name: string }[]
	// An orbit resolved about another center, waiting to replace the scene.
	pending?: PendingOrbit
}

// A comparison of the two-body model with the SPICE kernels, with what was asked.
export interface OrbitComparison {
	// The request.
	readonly request: OrbitCompareRequest
	// The server's answer.
	readonly response: OrbitCompareResponse
}

// Trajectory of an orbit with the window it was asked for.
export interface OrbitTrack {
	// Key of the definition and window it belongs to.
	readonly key: string
	// First instant of the window, Julian date TDB.
	readonly start: number
	// Last instant of the window, Julian date TDB.
	readonly end: number
	// Whether the states loop by the period, for a bound orbit sampled over one period from its anchor.
	readonly periodic: boolean
	// The server's answer.
	readonly trajectory: OrbitTrajectoryResponse
}

// One orbit of the scene.
export interface ExplorerOrbit {
	// Stable identifier within the tab.
	readonly id: string
	// Name shown.
	name: string
	// Index of its color in the palette.
	color: number
	// Whether it is drawn.
	visible: boolean
	// Draft being edited.
	draft: OrbitDraft
	// Why the draft cannot be solved, while it cannot.
	draftError?: string
	// Last definition checked and sent; the values shown belong to it.
	definition?: OrbitDefinitionPayload
	// Where it comes from.
	source: ExplorerOrbitSource
	// Values at the anchor of `definition`, and the key of the definition they were solved for.
	solution?: OrbitSolveResponse
	// Key of the definition `solution` belongs to.
	solutionKey?: string
	// Curve and states of `definition` over its window.
	track?: OrbitTrack
	// Whether a request for it is pending.
	loading: boolean
	// Why the server refused the last definition.
	error?: string
}

// Exact values of the selected orbit at an instant of the clock.
export interface OrbitInspection {
	// Orbit inspected.
	readonly orbitId: string
	// Key of the definition inspected.
	readonly key: string
	// The server's values.
	readonly solution: OrbitSolveResponse
}

// Camera of the scene.
export interface OrbitView {
	// Azimuth of the eye around the display +Z axis, radians.
	yaw: number
	// Elevation of the eye above the display XY plane, radians, within ±PITCH_LIMIT.
	pitch: number
	// Distance of the eye from the target, AU, positive.
	distance: number
	// Point looked at, AU, display axes.
	target: [number, number, number]
	// Projection.
	projection: Projection
}

// State of the Orbital Mechanics Explorer of a tab.
export interface OrbitalMechanicsState {
	// Centers, presets, and limits of the server; absent until read.
	reference?: OrbitalMechanicsReference
	// Why the reference could not be read.
	referenceError?: string
	// Center shared by every orbit.
	center?: OrbitCenterPayload
	// Unit of the distances shown and typed.
	unit: DistanceUnit
	// Orbits, at most limits.maxOrbits.
	orbits: ExplorerOrbit[]
	// Id of the orbit selected, edited, and inspected.
	selected?: string
	// Instant shown, Julian date TDB.
	time: number
	// Whether the clock runs.
	playing: boolean
	// Rate of the clock, days of simulated time per second of real time; negative runs backward.
	rate: number
	// Exact values at the clock's instant, read when the clock stops or jumps.
	inspection?: OrbitInspection
	// Whether an inspection is pending.
	inspecting: boolean
	// Why the inspection failed.
	inspectionError?: string
	// Plane drawn as the reference and whose nodes are marked.
	plane: ReferencePlane
	// Layers shown.
	overlays: Record<OverlayKey, boolean>
	// How the center is drawn.
	centerDrawing: CenterDrawing
	// Camera.
	view: OrbitView
	// Why an imported scenario was refused.
	importError?: string
	// Whether the camera frames the scene once its curves arrive, after a preset or a scenario replaced it.
	fitPending: boolean
	// Whether the rate is chosen from the selected orbit's timeline once it is solved, after a preset replaced the scene.
	ratePending: boolean
	// A minor body another tool handed over, resolved once the reference is read.
	pendingTarget?: { readonly spkId: string; readonly name: string }
	// Lookup of real objects.
	lookup: OrbitLookup
	// Last comparison with the SPICE kernels.
	comparison?: OrbitComparison
	// Whether a comparison is pending.
	comparing: boolean
	// Why the last comparison failed.
	comparisonError?: string
}

// Side effects of the tool, replaced in tests.
export interface OrbitalMechanicsIo {
	// Fetch of the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Schedules a call after a delay in milliseconds, returning its cancel.
	readonly schedule: (callback: () => void, delay: number) => () => void
}

// Browser implementation of the side effects.
const browserIo: OrbitalMechanicsIo = {
	fetch: (input, init) => fetch(input, init),
	schedule: (callback, delay) => {
		const id = setTimeout(callback, delay)
		return () => clearTimeout(id)
	},
}

// Base path of the routes.
const BASE_URL = '/api/orbital-mechanics'

// Delay between the last edit of a draft and its solve, in milliseconds, so a slider asks once it rests.
export const EDIT_DEBOUNCE_MS = 300

// Largest elevation of the camera, radians, short of the poles where the up direction degenerates.
export const PITCH_LIMIT = (89.5 * Math.PI) / 180

// Julian date of the Unix epoch, used to show a Julian date TDB as a TDB calendar date.
const UNIX_EPOCH_JD = 2440587.5

// Scenario exchanged by Export and Import.
export const SCENARIO_KIND = 'nebulosa-orbital-mechanics-scenario'

// Version of the scenario's shape; a shape change raises it and older files are refused.
export const SCENARIO_VERSION = 1

// Number of colors of the orbit palette (scene.ts).
export const PALETTE_SIZE = 6

// Preset loaded when a tab opens the tool for the first time.
const DEFAULT_PRESET = 'molniya'

// Layers shown by default.
export const DEFAULT_OVERLAYS: Readonly<Record<OverlayKey, boolean>> = {
	referencePlane: true,
	orbitalPlane: true,
	axes: true,
	nodes: true,
	apsides: true,
	positionVector: true,
	velocityVector: true,
	angularMomentum: false,
	eccentricityVector: false,
	labels: true,
}

// Initial camera: looking down from 30° above the plane.
export function initialView(): OrbitView {
	return { yaw: -Math.PI / 3, pitch: Math.PI / 6, distance: 1, target: [0, 0, 0], projection: 'perspective' }
}

// Initial state of the tool, before the reference is read.
export function initialOrbitalMechanicsState(): OrbitalMechanicsState {
	return {
		unit: 'au',
		orbits: [],
		time: 2451545,
		playing: false,
		rate: 1,
		inspecting: false,
		plane: 'equator',
		overlays: { ...DEFAULT_OVERLAYS },
		centerDrawing: 'true',
		view: initialView(),
		fitPending: false,
		ratePending: false,
		lookup: { query: '', loading: false, offerOnline: false, kernelProblem: false },
		comparing: false,
	}
}

// Orbital Mechanics Explorer state of the tab.
export const orbitalMechanicsState = proxy<OrbitalMechanicsState>(initialOrbitalMechanicsState())

// Guards of the solve and the trajectory of each orbit, by orbit id.
const orbitGuards = new Map<string, { readonly solve: RequestGuard; readonly track: RequestGuard; cancelEdit?: () => void }>()

// Guard of the inspection of the selected orbit.
const inspectionGuard = createRequestGuard()

// Guards of an orbit, created on first use.
function guardsOf(id: string) {
	let guards = orbitGuards.get(id)

	if (!guards) {
		guards = { solve: createRequestGuard(), track: createRequestGuard() }
		orbitGuards.set(id, guards)
	}

	return guards
}

// Abandons every request of an orbit.
function forgetGuards(id: string) {
	const guards = orbitGuards.get(id)
	if (!guards) return
	guards.solve.cancel()
	guards.track.cancel()
	guards.cancelEdit?.()
	orbitGuards.delete(id)
}

// Copies a value out of a valtio proxy or snapshot into plain JSON.
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

// Message of a failure.
function messageOf(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

// Kilometers per distance unit.
function kmPer(unit: DistanceUnit) {
	return unit === 'km' ? 1 : AU_KM
}

// AU of a distance in a unit.
export function toAu(value: number, unit: DistanceUnit) {
	return unit === 'km' ? value / AU_KM : value
}

// A distance in AU in a unit.
export function fromAu(value: number, unit: DistanceUnit) {
	return unit === 'km' ? value * AU_KM : value
}

// AU/day of a velocity in the unit paired with a distance unit (km/s or AU/day).
export function toAuPerDay(value: number, unit: DistanceUnit) {
	return unit === 'km' ? (value * DAYSEC) / AU_KM : value
}

// A velocity in AU/day in the unit paired with a distance unit.
export function fromAuPerDay(value: number, unit: DistanceUnit) {
	return unit === 'km' ? (value * AU_KM) / DAYSEC : value
}

// Unit symbol of a distance.
export function distanceSymbol(unit: DistanceUnit) {
	return unit === 'km' ? 'km' : 'AU'
}

// Unit symbol of a velocity.
export function velocitySymbol(unit: DistanceUnit) {
	return unit === 'km' ? 'km/s' : 'AU/d'
}

// The distance unit that suits a center: km around a planet or the Moon, AU around the Sun.
export function unitOf(center: OrbitCenterPayload): DistanceUnit {
	return center.code === 10 ? 'au' : 'km'
}

// A custom center from a GM in km³/s² and a radius in km.
export function customCenter(name: string, gmKm3S2: number, radiusKm: number): OrbitCenterPayload {
	return { name, mu: gmKm3S2 * MU_KM3_S2_TO_AU3_D2, radius: radiusKm / AU_KM, system: false }
}

// GM of a center, km³/s².
export function centerGm(center: OrbitCenterPayload) {
	return center.mu * MU_AU3_D2_TO_KM3_S2
}

// Key identifying a definition, for matching values with the definition they belong to.
export function definitionKey(definition: OrbitDefinitionPayload) {
	return JSON.stringify(definition)
}

// Draft of a definition in a unit.
export function draftOf(definition: OrbitDefinitionPayload, unit: DistanceUnit, epoch: number = 2451545): OrbitDraft {
	const draft: OrbitDraft = {
		kind: definition.kind,
		plane: definition.kind === 'cartesian' ? 'equator' : definition.plane,
		semiMajorAxis: fromAu(1, unit) * (unit === 'km' ? 0.0001 : 1),
		eccentricity: 0.1,
		periapsisDistance: fromAu(1, unit) * (unit === 'km' ? 0.0001 : 1),
		hyperbolicEccentricity: 1.5,
		inclination: 0,
		node: 0,
		argumentOfPeriapsis: 0,
		meanAnomaly: 0,
		epoch,
		periapsisTime: epoch,
		position: [0, 0, 0],
		velocity: [0, 0, 0],
	}

	if (definition.kind === 'cartesian') {
		draft.position = definition.position.map((e) => fromAu(e, unit)) as OrbitDraft['position']
		draft.velocity = definition.velocity.map((e) => fromAuPerDay(e, unit)) as OrbitDraft['velocity']
		draft.epoch = definition.epoch
		return draft
	}

	draft.inclination = definition.inclination * RAD2DEG
	draft.node = definition.node * RAD2DEG
	draft.argumentOfPeriapsis = definition.argumentOfPeriapsis * RAD2DEG

	if (definition.kind === 'elliptic') {
		draft.semiMajorAxis = fromAu(definition.semiMajorAxis, unit)
		draft.eccentricity = definition.eccentricity
		draft.meanAnomaly = definition.meanAnomaly * RAD2DEG
		draft.epoch = definition.epoch
		draft.periapsisTime = definition.epoch
	} else {
		draft.periapsisDistance = fromAu(definition.periapsisDistance, unit)
		draft.periapsisTime = definition.periapsisTime
		draft.epoch = definition.periapsisTime
		if (definition.kind === 'hyperbolic') draft.hyperbolicEccentricity = definition.eccentricity
	}

	return draft
}

// Draft of another kind for an orbit, seeded from the values solved for its current definition (at its anchor) so the
// geometry carries over where the new kind can express it: an open orbit becomes an ellipse of the same periapsis and
// eccentricity 0.5, a bound one a hyperbola of eccentricity 1.5. Without a solution only the kind changes.
export function convertDraft(draft: OrbitDraft, kind: DraftKind, solution: OrbitSolveResponse | undefined, unit: DistanceUnit): OrbitDraft {
	const next: OrbitDraft = { ...draft, position: [...draft.position], velocity: [...draft.velocity], kind }
	if (!solution || kind === draft.kind) return next

	const elements = solution.elements[draft.kind === 'cartesian' ? next.plane : draft.plane]
	const angle = (value: { readonly defined: boolean; readonly value?: number }) => (value.defined && value.value !== undefined ? value.value * RAD2DEG : 0)
	const q = fromAu(elements.periapsisDistance, unit)
	const e = elements.eccentricity
	next.inclination = elements.inclination * RAD2DEG
	next.node = angle(elements.node)
	next.argumentOfPeriapsis = elements.node.defined ? angle(elements.argumentOfPeriapsis) : angle(elements.longitudeOfPeriapsis)

	if (kind === 'cartesian') {
		next.position = solution.position.map((e) => fromAu(e, unit)) as OrbitDraft['position']
		next.velocity = solution.velocity.map((e) => fromAuPerDay(e, unit)) as OrbitDraft['velocity']
		next.epoch = solution.time
	} else if (kind === 'elliptic') {
		next.eccentricity = e < 1 ? e : 0.5
		next.semiMajorAxis = e < 1 ? fromAu(elements.semiMajorAxis!, unit) : q / (1 - next.eccentricity)
		// A circular orbit has no periapsis, so its phase is the angle from the node (or +X) with ω = 0.
		if (elements.conic === 'circular') next.meanAnomaly = elements.node.defined ? angle(elements.argumentOfLatitude) : elements.trueLongitude * RAD2DEG
		else next.meanAnomaly = e < 1 && elements.meanAnomaly !== undefined ? elements.meanAnomaly * RAD2DEG : 0
		next.epoch = e < 1 ? solution.time : (elements.periapsisTime ?? solution.time)
	} else {
		next.periapsisDistance = q
		next.periapsisTime = elements.periapsisTime ?? solution.time
		if (kind === 'hyperbolic') next.hyperbolicEccentricity = e > 1 ? e : 1.5
	}

	return next
}

// Whether a Julian date TDB is within the supported range.
function inRange(jd: number, limits: OrbitalMechanicsLimits) {
	return jd >= limits.epochMin && jd <= limits.epochMax
}

// The definition of a draft about a center, or why it cannot be solved. The server takes definitions as valid, so every
// domain the model requires is held here.
export function draftDefinition(draft: OrbitDraft, center: OrbitCenterPayload, unit: DistanceUnit, limits: OrbitalMechanicsLimits): OrbitDefinitionPayload | string {
	const { mu } = center
	if (!(mu > 0) || !Number.isFinite(mu)) return 'The gravitational parameter of the center must be positive.'

	if (draft.kind === 'cartesian') {
		const position = draft.position.map((e) => toAu(e, unit)) as unknown as OrbitVector
		const velocity = draft.velocity.map((e) => toAuPerDay(e, unit)) as unknown as OrbitVector
		if (![...position, ...velocity].every(Number.isFinite)) return 'Every component of the position and velocity must be a number.'
		const r = Math.hypot(...position)
		const v = Math.hypot(...velocity)
		if (!(r > 0)) return 'The position cannot be at the center.'
		const h = Math.hypot(position[1] * velocity[2] - position[2] * velocity[1], position[2] * velocity[0] - position[0] * velocity[2], position[0] * velocity[1] - position[1] * velocity[0])
		// Same threshold as the toolkit's DEGENERATE_TOLERANCE: a smaller h is lost in the rounding of |r||v|.
		if (!(h > 1e-12 * r * v)) return 'The velocity is parallel to the position, so the motion is not a conic.'
		if (!inRange(draft.epoch, limits)) return 'The epoch is outside the supported range.'
		return { kind: 'cartesian', mu, position, velocity, epoch: draft.epoch }
	}

	const { inclination, node, argumentOfPeriapsis } = draft
	if (!(inclination >= 0 && inclination <= 180)) return 'The inclination must be between 0° and 180°.'
	if (![node, argumentOfPeriapsis].every(Number.isFinite)) return 'The node and the argument of periapsis must be numbers.'
	const angles = { mu, plane: draft.plane, inclination: inclination * DEG2RAD, node: node * DEG2RAD, argumentOfPeriapsis: argumentOfPeriapsis * DEG2RAD }

	if (draft.kind === 'elliptic') {
		const semiMajorAxis = toAu(draft.semiMajorAxis, unit)
		if (!(semiMajorAxis > 0) || !Number.isFinite(semiMajorAxis)) return 'The semi-major axis must be positive.'
		if (!(draft.eccentricity >= 0 && draft.eccentricity < 1)) return 'An elliptic orbit needs an eccentricity from 0 up to, but not including, 1.'
		if (!Number.isFinite(draft.meanAnomaly)) return 'The mean anomaly must be a number.'
		if (!inRange(draft.epoch, limits)) return 'The epoch is outside the supported range.'
		return { kind: 'elliptic', ...angles, semiMajorAxis, eccentricity: draft.eccentricity, meanAnomaly: draft.meanAnomaly * DEG2RAD, epoch: draft.epoch }
	}

	const periapsisDistance = toAu(draft.periapsisDistance, unit)
	if (!(periapsisDistance > 0) || !Number.isFinite(periapsisDistance)) return 'The periapsis distance must be positive.'
	if (!inRange(draft.periapsisTime, limits)) return 'The periapsis time is outside the supported range.'
	if (draft.kind === 'parabolic') return { kind: 'parabolic', ...angles, periapsisDistance, periapsisTime: draft.periapsisTime }
	if (!(draft.hyperbolicEccentricity > 1) || !Number.isFinite(draft.hyperbolicEccentricity)) return 'A hyperbolic orbit needs an eccentricity above 1.'
	return { kind: 'hyperbolic', ...angles, periapsisDistance, eccentricity: draft.hyperbolicEccentricity, periapsisTime: draft.periapsisTime }
}

// The orbit selected, if any.
export function selectedOrbit(state: Pick<OrbitalMechanicsState, 'orbits' | 'selected'>) {
	return state.orbits.find((e) => e.id === state.selected)
}

// Opening of each state in progress, so a second call (a remount) waits for it instead of reading the reference again.
const openings = new WeakMap<OrbitalMechanicsState, Promise<void>>()

// Reads the reference and, on a tab's first opening, loads the default preset. Idempotent once the reference is read.
export function openOrbitalMechanics(state: OrbitalMechanicsState, io: OrbitalMechanicsIo = browserIo): Promise<void> {
	if (state.reference) return Promise.resolve()
	let opening = openings.get(state)

	if (!opening) {
		opening = readReference(state, io).finally(() => openings.delete(state))
		openings.set(state, opening)
	}

	return opening
}

// Reads the reference of a state and loads the default preset into an empty scene.
async function readReference(state: OrbitalMechanicsState, io: OrbitalMechanicsIo) {
	state.referenceError = undefined

	try {
		state.reference = await fetchJson<OrbitalMechanicsReference>(io, `${BASE_URL}/reference`)
	} catch (error) {
		state.referenceError = messageOf(error)
		return
	}

	const preset = state.reference.presets.find((e) => e.id === DEFAULT_PRESET) ?? state.reference.presets[0]
	if (state.orbits.length === 0 && preset) loadPreset(state, preset, io)
}

// Center of the reference with a NAIF ID.
export function referenceCenter(reference: OrbitalMechanicsReference, code: number) {
	return reference.centers.find((e) => e.code === code)
}

// Replaces the scene with a preset: its center, its orbit, and the clock at its anchor.
export function loadPreset(state: OrbitalMechanicsState, preset: OrbitPreset, io: OrbitalMechanicsIo = browserIo) {
	const center = state.reference && referenceCenter(state.reference, preset.center)
	if (!center) return

	clearOrbits(state)
	state.center = plain(center)
	state.unit = unitOf(center)
	state.plane = center.code === 10 ? 'ecliptic' : 'equator'
	const source: ExplorerOrbitSource = { kind: 'preset', id: preset.id, name: preset.name, sourced: preset.source.kind === 'sourced', citation: preset.source.kind === 'sourced' ? preset.source.citation : undefined }
	addOrbit(state, plain(preset.definition), preset.name, source, io)
	state.time = anchorOf(preset.definition)
	state.view = initialView()
	state.fitPending = true
	state.ratePending = true
}

// Forgets every orbit and its requests.
export function clearOrbits(state: OrbitalMechanicsState) {
	for (const orbit of state.orbits) forgetGuards(orbit.id)
	inspectionGuard.cancel()
	state.orbits = []
	state.selected = undefined
	state.inspection = undefined
	state.inspecting = false
	state.inspectionError = undefined
	state.playing = false
}

// Anchor of a definition: its epoch, or its periapsis time, Julian date TDB.
export function anchorOf(definition: OrbitDefinitionPayload) {
	return definition.kind === 'elliptic' || definition.kind === 'cartesian' ? definition.epoch : definition.periapsisTime
}

// Smallest palette index not used by another orbit.
function freeColor(orbits: readonly ExplorerOrbit[]) {
	for (let color = 0; color < PALETTE_SIZE; color++) if (!orbits.some((e) => e.color === color)) return color
	return orbits.length % PALETTE_SIZE
}

// Why another orbit cannot be added, or undefined when it can.
export function addRefusal(state: Pick<OrbitalMechanicsState, 'orbits' | 'reference'>) {
	const limit = state.reference?.limits.maxOrbits ?? 8
	return state.orbits.length >= limit ? `At most ${limit} orbits can be shown together.` : undefined
}

// Adds an orbit of a definition about the scene's center, selects it, and solves it.
export function addOrbit(state: OrbitalMechanicsState, definition: OrbitDefinitionPayload, name: string, source: ExplorerOrbitSource, io: OrbitalMechanicsIo = browserIo) {
	if (addRefusal(state)) return undefined
	const orbit: ExplorerOrbit = { id: nanoid(), name, color: freeColor(state.orbits), visible: true, draft: draftOf(definition, state.unit), definition, source, loading: false }
	state.orbits.push(orbit)
	state.selected = orbit.id
	void solveOrbit(state, orbit.id, io)
	return orbit.id
}

// Adds a copy of an orbit, as a manual orbit the operator may edit apart.
export function cloneOrbit(state: OrbitalMechanicsState, id: string, io: OrbitalMechanicsIo = browserIo) {
	const orbit = state.orbits.find((e) => e.id === id)
	if (!orbit?.definition) return
	addOrbit(state, plain(orbit.definition), `${orbit.name} (copy)`, { kind: 'manual' }, io)
}

// Removes an orbit and its requests.
export function removeOrbit(state: OrbitalMechanicsState, id: string) {
	forgetGuards(id)
	state.orbits = state.orbits.filter((e) => e.id !== id)

	if (state.selected === id) {
		state.selected = state.orbits[0]?.id
		inspectionGuard.cancel()
		state.inspection = undefined
		state.inspecting = false
		state.playing = false
	}
}

// Selects an orbit; its inspection is read again at the clock's instant.
export function selectOrbit(state: OrbitalMechanicsState, id: string, io: OrbitalMechanicsIo = browserIo) {
	if (state.selected === id) return
	state.selected = id
	state.inspection = undefined
	void inspect(state, io)
}

// Changes the draft of an orbit through `edit` and solves it once the edits rest. The values shown stay those of the
// previous definition, marked as such, until the answer.
export function editDraft(state: OrbitalMechanicsState, id: string, edit: (draft: OrbitDraft) => void, io: OrbitalMechanicsIo = browserIo) {
	const orbit = state.orbits.find((e) => e.id === id)
	if (!orbit) return
	edit(orbit.draft)
	if (orbit.source.kind !== 'manual') orbit.source = { kind: 'manual' }
	const guards = guardsOf(id)
	guards.cancelEdit?.()
	guards.cancelEdit = io.schedule(() => {
		guards.cancelEdit = undefined
		commitDraft(state, id, io)
	}, EDIT_DEBOUNCE_MS)
}

// Checks the draft of an orbit at once and solves it when it is valid; an invalid draft keeps the last definition.
export function commitDraft(state: OrbitalMechanicsState, id: string, io: OrbitalMechanicsIo = browserIo) {
	const orbit = state.orbits.find((e) => e.id === id)
	if (!orbit || !state.center || !state.reference) return
	const definition = draftDefinition(orbit.draft, state.center, state.unit, state.reference.limits)

	if (typeof definition === 'string') {
		orbit.draftError = definition
		return
	}

	orbit.draftError = undefined
	if (orbit.definition && definitionKey(orbit.definition) === definitionKey(definition) && orbit.solution) return
	orbit.definition = definition
	void solveOrbit(state, id, io)
}

// Whether the values shown for an orbit belong to its current definition.
export function solutionCurrent(orbit: Pick<ExplorerOrbit, 'definition' | 'solutionKey'>) {
	return orbit.definition !== undefined && orbit.solutionKey === definitionKey(orbit.definition)
}

// Solves the definition of an orbit at its anchor, then reads its trajectory and, when selected, its inspection.
export async function solveOrbit(state: OrbitalMechanicsState, id: string, io: OrbitalMechanicsIo = browserIo) {
	const orbit = state.orbits.find((e) => e.id === id)
	if (!orbit?.definition || !state.center) return
	const definition = plain(orbit.definition)
	const key = definitionKey(definition)
	const request = guardsOf(id).solve.begin()
	orbit.loading = true
	orbit.error = undefined

	try {
		const solution = await fetchJson<OrbitSolveResponse>(io, `${BASE_URL}/solve`, jsonInit('POST', { definition, center: plain(state.center) }, request.signal))
		if (!request.current()) return
		orbit.solution = solution
		orbit.solutionKey = key
		if (state.ratePending && state.selected === id) {
			state.ratePending = false
			const window = trackWindow(solution, state.time)
			state.rate = (window.end - window.start) / PLAYBACK_SECONDS
		}
	} catch (error) {
		if (!request.current()) return
		orbit.error = messageOf(error)
		orbit.loading = false
		return
	}

	await loadTrack(state, id, io)
	if (state.selected === id) await inspect(state, io)
}

// Window of the states of an orbit: one period from the anchor of a bound orbit, which then loops; the arc of an open
// one, widened to include the clock.
export function trackWindow(solution: OrbitSolveResponse, time: number) {
	const period = solution.elements.equator.period
	if (period !== undefined) return { start: solution.anchor, end: solution.anchor + period, periodic: true }
	const arc = solution.arc ?? { start: solution.anchor - 1, end: solution.anchor + 1 }
	return { start: Math.min(arc.start, time), end: Math.max(arc.end, time), periodic: false }
}

// Reads the curve and the states of an orbit over its window.
export async function loadTrack(state: OrbitalMechanicsState, id: string, io: OrbitalMechanicsIo = browserIo) {
	const orbit = state.orbits.find((e) => e.id === id)
	if (!orbit?.definition || !orbit.solution || !solutionCurrent(orbit)) return
	const definition = plain(orbit.definition)
	const window = trackWindow(orbit.solution, state.time)
	const key = `${definitionKey(definition)}|${window.start}|${window.end}|${state.plane}`
	if (orbit.track?.key === key) {
		orbit.loading = false
		return
	}

	const request = guardsOf(id).track.begin()
	orbit.loading = true

	try {
		const trajectory = await fetchJson<OrbitTrajectoryResponse>(io, `${BASE_URL}/trajectory`, jsonInit('POST', { definition, start: window.start, end: window.end, plane: state.plane }, request.signal))
		if (!request.current()) return
		orbit.track = { key, ...window, trajectory }
	} catch (error) {
		if (!request.current()) return
		orbit.error = messageOf(error)
	}

	orbit.loading = false
}

// Reads the exact values of the selected orbit at the clock's instant. Called when the clock stops, steps, or jumps,
// never on every frame.
export async function inspect(state: OrbitalMechanicsState, io: OrbitalMechanicsIo = browserIo) {
	const orbit = selectedOrbit(state)
	if (!orbit?.definition || !state.center) return
	const definition = plain(orbit.definition)
	const request = inspectionGuard.begin()
	state.inspecting = true
	state.inspectionError = undefined

	try {
		const solution = await fetchJson<OrbitSolveResponse>(io, `${BASE_URL}/solve`, jsonInit('POST', { definition, center: plain(state.center), at: state.time }, request.signal))
		if (!request.current()) return
		state.inspection = { orbitId: orbit.id, key: definitionKey(definition), solution }
	} catch (error) {
		if (!request.current()) return
		state.inspectionError = messageOf(error)
	}

	state.inspecting = false
}

// Whether the inspection shown applies to the selected orbit's definition at the clock's instant.
export function inspectionCurrent(state: Pick<OrbitalMechanicsState, 'inspection' | 'orbits' | 'selected' | 'time'>) {
	const orbit = selectedOrbit(state)
	const { inspection } = state
	return inspection !== undefined && orbit?.definition !== undefined && inspection.orbitId === orbit.id && inspection.key === definitionKey(orbit.definition) && inspection.solution.time === state.time
}

// Changes the center shared by every orbit. Their definitions keep their geometry in the new unit and are solved again
// with the new gravitational parameter.
export function setCenter(state: OrbitalMechanicsState, center: OrbitCenterPayload, io: OrbitalMechanicsIo = browserIo) {
	state.center = plain(center)
	const unit = unitOf(center)

	for (const orbit of state.orbits) {
		if (orbit.definition) orbit.draft = draftOf(orbit.definition, unit)
		orbit.source = { kind: 'manual' }
	}

	state.unit = unit
	for (const orbit of state.orbits) commitDraft(state, orbit.id, io)
}

// Changes the unit drafts are shown and typed in, converting them.
export function setUnit(state: OrbitalMechanicsState, unit: DistanceUnit) {
	if (state.unit === unit) return
	const factor = kmPer(state.unit) / kmPer(unit)

	for (const orbit of state.orbits) {
		const draft = orbit.draft
		draft.semiMajorAxis *= factor
		draft.periapsisDistance *= factor
		draft.position = draft.position.map((e) => e * factor) as OrbitDraft['position']
		draft.velocity = draft.velocity.map((e) => fromAuPerDay(toAuPerDay(e, state.unit), unit)) as OrbitDraft['velocity']
	}

	state.unit = unit
}

// Changes the plane drawn as the reference; the nodes marked on each curve follow it.
export function setPlane(state: OrbitalMechanicsState, plane: ReferencePlane, io: OrbitalMechanicsIo = browserIo) {
	if (state.plane === plane) return
	state.plane = plane
	for (const orbit of state.orbits) void loadTrack(state, orbit.id, io)
}

// Sets the clock's instant (Julian date TDB) and, unless it is playing, reads the exact values there.
export function setTime(state: OrbitalMechanicsState, time: number, io: OrbitalMechanicsIo = browserIo) {
	state.time = time
	if (!state.playing) settle(state, io)
}

// Reads again the open tracks the clock left and the exact values at its instant, once it rests.
function settle(state: OrbitalMechanicsState, io: OrbitalMechanicsIo) {
	for (const orbit of state.orbits) if (orbit.track && !orbit.track.periodic && (state.time < orbit.track.start || state.time > orbit.track.end)) void loadTrack(state, orbit.id, io)
	void inspect(state, io)
}

// Starts or stops the clock; stopping reads the exact values at the instant reached.
export function setPlaying(state: OrbitalMechanicsState, playing: boolean, io: OrbitalMechanicsIo = browserIo) {
	if (state.playing === playing) return
	state.playing = playing
	if (!playing) settle(state, io)
}

// Timeline of the selected orbit: one period from its anchor for a bound orbit, which loops, or its arc for an open one.
export function timelineOf(state: Pick<OrbitalMechanicsState, 'orbits' | 'selected' | 'time'>) {
	const orbit = selectedOrbit(state)
	if (!orbit?.solution || !solutionCurrent(orbit)) return undefined
	return trackWindow(orbit.solution, state.time)
}

// Instant the clock reaches after `elapsed` seconds of real time at `rate` days per second from `time`, within a
// timeline: a periodic timeline wraps by whole periods, so the shown state is the same; an open one stops at its ends.
// Returns the instant and whether the clock must stop.
export function advanceClock(time: number, rate: number, elapsed: number, timeline: { readonly start: number; readonly end: number; readonly periodic: boolean } | undefined) {
	const next = time + rate * elapsed
	if (!timeline) return { time: next, stop: false }
	const { start, end, periodic } = timeline
	const span = end - start

	if (periodic && span > 0) {
		if (next > end) return { time: start + ((next - start) % span), stop: false }
		if (next < start) return { time: end - ((end - next) % span), stop: false }
		return { time: next, stop: false }
	}

	if (next >= end) return { time: end, stop: true }
	if (next <= start) return { time: start, stop: true }
	return { time: next, stop: false }
}

// Seconds of real time the default rate takes to play a timeline (a period, or the arc of an open orbit).
export const PLAYBACK_SECONDS = 20

// Most real time one frame of the clock advances by, in seconds: a longer gap (a hidden tab, a stalled page) advances
// only this much, so the clock never jumps by it, while a slow but steady frame rate still plays.
export const FRAME_GAP_LIMIT = 1

// Rates offered, days per second of real time, by label; the orbit rates depend on the selected orbit's period, and a
// `current` speed none of them matches is offered first under its own value, so the select never names another rate.
export function rateOptions(period: number | undefined, current?: number): readonly { readonly label: string; readonly rate: number }[] {
	const rates = [
		{ label: 'Real time', rate: 1 / 86400 },
		{ label: '1 min/s', rate: 1 / 1440 },
		{ label: '1 h/s', rate: 1 / 24 },
		{ label: '1 day/s', rate: 1 },
		{ label: '10 days/s', rate: 10 },
		{ label: '100 days/s', rate: 100 },
		{ label: '1 year/s', rate: 365.25 },
		{ label: '10 years/s', rate: 3652.5 },
	]

	const offered = period === undefined ? rates : [{ label: '1 orbit/min', rate: period / 60 }, { label: '1 orbit/20 s', rate: period / 20 }, { label: '1 orbit/5 s', rate: period / 5 }, ...rates]
	if (current === undefined || !(current > 0) || offered.some((e) => Math.abs(e.rate / current - 1) < 1e-9)) return offered
	return [{ label: `${current.toPrecision(3)} days/s`, rate: current }, ...offered]
}

// The offered rate nearest a speed (days per second, positive), on a logarithmic scale.
export function nearestRate<T extends { readonly rate: number }>(options: readonly T[], speed: number) {
	let best = options[0]
	for (const option of options) if (Math.abs(Math.log(option.rate / speed)) < Math.abs(Math.log(best.rate / speed))) best = option
	return best
}

// Position (AU) interpolated at `time` from the exact samples of a track, for drawing only: a cubic Hermite through the
// two samples around the instant (their positions and velocities), the instant reduced by whole periods on a periodic
// track. Undefined outside an open track's window.
export function interpolatedPosition(track: Pick<OrbitTrack, 'start' | 'end' | 'periodic'> & { readonly trajectory: Pick<OrbitTrajectoryResponse, 'samples'> }, time: number, out: MutVec3 = [0, 0, 0]): MutVec3 | undefined {
	const { times, positions, velocities } = track.trajectory.samples
	if (times.length === 0) return undefined
	let t = time

	if (track.periodic) {
		const span = track.end - track.start
		if (span > 0) t = track.start + ((((time - track.start) % span) + span) % span)
	} else if (time < times[0] || time > times.at(-1)!) return undefined

	if (times.length === 1) return [...positions[0]] as MutVec3

	// Last sample at or before t.
	let low = 0
	let high = times.length - 1
	while (high - low > 1) {
		const middle = (low + high) >> 1
		if (times[middle] <= t) low = middle
		else high = middle
	}

	const width = times[high] - times[low]
	const s = width > 0 ? Math.min(1, Math.max(0, (t - times[low]) / width)) : 0
	return hermiteVec3(positions[low], velocities[low], positions[high], velocities[high], width, s, out)
}

// A Julian date TDB as a TDB calendar date and time, YYYY-MM-DD HH:MM:SS (no leap seconds, unlike UTC).
export function formatTdb(jd: number) {
	const ms = (jd - UNIX_EPOCH_JD) * 86_400_000
	const date = new Date(Math.round(ms / 1000) * 1000)
	return Number.isNaN(date.getTime()) ? '—' : `${date.toISOString().slice(0, 19).replace('T', ' ')} TDB`
}

// Julian date TDB of a TDB calendar date and time typed as YYYY-MM-DDTHH:MM[:SS], or undefined when unreadable.
export function parseTdb(text: string) {
	const ms = Date.parse(`${text}Z`)
	return Number.isFinite(ms) ? ms / 86_400_000 + UNIX_EPOCH_JD : undefined
}

// A Julian date TDB as the value of a datetime-local control (the TDB calendar, to the second).
export function tdbInputValue(jd: number) {
	const date = new Date(Math.round((jd - UNIX_EPOCH_JD) * 86_400) * 1000)
	return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 19)
}

// One orbit of an exported scenario.
export interface ScenarioOrbit {
	// Name shown.
	readonly name: string
	// Index of its color.
	readonly color: number
	// Whether it is drawn.
	readonly visible: boolean
	// Where it comes from.
	readonly source: ExplorerOrbitSource
	// Its definition, radians, AU, AU/day, Julian dates TDB.
	readonly definition: OrbitDefinitionPayload
}

// The exchange file of a scene: every number of the model in radians, AU, AU/day, AU³/day², and Julian dates TDB, in
// J2000 equatorial axes for states, with each orbit's source.
export interface OrbitalMechanicsScenario {
	readonly kind: typeof SCENARIO_KIND
	readonly version: typeof SCENARIO_VERSION
	// Center shared by every orbit.
	readonly center: OrbitCenterPayload
	// Reference plane drawn.
	readonly plane: ReferencePlane
	// Instant shown, Julian date TDB.
	readonly time: number
	// Rate of the clock, days per second.
	readonly rate: number
	// Layers shown.
	readonly overlays: Record<OverlayKey, boolean>
	// Orbits.
	readonly orbits: readonly ScenarioOrbit[]
}

// Scenario of the scene, or undefined when no orbit has a definition.
export function exportScenario(state: OrbitalMechanicsState): OrbitalMechanicsScenario | undefined {
	if (!state.center) return undefined
	const orbits = state.orbits.filter((e) => e.definition).map((e) => ({ name: e.name, color: e.color, visible: e.visible, source: e.source, definition: e.definition! }))
	if (orbits.length === 0) return undefined
	return plain({ kind: SCENARIO_KIND, version: SCENARIO_VERSION, center: state.center, plane: state.plane, time: state.time, rate: state.rate, overlays: state.overlays, orbits })
}

// Whether a value is a plain object.
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Reads a scenario file, checking it as the editor checks a draft, or answers why it is refused. Nothing changes on a
// refusal.
export function importScenario(state: OrbitalMechanicsState, text: string, io: OrbitalMechanicsIo = browserIo) {
	const limits = state.reference?.limits
	if (!limits) return

	const refuse = (reason: string) => {
		state.importError = reason
	}

	let value: unknown

	try {
		value = JSON.parse(text)
	} catch {
		return refuse('The file is not JSON.')
	}

	if (!isRecord(value) || value.kind !== SCENARIO_KIND) return refuse('The file is not an Orbital Mechanics Explorer scenario.')
	if (value.version !== SCENARIO_VERSION) return refuse(`The scenario is of version ${String(value.version)}; this tool reads version ${SCENARIO_VERSION}.`)
	const center = value.center
	if (!isRecord(center) || typeof center.name !== 'string' || typeof center.mu !== 'number' || typeof center.radius !== 'number' || !(center.mu > 0) || !(center.radius >= 0)) return refuse('The center of the scenario is not readable.')
	const orbits = value.orbits
	if (!Array.isArray(orbits) || orbits.length === 0 || orbits.length > limits.maxOrbits) return refuse(`A scenario has from 1 to ${limits.maxOrbits} orbits.`)

	const scenarioCenter: OrbitCenterPayload = { code: typeof center.code === 'number' ? center.code : undefined, name: center.name, mu: center.mu, radius: center.radius, system: center.system === true }
	const unit = unitOf(scenarioCenter)
	const checked: ScenarioOrbit[] = []

	for (const [index, orbit] of orbits.entries()) {
		if (!isRecord(orbit) || !isRecord(orbit.definition) || typeof orbit.name !== 'string') return refuse(`Orbit ${index + 1} is not readable.`)
		const definition = orbit.definition as unknown as OrbitDefinitionPayload
		if (!['elliptic', 'parabolic', 'hyperbolic', 'cartesian'].includes(definition.kind)) return refuse(`Orbit ${index + 1} has an unknown kind.`)
		if (definition.mu !== scenarioCenter.mu) return refuse(`Orbit ${index + 1} is not about the scenario's center.`)
		const again = draftDefinition(draftOf(definition, unit), scenarioCenter, unit, limits)
		if (typeof again === 'string') return refuse(`Orbit ${index + 1}: ${again}`)
		const color = typeof orbit.color === 'number' && orbit.color >= 0 && orbit.color < PALETTE_SIZE ? Math.floor(orbit.color) : index % PALETTE_SIZE
		checked.push({ name: orbit.name, color, visible: orbit.visible !== false, source: isRecord(orbit.source) ? (orbit.source as unknown as ExplorerOrbitSource) : { kind: 'manual' }, definition })
	}

	clearOrbits(state)
	state.importError = undefined
	state.center = scenarioCenter
	state.unit = unit
	state.plane = value.plane === 'ecliptic' ? 'ecliptic' : 'equator'
	state.time = typeof value.time === 'number' && value.time >= limits.epochMin && value.time <= limits.epochMax ? value.time : anchorOf(checked[0].definition)
	state.rate = typeof value.rate === 'number' && Number.isFinite(value.rate) && value.rate !== 0 ? value.rate : 1
	if (isRecord(value.overlays)) for (const key of Object.keys(DEFAULT_OVERLAYS) as OverlayKey[]) if (typeof value.overlays[key] === 'boolean') state.overlays[key] = value.overlays[key]

	for (const orbit of checked) {
		const id = addOrbit(state, orbit.definition, orbit.name, orbit.source, io)
		const added = state.orbits.find((e) => e.id === id)
		if (added) {
			added.color = orbit.color
			added.visible = orbit.visible
		}
	}

	state.selected = state.orbits[0]?.id
	state.view = initialView()
	state.fitPending = true
}

// Columns of the state table export: header with its unit, and the value of a sample.
const CSV_COLUMNS: readonly (readonly [string, (time: number, position: OrbitVector, velocity: OrbitVector) => string])[] = [
	['jd_tdb', (t) => t.toFixed(9)],
	['time_tdb', (t) => formatTdb(t).replace(' TDB', '')],
	['x_au', (_, p) => String(p[0])],
	['y_au', (_, p) => String(p[1])],
	['z_au', (_, p) => String(p[2])],
	['vx_au_per_day', (_, __, v) => String(v[0])],
	['vy_au_per_day', (_, __, v) => String(v[1])],
	['vz_au_per_day', (_, __, v) => String(v[2])],
]

// Name of the source of an orbit, for exports.
export function sourceLabel(source: ExplorerOrbitSource) {
	switch (source.kind) {
		case 'manual':
			return 'manual'
		case 'preset':
			return `preset ${source.id}`
		case 'sbdb':
			return `JPL SBDB ${source.designation}${source.orbitId ? ` solution ${source.orbitId}` : ''}`
		case 'spk':
			return `SPK state of NAIF ${source.target} about NAIF ${source.center} at JD ${source.epoch} TDB`
	}
}

// CSV of the exact states received for an orbit (RFC 4180, CRLF): every row is an analytic two-body state relative to
// the center in J2000 equatorial axes, with the frame, the origin, the model, and the source in columns of their own.
export function trackCsv(orbit: Pick<ExplorerOrbit, 'name' | 'source'>, track: Pick<OrbitTrack, 'trajectory'>, center: OrbitCenterPayload) {
	const constants: readonly (readonly [string, string])[] = [
		['frame', 'J2000 equatorial (ICRF-aligned), geometric'],
		['origin', center.name],
		['origin_naif', center.code === undefined ? '' : String(center.code)],
		['gm_au3_per_day2', String(center.mu)],
		['model', 'two-body Kepler (analytic)'],
		['orbit', orbit.name],
		['source', sourceLabel(orbit.source)],
	]
	const header = [...CSV_COLUMNS.map(([name]) => name), ...constants.map(([name]) => name)].join(',')
	const { times, positions, velocities } = track.trajectory.samples
	const tail = constants.map(([, value]) => csvField(value)).join(',')
	const rows = times.map((t, i) => `${CSV_COLUMNS.map(([, column]) => csvField(column(t, positions[i], velocities[i]))).join(',')},${tail}`)
	return `${[header, ...rows].join('\r\n')}\r\n`
}
